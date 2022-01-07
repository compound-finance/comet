import * as path from 'path';
import * as fs from 'fs/promises';

import { Contract, ContractFactory, Signer } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import {
  Address,
  ContractMetadata,
  BuildFile,
  ContractMap,
  BuildMap,
  AliasesMap,
  PointersMap,
  ProxiesMap,
} from './Types';
import { loadContract } from '../import/import';
import {
  getPrimaryContract,
  getAlias,
  getRelations,
  fileExists,
  mergeContracts,
  readAddressFromFilename,
  objectToMap,
  objectFromMap,
} from './Utils';

export { ContractMap } from './Types';

abstract class Deployer<Contract, DeployArgs extends Array<any>> {
  abstract connect(signer: Signer): this;
  abstract deploy(...args: DeployArgs): Promise<Contract>;
}

export type Roots = { [contractName: string]: Address };

export interface RelationConfig {
  relations?: string[];
  implementation?: string;
  alias?: string;
}

export type RelationConfigMap = { [contractName: string]: RelationConfig };

interface DeploymentConfig {
  baseDir?: string;
  importRetries?: number;
  importRetryDelay?: number;
  writeCacheToDisk?: boolean;
}

export class DeploymentManager {
  deployment: string;
  hre: HardhatRuntimeEnvironment;
  config: DeploymentConfig;
  contracts: ContractMap;
  cache: object;
  signer: Signer | null;

  constructor(deployment: string, hre: HardhatRuntimeEnvironment, config: DeploymentConfig = {}) {
    this.deployment = deployment;
    this.hre = hre;
    this.config = config;
    this.contracts = {};
    this.cache = {};
    this.signer = null;
  }

  // Configuration Parameter for retries after Etherscan import failures
  private importRetries(): number {
    return this.config.importRetries ?? 3;
  }

  // Configuration Parameter for delay between retries on Etherscan import failure
  private importRetryDelay(): number {
    return this.config.importRetryDelay ?? 2000;
  }

  // Base directory for all file storage, e.g. the project root
  private baseDir(): string {
    return this.config.baseDir || process.cwd();
  }

  // Base directory for all file storage, e.g. `$pwd/deployments`
  private deploymentsBaseDir(): string {
    return path.join(this.baseDir(), 'deployments');
  }

  // Base directory for a specific deployment, e.g. `$pwd/deployments/$network`
  private deploymentDir(): string {
    return path.join(this.deploymentsBaseDir(), this.deployment);
  }

  // Base directory for a specific deployment's cache, e.g. `$pwd/deployments/$network/cache`
  private cacheDir(): string {
    return path.join(this.deploymentDir(), 'cache');
  }

  // File to store pointers in, e.g. `$pwd/deployments/$network/pointers.json`
  private pointersFile(): string {
    return path.join(this.deploymentDir(), 'pointers.json');
  }

  // File to store proxies in, e.g. `$pwd/deployments/$network/proxies.json`
  private proxiesFile(): string {
    return path.join(this.deploymentDir(), 'proxies.json');
  }

  // File to store relation config in, e.g. `$pwd/deployments/relations.json`
  private relationsBaseFile(): string {
    return path.join(this.deploymentsBaseDir(), 'relations.json');
  }

  // File to store relation config in, e.g. `$pwd/deployments/$network/relations.json`
  private relationsFile(): string {
    return path.join(this.deploymentDir(), 'relations.json');
  }

  // File to store root information in, e.g. `$pwd/deployments/$network/roots.json`
  private rootsFile(): string {
    return path.join(this.deploymentDir(), 'roots.json');
  }

  // File to cache contract metadata, e.g. `$pwd/deployments/$network/cache/$address.json`
  private cacheBuildFile(address: Address): string {
    return path.join(this.cacheDir(), `${address.toLowerCase()}.json`);
  }

  async readCache<T>(file: string): Promise<T> {
    let cached = this.cache[file.toLowerCase()];
    if (cached) {
      return cached as T;
    } else {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    }
  }

  // Checks to see if a file exists, either in in-memory cache or on disk.
  private async cacheFileExists(file: string): Promise<boolean> {
    if (this.cache[file.toLowerCase()]) {
      return true;
    } else {
      return await fileExists(file);
    }
  }

