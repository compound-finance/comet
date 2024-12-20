import { diff } from 'jest-diff';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract, providers } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { Alias, Address, BuildFile, TraceFn } from './Types';
import { getAliases, storeAliases, putAlias } from './Aliases';
import { Cache } from './Cache';
import { ContractMap } from './ContractMap';
import { DeployOpts, deploy, deployBuild } from './Deploy';
import { fetchAndCacheContract, readContract } from './Import';
import { getRelationConfig } from './RelationConfig';
import { getRoots, putRoots } from './Roots';
import { Spider, spider } from './Spider';
import { Migration, getArtifactSpec } from './Migration';
import { generateMigration } from './MigrationTemplate';
import { ExtendedNonceManager } from './NonceManager';
import { asyncCallWithTimeout, debug, getEthersContract, mergeIntoProxyContract, txCost } from './Utils';
import { deleteVerifyArgs, getVerifyArgs } from './VerifyArgs';
import { verifyContract, VerifyArgs, VerificationStrategy } from './Verify';

interface DeploymentDelta {
  old: { start: Date, count: number, spider: Spider };
  new: { start: Date, count: number, spider: Spider };
}

interface DeploymentManagerConfig {
  baseDir?: string;
  importRetries?: number;
  importRetryDelay?: number;
  writeCacheToDisk?: boolean;
  verificationStrategy?: VerificationStrategy;
}

export type Deployed = { [alias: Alias]: Contract };

async function getManagedSigner(signer): Promise<SignerWithAddress> {
  const managedSigner = new ExtendedNonceManager(signer) as unknown as providers.JsonRpcSigner;
  return SignerWithAddress.create(managedSigner);
}

export class DeploymentManager {
  network: string;
  deployment: string;
  hre: HardhatRuntimeEnvironment;
  config: DeploymentManagerConfig;
  counter: number;
  spent: number;
  cache: Cache; // TODO: kind of a misnomer since its handling *all* path stuff
  contractsCache: ContractMap | null;
  _signers: SignerWithAddress[];

  constructor(
    network: string,
    deployment: string,
    hre: HardhatRuntimeEnvironment,
    config: DeploymentManagerConfig = {}
  ) {
    this.network = network;
    this.deployment = deployment;
    this.hre = hre;
    this.config = config;
    this.counter = 0;
    this.spent = 0;

    this.cache = new Cache(
      this.network,
      this.deployment,
      config.writeCacheToDisk ?? false,
      config.baseDir
    );

    this.contractsCache = null;
    this._signers = [];
  }

  async getSigners(): Promise<SignerWithAddress[]> {
    if (this._signers.length > 0) {
      return this._signers;
    }
    const signers = await this.hre.ethers.getSigners();
    this._signers = await Promise.all(signers.map(getManagedSigner));
    return this._signers;
  }

  async getSigner(address?: string): Promise<SignerWithAddress> {
    // no address specified, return any signer
    if (!address) {
      return (await this.getSigners())[0];
    }

    // address given, first try to find the managed signer for it
    const signers = await this.getSigners(); // ensure loaded
    const signer = signers.find(s => s.address.toLowerCase() === address.toLowerCase());
    if (signer) {
      return signer;
    }

    // otherwise create a new managed signer for the given address
    const newSigner = await getManagedSigner(await this.hre.ethers.getSigner(address));
    signers.push(newSigner);
    return newSigner;
  }

  async resetSignersPendingCounts() {
    // nonce manager never clears the _deltaCount, so we add a helper to force it
    await Promise.all(this._signers.map(s => s['_signer']._reset()));
  }

  private async deployOpts(): Promise<DeployOpts> {
    return {
      network: this.network,
      verificationStrategy: this.config.verificationStrategy,
      cache: this.cache,
      connect: await this.getSigner(),
      trace: this.tracer()
    };
  }

  // Configuration Parameter for retries after Etherscan import failures
  private importRetries(): number {
    return this.config.importRetries ?? 4;
  }

  // Configuration Parameter for delay between retries on Etherscan import failure
  private importRetryDelay(): number {
    return this.config.importRetryDelay ?? 5_000;
  }

  /* Conditionally executes an action */
  async idempotent<T>(
    condition: () => Promise<any>,
    action: () => Promise<T>,
    retries?: number): Promise<T> {
    if (await condition()) {
      return this.retry(action, retries);
    }
  }

