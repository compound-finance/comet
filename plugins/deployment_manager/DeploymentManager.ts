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
import { spider } from './Spider';
import { Migration, getArtifactSpec } from './Migration';
import { generateMigration } from './MigrationTemplate';
import { ExtendedNonceManager } from './NonceManager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { asyncCallWithTimeout, debug } from './Utils';
import { deleteVerifyArgs, getVerifyArgs } from './VerifyArgs';
import { verifyContract, VerificationStrategy } from './Verify';

interface DeploymentManagerConfig {
  baseDir?: string;
  importRetries?: number;
  importRetryDelay?: number;
  writeCacheToDisk?: boolean;
  verificationStrategy?: VerificationStrategy;
  debug?: boolean;
}

function getNetwork(deployment: string): string {
  return deployment; // TODO: Handle deployments that don't map correctly
}

async function getManagedSigner(signer): Promise<SignerWithAddress> {
  const managedSigner = new ExtendedNonceManager(signer) as unknown as providers.JsonRpcSigner;
  return SignerWithAddress.create(managedSigner);
}

export class DeploymentManager {
  deployment: string;
  hre: HardhatRuntimeEnvironment;
  config: DeploymentManagerConfig;
  cache: Cache; // TODO: kind of a misnomer since its handling *all* path stuff
  contractsCache: ContractMap | null;
  _signers: SignerWithAddress[];

  constructor(
    deployment: string,
    hre: HardhatRuntimeEnvironment,
    config: DeploymentManagerConfig = {}
  ) {
    this.deployment = deployment;
    this.hre = hre;
    this.config = config;

    this.cache = new Cache(deployment, config.writeCacheToDisk ?? false, config.baseDir);

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

  private debug(...args: any[]) {
    if (this.config.debug) {
      if (typeof args[0] === 'function') {
        console.log(...args[0]());
      } else {
        console.log(...args);
      }
    }
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

  /* Imports a contract, if not already imported, from Etherscan for local deploys, etc. */
  async import(address: string, network?: string): Promise<BuildFile> {
    return await fetchAndCacheContract(
      this.cache,
      network ?? getNetwork(this.deployment),
      address,
      this.importRetries(),
      this.importRetryDelay()
    );
  }

  /* Deploys a contract from Hardhat artifacts */
  async deploy<
    C extends Contract,
    Factory extends Deployer<C, DeployArgs>,
    DeployArgs extends Array<any>
  >(contractFile: string, deployArgs: DeployArgs, retries?: number): Promise<C> {
    return await this.asyncCallWithRetry(
      async () => deploy<C, Factory, DeployArgs>(contractFile, deployArgs, this.hre, await this.deployOpts()),
      retries
    );
  }

  /* Deploys a contract from a build file, e.g. an one imported contract */
  async deployBuild(buildFile: BuildFile, deployArgs: any[], retries?: number): Promise<Contract> {
    return await this.asyncCallWithRetry(
      async () => deployBuild(buildFile, deployArgs, this.hre, await this.deployOpts()),
      retries
    );
  }

  /* Deploys missing contracts from the deployment, using the user-space deploy.ts script */
  async deployMissing(force: boolean = false) {
    // XXX if this is idempotent we can just always deploy, and do the same for dev
    //  as is, won't handle cases where the deploy script adds roots or partial redeploys
    // if force or there are no roots, deploy
    //  force will also have to change with idempotent deploy changes
    //   its here for deploy task, which doesn't really care if roots exists or not
    //    but we'll want another way to specify how idempotent should work
    const roots = await this.getRoots();
    if (force || roots.size == 0) {
      // XXX noted above but cache is a misnomer since we have non-cache files its kind of managing
      //  could either rename or move that functionality
      const deployScript = this.cache.getFilePath({ rel: 'deploy.ts' });
      // XXX expect returns roots, and we write them?
      const { default: deploy } = await import(deployScript);
      if (!deploy || !deploy.call) {
        throw new Error(`Missing deploy function in ${deployScript}.`);
      }
      await deploy(this);
    }
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
  async putRoots(roots: Roots) {
    await putRoots(this.cache, roots);
  }

  /* Gets the existing roots. */
  async getRoots(): Promise<Roots> {
    return await getRoots(this.cache);
  }

  /* Loads contract configuration by tracing from roots outwards, based on relationConfig. */
  async spider() {
    let relationConfigMap = getRelationConfig(this.hre.config.deploymentManager, this.deployment);
    let roots = await getRoots(this.cache);
    let { aliases, proxies } = await spider(
      this.cache,
      getNetwork(this.deployment),
      this.hre,
      relationConfigMap,
      roots
    );
    await storeAliases(this.cache, aliases);
    await storeProxies(this.cache, proxies);
    this.invalidateContractsCache();
  }

  async getProxies(): Promise<Proxies> {
    return await getProxies(this.cache);
  }

  async getAliases(): Promise<Aliases> {
    return await getAliases(this.cache);
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
  async contract(alias: string): Promise<Contract> {
    let contracts = await this.contracts();
    return contracts.get(alias);
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

  /* Generates a new migration file, e.g. `deployments/test/migrations/1644385406_my_new_migration.ts`
   **/
  async generateMigration(name: string, timestamp?: number): Promise<string> {
    return await generateMigration(this.cache, name, timestamp);
  }

  /* Stores artifact from a migration, e.g. `deployments/test/artifacts/1644385406_my_new_migration.json`
   **/
  async storeArtifact<A>(migration: Migration<A>, artifact: A): Promise<string> {
    let artifactSpec = getArtifactSpec(migration);
    await this.cache.storeCache(artifactSpec, artifact);
    return this.cache.getFilePath(artifactSpec);
  }

  /* Reads artifact from a migration, e.g. `deployments/test/artifacts/1644385406_my_new_migration.json`
   **/
  async readArtifact<A>(migration: Migration<A>): Promise<A> {
    return await this.cache.readCache(getArtifactSpec(migration));
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
      // XXX to be extra safe, we can also get the signer transaction count and figure out the next nonce
      // We reset signers here to force a new signer to be instantiated using a new provider. This helps
      // when retrying hanging txns.
      this._signers = [];
      await new Promise(ok => setTimeout(ok, wait));
      return await this.asyncCallWithRetry(fn, retries, timeLimit, wait * 2);
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

  async clone<C extends Contract>(address: string, args: any[], network?: string, retries?: number): Promise<C> {
    let buildFile = await this.import(address, network);
    return await this.deployBuild(buildFile, args, retries) as C;
  }

  network(): string {
    return getNetwork(this.deployment);
  }

  fork(): DeploymentManager {
    let copy = new DeploymentManager(this.deployment, this.hre, this.config);
    copy.cache.loadMemory(this.cache.cache);
    return copy;
  }
}
