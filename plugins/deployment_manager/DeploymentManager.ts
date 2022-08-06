import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract, providers } from 'ethers';
import { Alias, Address, BuildFile } from './Types';
import { Aliases, getAliases, putAlias, storeAliases } from './Aliases';
import { Cache } from './Cache';
import { ContractMap, getContracts } from './ContractMap';
import { Deployer, DeployOpts, deploy, deployBuild } from './Deploy';
import { fetchAndCacheContract } from './Import';
import { Proxies, getProxies, putProxy, storeProxies } from './Proxies';
import { getRelationConfig } from './RelationConfig';
import { Roots, getRoots, putRoots } from './Roots';
import { Spider, spider } from './Spider';
import { Migration, getArtifactSpec } from './Migration';
import { generateMigration } from './MigrationTemplate';
import { ExtendedNonceManager } from './NonceManager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { asyncCallWithTimeout, debug, getEthersContract } from './Utils';
import { deleteVerifyArgs, getVerifyArgs } from './VerifyArgs';
import { verifyContract, VerificationStrategy } from './Verify';

interface DeploymentManagerConfig {
  baseDir?: string;
  importRetries?: number;
  importRetryDelay?: number;
  writeCacheToDisk?: boolean;
  verificationStrategy?: VerificationStrategy;
}