  /* Imports a contract, if not already imported, from Etherscan for local deploys, etc. */
  async import(address: string, network = 'mainnet'): Promise<BuildFile> {
    return fetchAndCacheContract(
      this.cache,
      network ?? this.network,
      address,
      this.importRetries(),
      this.importRetryDelay()
    );
  }

  /* Unconditionally casts a contract as the given artifact type, without caching */
  async cast<C extends Contract>(address: string, artifact: string): Promise<C> {
    const buildFile = await readContract(this.cache, this.hre, artifact, this.network, address, true);
    return getEthersContract<C>(address, buildFile, this.hre);
  }

  /* Conditionally clones a contract with its alias from a given network to this deployment */
  async clone<C extends Contract>(
    alias: Alias,
    address: string,
    deployArgs: any[],
    fromNetwork = 'mainnet', // XXX maybe we should default to the network of the deployment manager
    force?: boolean,
    retries?: number
  ): Promise<C> {
    const maybeExisting: C = await this.contract(alias);
    if (!maybeExisting || force) {
      const buildFile = await this.import(address, fromNetwork);
      const contract: C = await this._deployBuild(buildFile, deployArgs, retries);
      await this.putAlias(alias, contract);
      return contract;
    }
    return maybeExisting;
  }

  /* Conditionally deploy a contract with its alias if it does not exist, or if forced */
  async deploy<C extends Contract, DeployArgs extends Array<any>>(
    alias: Alias,
    contractFile: string,
    deployArgs: DeployArgs,
    force?: boolean,
    retries?: number
  ): Promise<C> {
    const maybeExisting: C = await this.contract(alias);
    if (!maybeExisting || force) {
      const contract: C = await this._deploy(contractFile, deployArgs, retries);
      await this.putAlias(alias, contract);
      return contract;
    }
    return maybeExisting;
  }

  async existing<C extends Contract>(
    alias: Alias,
    addresses: string | string[],
    network = 'mainnet',
    artifact?: string
  ): Promise<C> {
    const maybeExisting = await this.contract<C>(alias);
    if (!maybeExisting) {
      const trace = this.tracer();
      const contracts = await Promise.all(
        [].concat(addresses).map(async (address) => {
          let buildFile;
          if (artifact !== undefined) {
            buildFile = await readContract(this.cache, this.hre, artifact, network, address, !this.cache);
          } else {
            buildFile = await this.import(address, network);
          }
          trace(`Loaded ${buildFile.contract} from ${address} for '${alias}'`);
          return getEthersContract<C>(address, buildFile, this.hre);
        })
      );
      const contract = mergeIntoProxyContract<C>(contracts, this.hre);
      await this.putAlias(alias, contract);
      trace(`Loaded ${alias} from ${network} @ ${addresses}`);
      return contract;
    }
    return maybeExisting;
  }

  async fromDep<C extends Contract>(
    alias: Alias,
    network: string,
    deployment: string,
    force?: boolean,
    otherAlias = alias
  ): Promise<C> {
    const maybeExisting = await this.contract<C>(alias);
    if (!maybeExisting || force) {
      const trace = this.tracer();
      const spider = await this.spiderOther(network, deployment);
      const contract = spider.contracts.get(otherAlias) as C;
      if (!contract) {
        throw new Error(`Unable to find contract ${network}/${deployment}:${otherAlias}`);
      }
      await this.putAlias(alias, contract);
      trace(`Loaded ${alias} from ${network}/${deployment}:${otherAlias} (${contract.address})'`);
      return contract;
    }
    return maybeExisting;
  }

  /* Deploys a contract from Hardhat artifacts */
  async _deploy<C extends Contract>(contractFile: string, deployArgs: any[], retries?: number): Promise<C> {
    const contract = await this.retry(
      async () => deploy(contractFile, deployArgs, this.hre, await this.deployOpts()),
      retries
    );
    this.counter++;
    return contract;
  }

  /* Deploys a contract from a build file, e.g. an one imported contract */
  async _deployBuild<C extends Contract>(buildFile: BuildFile, deployArgs: any[], retries?: number): Promise<C> {
    const contract = await this.retry(
      async () => deployBuild(buildFile, deployArgs, this.hre, await this.deployOpts()),
      retries
    );
    this.counter++;
    return contract;
  }