  // Write contract metadata from file cache
  private async readBuildFileFromCache(address: Address): Promise<BuildFile> {
    let cacheBuildFile = this.cacheBuildFile(address);
    return this.readCache<BuildFile>(cacheBuildFile);
  }

  // Write an object to file cache
  private async writeObjectToCache(object: Object, filePath: string): Promise<void> {
    if (this.config.writeCacheToDisk) {
      if (!(await fileExists(this.cacheDir()))) {
        await fs.mkdir(this.cacheDir(), { recursive: true });
      }

      await fs.writeFile(filePath, JSON.stringify(object, null, 4));
    } else {
      this.cache[filePath.toLowerCase()] = object;
    }
  }

  // Read root information for given deployment
  private async getRoots(): Promise<Roots> {
    return this.readCache<Roots>(this.rootsFile());
  }

  // Read relation configuration for given deployment
  private async getRelationConfig(): Promise<RelationConfigMap> {
    let relationsFile = (await fileExists(this.relationsFile()))
      ? this.relationsFile()
      : this.relationsBaseFile();
    return JSON.parse(await fs.readFile(relationsFile, 'utf8')) as RelationConfigMap;
  }

  // Reads all cached contracts for given deployment into a map
  private async getCachedContracts(): Promise<BuildMap> {
    return objectToMap(Object.fromEntries(
      await Promise.all(
        (
          await fs.readdir(this.cacheDir())
        ).map(async (file) => {
          let address = readAddressFromFilename(file);
          return [address, await this.readBuildFileFromCache(address)];
        })
      )
    ));
  }

  // Reads all cached aliases for given deployment into a map
  private async getCachedAliases(): Promise<AliasesMap> {
    return objectToMap(await this.readCache<{string: string[]}>(this.pointersFile()));
  }

  // Reads the cached proxy map for a given deployment into a map
  private async getCachedProxies(): Promise<ProxiesMap> {
    return objectToMap(await this.readCache<{string: string}>(this.proxiesFile()));
  }

  // Returns an ethers' wrapped contract from a given build file (based on its name and address)
  private getContractFromBuildFile(
    buildFile: BuildFile,
    signer: Signer,
    address: string
  ): [string, Contract] {
    let [contractName, metadata] = getPrimaryContract(buildFile);

    return [
      contractName,
      new this.hre.ethers.Contract(address, metadata.abi, signer),
    ];
  }

  // Builds ether contract wrappers around a map of contract metadata
  private async getContractsFromBuildMap(
    buildMap: BuildMap,
    aliasesMap: AliasesMap,
    proxiesMap: ProxiesMap
  ): Promise<ContractMap> {
    let contracts: ContractMap = {};
    let signer = this.signer ?? (await this.hre.ethers.getSigners())[0]; // TODO: Hmm? Hmm?

    for (let [address, buildFile] of buildMap[Symbol.iterator]()) {
      let impl = proxiesMap.get(address);
      if (impl) {
        buildFile = buildMap.get(impl);
        if (!buildFile) {
          throw new Error(`Missing build file for pointed to impl=${impl} from proxy=${address}`);
        }
      }
      let [name, contract] = this.getContractFromBuildFile(buildFile, signer, address);
      if (aliasesMap.has(address)) {
        aliasesMap.get(address).forEach((alias) => (contracts[alias] = contract));
      } else {
        contracts[name] = contract;
      }
    }

    return contracts;
  }

  // Builds a pointer map from aliases to addresses
  private async getPointersFromBuildMap(
    buildMap: BuildMap,
    aliasesMap: AliasesMap
  ): Promise<PointersMap> {
    let pointers: PointersMap = new Map();

    for (let [address, buildFile] of buildMap) {
      const [contractName, metadata] = getPrimaryContract(buildFile);
      if (aliasesMap.has(address)) {
        aliasesMap.get(address).forEach((alias) => (pointers.set(alias, address)));
      } else {
        pointers.set(contractName, address);
      }
    }

    return pointers;
  }

