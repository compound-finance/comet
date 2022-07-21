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
import { deleteVerifyArgs, getVerifyArgs } from './VerifyArgs';
import { verifyContract } from './Verify';

interface DeploymentManagerConfig {
  baseDir?: string;
  importRetries?: number;
  importRetryDelay?: number;
  writeCacheToDisk?: boolean;
  verifyContracts?: boolean;
  lazyVerify?: boolean;
  debug?: boolean;
}

function getNetwork(deployment: string): string {
  return deployment; // TODO: Handle deployments that don't map correctly
}

export class DeploymentManager {
  deployment: string;
  hre: HardhatRuntimeEnvironment;
  config: DeploymentManagerConfig;
  cache: Cache;
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
    this._signers = await Promise.all(signers.map(async (signer) => {
      const managedSigner = new ExtendedNonceManager(signer) as unknown as providers.JsonRpcSigner;
      return await SignerWithAddress.create(managedSigner);
    }));
    return this._signers;
  }

  async getSigner(): Promise<SignerWithAddress> {
    return (await this.getSigners())[0];
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
      verify: this.config.verifyContracts,
      lazyVerify: this.config.lazyVerify,
      cache: this.cache,
      connect: await this.getSigner(),
    };
  }

  // Configuration Parameter for retries after Etherscan import failures
  private importRetries(): number {
    return this.config.importRetries ?? 3;
  }

  // Configuration Parameter for delay between retries on Etherscan import failure
  private importRetryDelay(): number {
    return this.config.importRetryDelay ?? 2000;
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
  >(contractFile: string, deployArgs: DeployArgs): Promise<C> {
    return deploy<C, Factory, DeployArgs>(contractFile, deployArgs, this.hre, await this.deployOpts());
  }

  /* Deploys a contract from a build file, e.g. an one imported contract */
  async deployBuild(buildFile: BuildFile, deployArgs: any[]): Promise<Contract> {
    return await deployBuild(buildFile, deployArgs, this.hre, await this.deployOpts());
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

  /* Changes configuration of verifying contracts on deployment */
  shouldVerifyContracts(verifyContracts: boolean) {
    this.config.verifyContracts = verifyContracts;
  }

  /* Changes configuration of lazily verifying contracts on deployment */
  shouldLazilyVerifyContracts(lazilyVerifyContracts: boolean) {
    this.config.lazyVerify = lazilyVerifyContracts;
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

  async clone<C extends Contract>(address: string, args: any[], network?: string): Promise<C> {
    let buildFile = await this.import(address, network);
    return await this.deployBuild(buildFile, args) as C;
  }

  network(): string {
    return getNetwork(this.deployment);
  }

  static fork(d: DeploymentManager): DeploymentManager {
    let copy = new DeploymentManager(d.deployment, d.hre, d.config);
    copy.cache.loadMemory(d.cache.cache);
    return copy;
  }
}