  /* Deploys missing contracts from the deployment, using the user-space deploy.ts script */
  async runDeployScript(deploySpec: object): Promise<DeploymentDelta> {
    const oldStart = new Date;
    const oldCount = this.counter;
    const oldSpider = await this.spider();
    const deployScript = this.cache.getFilePath({ rel: 'deploy.ts' });
    const { default: deployFn } = await import(deployScript);
    if (!deployFn || !deployFn.call) {
      throw new Error(`Missing deploy function in ${deployScript}.`);
    }
    const deployed = await deployFn(this, deploySpec);
    const newStart = new Date;
    const newCount = this.counter;
    const newSpider = await this.spider(deployed);
    return {
      old: { start: oldStart, count: oldCount, spider: oldSpider },
      new: { start: newStart, count: newCount, spider: newSpider }
    };
  }

  /* Verifies contracts using the verify arguments stored in cache */
  async verifyContracts(filter?: (address: string, args: VerifyArgs) => Promise<boolean>) {
    const verifyArgsMap = await getVerifyArgs(this.cache);
    for (const [address, verifyArgs] of verifyArgsMap) {
      if (filter == undefined || await filter(address, verifyArgs)) {
        const success = await this.verifyContract(verifyArgs);
        // Clear from cache after successfully verifying
        if (success) await deleteVerifyArgs(this.cache, address);
      }
    }
  }

  /* Verifies a contract with the given args and deployment manager hre/opts */
  async verifyContract(args: VerifyArgs): Promise<boolean> {
    return await verifyContract(args, this.hre, (await this.deployOpts()).raiseOnVerificationFailure);
  }

  /* Loads contract configuration by tracing from roots outwards, based on relationConfig */
  async spider(deployed: Deployed = {}): Promise<Spider> {
    const relationConfigMap = getRelationConfig(
      this.hre.config.deploymentManager,
      this.network,
      this.deployment
    );
    const roots = new Map([
      ...await getRoots(this.cache),
      ...Object.entries(deployed).map(([a, c]): [Alias, Address] => [a, c.address])
    ]);
    const crawl = await spider(
      this.cache,
      this.network,
      this.hre,
      relationConfigMap,
      roots,
      this.tracer()
    );
    await putRoots(this.cache, roots);
    await storeAliases(this.cache, crawl.aliases);
    this.contractsCache = crawl.contracts;
    return crawl;
  }

  /* Spiders a different deployment, generally for a dependency on another deployment */
  async spiderOther(network: string, deployment: string): Promise<Spider> {
    // TODO: cache these at a higher level to avoid all the unnecessary noise/ops?
    const dm = new DeploymentManager(network, deployment, this.hre, { writeCacheToDisk: true });
    return await dm.spider();
  }

  /* Stores a new alias, which can then be referenced via `deploymentManager.contract()` */
  async putAlias(alias: Alias, contract: Contract) {
    await putAlias(this.cache, alias, contract.address);
    this.contractsCache.set(alias, contract);
  }

  /* Read an alias from another deployment */
  async readAlias(network: string, deployment: string, alias: Alias): Promise<Address> {
    const aliases = await getAliases(this.cache.asDeployment(network, deployment));
    return aliases.get(alias);
  }

  /* Returns a memory-cached map of contracts indexed by alias.
   * Note: this map is cached in-memory and updated when aliases change,
   *  so call this as often as you would like.
   *
   * For example:
   *
   * ```ts
   * > let contracts = await deploymentManger.contracts();
   * > await contracts.get('Comet').name()
   * "Compound Comet"
   * ```
   **/
  async contracts(): Promise<ContractMap> {
    if (this.contractsCache === null) {
      // TODO: do we need to clear the contracts cache anywhere?
      await this.spider();
    }
    return this.contractsCache;
  }

  /* Gets all the contracts, connected to signer, as an object */
  async getContracts(signer?: SignerWithAddress): Promise<{ [alias: Alias]: Contract }> {
    const contracts = await this.contracts();
    const signer_ = signer ?? await this.getSigner();
    return Object.fromEntries([...contracts].map(([a, c]) => [a, c.connect(signer_)]));
  }

  /* Returns a single contracts indexed by alias.
   *
   * For example:
   *
   * ```ts
   * > let contracts = await deploymentManger.contracts();
   * > await (await deploymentManager.contract('Comet')).name()
   * "Compound Comet"
   * ```
   **/
  async contract<T extends Contract>(alias: string, signer?: SignerWithAddress): Promise<T | undefined> {
    const contracts = await this.contracts();
    const contract = contracts.get(alias);
    return contract && contract.connect(signer ?? await this.getSigner()) as T;
  }