  // Deploys a contract given a build file (e.g. something imported or spidered)
  private async deployFromBuildFile(buildFile: BuildFile, deployArgs: any[]): Promise<Contract> {
    let [contractName, metadata] = getPrimaryContract(buildFile);
    const [signer] = await this.hre.ethers.getSigners(); // TODO: Hmm?
    const contractFactory = new this.hre.ethers.ContractFactory(metadata.abi, metadata.bin, signer);
    const contract = await contractFactory.deploy(...deployArgs);
    return await contract.deployed();
  }

  // Builds ether contract wrappers around a map of contract metadata and merges into `this.contracts` variable
  private async loadContractsFromBuildMap(
    buildMap: BuildMap,
    aliasesMap: AliasesMap,
    proxiesMap: ProxiesMap
  ): Promise<ContractMap> {
    let newContracts = await this.getContractsFromBuildMap(buildMap, aliasesMap, proxiesMap);
    this.contracts = mergeContracts(this.contracts, newContracts);
    return newContracts;
  }

  // Reads a contract if exists in cache, otherwise attempts to import contract by address
  private async readOrImportContract(address: Address): Promise<BuildFile> {
    if (await this.cacheFileExists(this.cacheBuildFile(address))) {
      return await this.readBuildFileFromCache(address);
    } else {
      return await this.importContract(address, this.importRetries());
    }
  }

  // Adds an alias for an address to the aliases map.
  private addAlias(alias: string, address: Address, aliases: AliasesMap) {
    if (alias) {
      if (aliases.has(address)) {
        let existingAliases = aliases.get(address);
        aliases.set(address, existingAliases.concat([alias]));
      } else {
        aliases.set(address, [alias]);
      }
    }
  }

  // Tail-call optimized version of spider method, which crawls a dependency graph gathering contract data
  private async runSpider(
    relationConfigMap: RelationConfigMap,
    discovered: Address[],
    visited: BuildMap,
    aliases: AliasesMap,
    proxies: ProxiesMap
  ): Promise<[BuildMap, AliasesMap, ProxiesMap]> {
    if (discovered.length === 0) {
      return [visited, aliases, proxies];
    }

    let address = discovered.shift();

    if (address !== '0x0000000000000000000000000000000000000000') {
      const buildFile = await this.readOrImportContract(address);

      const [contractName, contractMetadata] = getPrimaryContract(buildFile);

      visited.set(address, buildFile);

      let relationConfig = relationConfigMap[contractName];
      if (relationConfig) {
        let baseContract = new this.hre.ethers.Contract(
          address,
          contractMetadata.abi,
          this.hre.ethers.provider
        );

        let implContractName: string | null = null;
        let implContractMetadata: ContractMetadata | null = null;
        if (relationConfig.implementation) {
          let [implAddress] = await getRelations(baseContract, relationConfig.implementation);
          proxies.set(address, implAddress);

          let implBuildFile: BuildFile;
          if (visited[implAddress]) {
            implBuildFile = visited[implAddress];
          } else {
            implBuildFile = await this.readOrImportContract(implAddress);
            visited.set(implAddress, implBuildFile);
          }

          [implContractName, implContractMetadata] = getPrimaryContract(implBuildFile);
        }

        let contract = new this.hre.ethers.Contract(
          address,
          implContractMetadata ? implContractMetadata.abi : contractMetadata.abi,
          this.hre.ethers.provider
        );

        let alias = await getAlias(contract, contractMetadata, relationConfig.alias);
        this.addAlias(alias, address, aliases);

        // If there is an impl contract, add its alias as well.
        if (implContractMetadata && relationConfigMap[implContractName]) {
          let alias = await getAlias(
            contract,
            implContractMetadata,
            relationConfigMap[implContractName].alias
          );
          this.addAlias(alias, implContractMetadata.address, aliases);
        }

        let relations = relationConfig.relations ?? [];
        let relatedAddresses = await Promise.all(
          relations.map((relation) => getRelations(contract, relation))
        );

        discovered.push(...relatedAddresses.flat().filter((address) => !visited.has(address)));
      }
    }

    return await this.runSpider(relationConfigMap, discovered, visited, aliases, proxies);
  }