interface DeploymentDelta {
  old: { count: number, roots: Roots, spider: Spider },
  new: { count: number, roots: Roots, spider: Spider },
}

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

    this.cache = new Cache(
      this.network,
      this.deployment,
      config.writeCacheToDisk ?? false, config.baseDir
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
    const signer = this._signers.find(s => s.address.toLowerCase() === address.toLowerCase());
    if (signer) {
      return signer;
    }

    // otherwise create a new managed signer for the given address
    const newSigner = await getManagedSigner(await this.hre.ethers.getSigner(address));
    this._signers.push(newSigner);
    return newSigner;
  }

  private async deployOpts(): Promise<DeployOpts> {
    return {
      verificationStrategy: this.config.verificationStrategy,
      cache: this.cache,
      connect: await this.getSigner(),
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

  // Clears the contract cache. Should be invalidated when any aliases have changed.
  private invalidateContractsCache() {
    this.contractsCache = null;
  }

  /* Conditionally executes an action */
  async idempotent(
    condition: () => Promise<any>,
    action: (signer: SignerWithAddress) => Promise<any>,
    retries?: number): Promise<any> {
    if (await condition()) {
      return this.asyncCallWithRetry(action, retries);
    }
  }

  /* Imports a contract, if not already imported, from Etherscan for local deploys, etc. */
  async import(address: string, network?: string): Promise<BuildFile> {
    return await fetchAndCacheContract(
      this.cache,
      network ?? this.network,
      address,
      this.importRetries(),
      this.importRetryDelay()
    );
  }

  /* Conditionally clones a contract with its alias from a given network to this deployment */
  async clone<C extends Contract>(
    alias: Alias,
    address: string,
    deployArgs: any[],
    fromNetwork?: string,
    retries?: number
  ): Promise<C> {
    // XXX conditional
    let buildFile = await this.import(address, fromNetwork);
    return this._deployBuild(buildFile, deployArgs, retries);
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
      // NB: would like to use an override on deployOpts, but it doesn't invalidate cache...
      const contract: C = await this._deploy(contractFile, deployArgs, retries);
      await this.putAlias(alias, contract.address);
      return contract;
    }
    return maybeExisting;
  }

  async existing<C extends Contract>(alias: Alias, address: string): Promise<C> {
    const maybeExisting = await this.contract<C>(alias);
    if (!maybeExisting) {
      const buildFile = await this.import(address);
      const contract = getEthersContract<C>(address, buildFile, this.hre);
      await this.putAlias(alias, address);
      return contract;
    }
    return maybeExisting;
  }

  /* Deploys a contract from Hardhat artifacts */
  async _deploy<
    C extends Contract,
    Factory extends Deployer<C, DeployArgs>,
    DeployArgs extends Array<any>
  >(contractFile: string, deployArgs: DeployArgs, retries?: number): Promise<C> {
    const contract = await this.asyncCallWithRetry(
      async () => deploy<C, Factory, DeployArgs>(contractFile, deployArgs, this.hre, await this.deployOpts()),
      retries
    );
    this.counter++;
    return contract;
  }

  /* Deploys a contract from a build file, e.g. an one imported contract */
  async _deployBuild<C extends Contract>(buildFile: BuildFile, deployArgs: any[], retries?: number): Promise<C> {
    const contract = await this.asyncCallWithRetry(
      async () => deployBuild(buildFile, deployArgs, this.hre, await this.deployOpts()),
      retries
    );
    this.counter++;
    return contract;
  }

  /* Deploys missing contracts from the deployment, using the user-space deploy.ts script */
  async runDeployScript(deploySpec: object): Promise<DeploymentDelta> {
    const oldCount = this.counter;
    const oldRoots = await this.getRoots();
    const oldSpider = await this.spider();
    const deployScript = this.cache.getFilePath({ rel: 'deploy.ts' });
    const { default: deployFn } = await import(deployScript);
    if (!deployFn || !deployFn.call) {
      throw new Error(`Missing deploy function in ${deployScript}.`);
    }
    const result = await deployFn(this, deploySpec);
    const aliases = await this.getAliases();
    const newCount = this.counter;
    const newRoots = await this.putRoots(new Map(result.map(a => [a, aliases.get(a)])));
    const newSpider = await this.spider();
    return {
      old: { count: oldCount, roots: oldRoots, spider: oldSpider },
      new: { count: newCount, roots: newRoots, spider: newSpider }
    };
  }

  /* Verifies contracts using the verify arguments stored in cache */
  async verifyContracts() {
    let verifyArgs = await getVerifyArgs(this.cache);
    for (const address of verifyArgs.keys()) {
      await verifyContract(
        verifyArgs.get(address),
        this.hre,
        (await this.deployOpts()).raiseOnVerificationFailure
      );

      // Clear from cache after successfully verifying
      await deleteVerifyArgs(this.cache, address);
    }
  }

  /* Stores a new alias, which can then be referenced via `deploymentManager.contract()` */
  async putAlias(alias: Alias, address: Address) {
    await putAlias(this.cache, alias, address);
    this.invalidateContractsCache();
  }

  /* Stores a new proxy, which dictates the ABI available for that contract in `deploymentManager.contract()` */
  async putProxy(alias: Alias, address: Address) {
    await putProxy(this.cache, alias, address);
    this.invalidateContractsCache();
  }

  /* Stores new roots, which are the basis for spidering. */
  async putRoots(roots: Roots): Promise<Roots> {
    return putRoots(this.cache, roots);
  }

  /* Gets the existing roots. */
  async getRoots(): Promise<Roots> {
    return getRoots(this.cache);
  }

  /* Loads contract configuration by tracing from roots outwards, based on relationConfig. */
  async spider(): Promise<Spider> {
    const relationConfigMap = getRelationConfig(
      this.hre.config.deploymentManager,
      this.network,
      this.deployment
    );
    const roots = await getRoots(this.cache);
    const crawl = await spider(
      this.cache,
      this.network,
      this.hre,
      relationConfigMap,
      roots
    );
    await storeAliases(this.cache, crawl.aliases);
    await storeProxies(this.cache, crawl.proxies);
    this.invalidateContractsCache();
    return crawl;
  }

  async getProxies(): Promise<Proxies> {
    return getProxies(this.cache);
  }

  async getAliases(): Promise<Aliases> {
    return getAliases(this.cache);
  }

  /* Returns a memory-cached map of contracts indexed by alias. Note: this map
   * is cached in-memory (and invalidated when aliases or proxies change), so
   * you should feel free to call this as often as you would like without concern
   * for memory usage.
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
    if (this.contractsCache !== null) {
      return this.contractsCache;
    } else {
      // TODO: When else do we need to clear the contracts cache
      this.contractsCache = await getContracts(this.cache, this.hre, await this.getSigner());
      return this.contractsCache;
    }
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
  async contract<T extends Contract>(alias: string): Promise<T | undefined> {
    let contracts = await this.contracts();
    return contracts.get(alias) as T;
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
    let artifactSpec = getArtifactSpec(migration);
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
   * @param retries the number of times to retry the function. Default is 5 retries
   * @param timeLimit time limit before timeout in milliseconds
   * @param wait time to wait between tries in milliseconds
   */
  async asyncCallWithRetry(fn: (signer: SignerWithAddress) => Promise<any>, retries: number = 5, timeLimit?: number, wait: number = 250) {
    // XXX maybe rename to `doWithRetry`
    const signer = await this.getSigner();
    try {
      return await asyncCallWithTimeout(fn(signer), timeLimit);
    } catch (e) {
      retries -= 1;
      debug(`Retrying with retries left: ${retries}, wait: ${wait}`);
      debug('Error is: ', e);
      if (retries === 0) throw e;
      await new Promise(ok => setTimeout(ok, wait));
      return this.asyncCallWithRetry(fn, retries, timeLimit, wait * 2);
    }
  }

  /**
   * Calls an arbitrary function with lazy verification turned on
   * Note: Main use-case is to be a light wrapper around deploy scripts
   */
  async doThenVerify(fn: () => Promise<any>): Promise<any> {
    const prevSetting = this.config.verificationStrategy;
    this.setVerificationStrategy('lazy');

    const result = await fn();

    await this.verifyContracts();
    this.setVerificationStrategy(prevSetting);

    return result;
  }

  fork(): DeploymentManager {
    let copy = new DeploymentManager(this.network, this.deployment, this.hre, this.config);
    copy.cache.loadMemory(this.cache.cache);
    return copy;
  }
}