  async getContractOrThrow<T extends Contract>(alias: string, signer?: SignerWithAddress): Promise<T> {
    const tag = `${this.network}/${this.deployment}`;
    const contract = await this.contract<T>(alias, signer);
    if (!contract) {
      throw new Error(`${tag} deployment missing ${alias}`);
    }
    return contract;
  }

  /* Changes configuration of verification strategy during deployment */
  setVerificationStrategy(verificationStrategy: VerificationStrategy) {
    this.config.verificationStrategy = verificationStrategy;
  }

  /* Changes configuration of writing cache to disk, or not. */
  shouldWriteCacheToDisk(writeCacheToDisk: boolean) {
    this.config.writeCacheToDisk = writeCacheToDisk;
    this.cache.writeCacheToDisk = writeCacheToDisk;
  }

  /* Generates a new migration file, e.g. `deployments/<network>/<deployment>/migrations/1644385406_my_new_migration.ts` */
  async generateMigration(name: string, timestamp?: number): Promise<string> {
    return generateMigration(this.cache, name, timestamp);
  }

  /* Stores artifact from a migration, e.g. `deployments/<network>/<deployment>/artifacts/1644385406_my_new_migration.json` */
  async storeArtifact<A>(migration: Migration<A>, artifact: A): Promise<string> {
    const artifactSpec = getArtifactSpec(migration);
    await this.cache.storeCache(artifactSpec, artifact);
    return this.cache.getFilePath(artifactSpec);
  }

  /* Reads artifact from a migration, e.g. `deployments/<network>/<deployment>/artifacts/1644385406_my_new_migration.json` */
  async readArtifact<A>(migration: Migration<A>): Promise<A> {
    return this.cache.readCache(getArtifactSpec(migration));
  }

  /* Reads the deployment configuration */
  async readConfig<Config>(): Promise<Config> {
    return this.cache.readCache({ rel: 'configuration.json' });
  }

  /**
   * Call an async function with a given amount of retries
   * @param fn an async function that takes a signer as an argument. The function takes a signer
   * because a new instance of a signer needs to be used on each retry
   * @param retries the number of times to retry the function. Default is 7 retries
   * @param timeLimit time limit before timeout in milliseconds
   * @param wait time to wait between tries in milliseconds
   */
  async retry(fn: () => Promise<any>, retries: number = 7, timeLimit?: number, wait: number = 500) {
    try {
      return await asyncCallWithTimeout(fn(), timeLimit);
    } catch (e) {
      if (retries === 0) throw e;

      console.warn(`Retrying with retries left: ${retries}, wait: ${wait}, error is: `, e);
      await this.resetSignersPendingCounts();

      await new Promise(ok => setTimeout(ok, wait));
      return this.retry(fn, retries - 1, timeLimit, wait * 2);
    }
  }

  tracer(): TraceFn {
    return (first, ...rest) => {
      if (typeof first === 'string') {
        debug(`[${this.network}] ${first}`, ...rest);
      } else {
        return first.wait().then(async (tx) => {
          const cost = Number(txCost(tx) / (10n ** 12n)) / 1e6;
          const logs = tx.events.map(e => `${e.event ?? 'unknown'}(${e.args ?? '?'})`).join(' ');
          const info = `@ ${tx.transactionHash}[${tx.transactionIndex}]`;
          const desc = `${info} in blockNumber: ${tx.blockNumber} emits: ${logs}`;
          debug(`[${this.network}] {${cost} Ξ}`, ...rest, desc);
          this.spent += cost;
          return tx;
        });
      }
    };
  }

  diffDelta(delta: DeploymentDelta): string {
    const withoutContracts = ({ contracts: _, ...rest }) => rest;
    const new_ = { ...delta.new, spider: withoutContracts(delta.new.spider) };
    const old_ = { ...delta.old, spider: withoutContracts(delta.old.spider) };
    return diff(new_, old_, {
      aAnnotation: 'New addresses',
      aIndicator: '+',
      bAnnotation: 'Old addresses',
      bIndicator: '-',
    });
  }

  fork(): DeploymentManager {
    const copy = new DeploymentManager(this.network, this.deployment, this.hre, this.config);
    copy.cache.loadMemory(this.cache.cache);
    copy.contractsCache = new Map(this.contractsCache);
    return copy;
  }
}