  // Wrapper for pulling contract data from Etherscan
  private async importContract(address: Address, retries: number): Promise<BuildFile> {
    let buildFile;
    try {
      buildFile = (await loadContract('etherscan', this.deployment, address)) as BuildFile;
    } catch (e) {
      if (retries === 0) {
        throw e;
      }

      await new Promise((resolve) => setTimeout(resolve, this.importRetryDelay()));
      return await this.importContract(address, retries - 1);
    }

    let cacheBuildFile = this.cacheBuildFile(address);
    await this.writeObjectToCache(buildFile, cacheBuildFile);

    return buildFile;
  }

  private async withDeployment<T>(
    deployment: string | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    let originalDeployment = this.deployment;
    if (deployment) {
      this.deployment = deployment;
    }

    try {
      return await fn();
    } finally {
      if (deployment) {
        this.deployment = originalDeployment;
      }
    }
  }

  /**
   * Runs Spider method to pull full contract configuration from base roots using relation metadata.
   */
  async spider(): Promise<ContractMap> {
    let nodes = Object.values(await this.getRoots());
    let relationConfig = await this.getRelationConfig();
    let [buildMap, aliasesMap, proxiesMap] = await this.runSpider(
      relationConfig,
      nodes,
      new Map(),
      new Map(),
      new Map()
    );

    let pointers = await this.getPointersFromBuildMap(buildMap, aliasesMap);
    await this.writeObjectToCache(objectFromMap(pointers), this.pointersFile());
    await this.writeObjectToCache(objectFromMap(proxiesMap), this.proxiesFile());

    return await this.loadContractsFromBuildMap(buildMap, aliasesMap, proxiesMap);
  }

  /**
   * Imports a contract from remote, e.g. Etherscan, generating local build file.
   */
  async import(address: Address, deployment?: string): Promise<BuildFile> {
    return await this.withDeployment(deployment, async () => {
      return await this.readOrImportContract(address);
    });
  }

  /**
   * Deploy a new contract from a build file, e.g. something imported or crawled
   */
  async deployBuild(buildFile: BuildFile, deployArgs: any[]): Promise<Contract> {
    return this.deployFromBuildFile(buildFile, deployArgs);
  }

  /**
   * Gets contracts exclusively from cache.
   */
  async getContracts(): Promise<ContractMap> {
    let buildMap = await this.getCachedContracts();
    let aliasesMap = await this.getCachedAliases();
    let proxiesMap = await this.getCachedProxies();
    return await this.loadContractsFromBuildMap(buildMap, aliasesMap, proxiesMap);
  }

  /**
   * Write roots file to file cache or memory
   */
  async setRoots(roots: Roots): Promise<void> {
    await this.writeObjectToCache(roots, this.rootsFile());
  }

  connect(signer: Signer) {
    this.signer = signer;

    Object.entries(this.contracts).forEach(([key, contract]) => {
      this.contracts[key] = contract.connect(signer);
    });
  }

  /**
   * Registers a contract as if it had been discovered via spider
   */
  async deploy<
    C extends Contract,
    Factory extends Deployer<C, DeployArgs>,
    DeployArgs extends Array<any>
  >(contractFile: string, deployArgs: DeployArgs, connect?: Signer): Promise<C> {
    // TODO: Handle aliases, etc.
    let contractFileName = contractFile.split('/').reverse()[0];
    let contractName = contractFileName.replace('.sol', '');
    let factory: Factory = (await this.hre.ethers.getContractFactory(
      contractName
    )) as unknown as Factory;
    if (connect) {
      factory = factory.connect(connect);
    }
    let contract = await factory.deploy(...deployArgs);
    await contract.deployed();

    // We should be able to get the artifact, even if it's going to be a little hacky
    // TODO: Check sub-pathed files
    let debugFile = path.join(
      process.cwd(),
      'artifacts',
      'contracts',
      contractFile,
      contractFileName.replace('.sol', '.dbg.json')
    );
    let { buildInfo } = JSON.parse(await fs.readFile(debugFile, 'utf8')) as { buildInfo: string };
    let { output: buildFile } = JSON.parse(
      await fs.readFile(path.join(debugFile, '..', buildInfo), 'utf8')
    ) as { output: BuildFile };

    if (!buildFile.contract) {
      buildFile.contract = contractName;
    }
    let cacheBuildFile = this.cacheBuildFile(contract.address);
    await this.writeObjectToCache(buildFile, cacheBuildFile);

    return contract;
  }
}
