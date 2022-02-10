import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract, Signer } from 'ethers';

import { Alias, Address, BuildFile } from './Types';

import { Aliases, putAlias, storeAliases } from './Aliases';
import { Cache } from './Cache';
import { ContractMap, getContracts } from './ContractMap';
import { Deployer, DeployOpts, deploy, deployBuild } from './Deploy';
import { fetchAndCacheContract } from './Import';
import { putProxy, storeProxies } from './Proxies';
import { getRelationConfig } from './RelationConfig';
import { Roots, getRoots, putRoots } from './Roots';
import { spider } from './Spider';
import { verifyContract } from './Verify';
import { Migration, getArtifactSpec } from './Migration';
import { generateMigration } from './MigrationTemplate';

interface DeploymentManagerConfig {
  baseDir?: string;
  importRetries?: number;
  importRetryDelay?: number;
  writeCacheToDisk?: boolean;
  verifyContracts?: boolean;
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
  signer: Signer | null; // Used by deployer and contracts
  contractsCache: ContractMap | null;

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
    this.signer = null; // TODO: connect
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

  private deployOpts(): DeployOpts {
    return {
      verify: this.config.verifyContracts,
      cache: this.cache,
      connect: this.signer,
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
    return deploy<C, Factory, DeployArgs>(contractFile, deployArgs, this.hre, this.deployOpts());
  }

  /* Deploys a contract from a build file, e.g. an one imported contract */
  async deployBuild(buildFile: BuildFile, deployArgs: any[]): Promise<Contract> {
    return await deployBuild(buildFile, deployArgs, this.hre, this.deployOpts());
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
      this.contractsCache = await getContracts(this.cache, this.hre, this.signer);
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
}
