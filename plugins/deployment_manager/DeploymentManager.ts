import * as path from 'path';
import * as fs from 'fs/promises';

import { Contract, Signer } from 'ethers';
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
} from './Utils';

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

  constructor(
    deployment: string,
    hre: HardhatRuntimeEnvironment,
    config: DeploymentConfig = {}
  ) {
    this.deployment = deployment;
    this.hre = hre;
    this.config = config;
    this.contracts = {};
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

  // File to store pointers in, e.g. `$pwd/deployments/$network/proxies.json`
  private proxiesFile(): string {
    return path.join(this.deploymentDir(), 'proxies.json');
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

  // Write contract metadata from file cache
  private async readBuildFileFromCache(address: Address): Promise<BuildFile> {
    let cacheBuildFile = this.cacheBuildFile(address);
    return JSON.parse(await fs.readFile(cacheBuildFile, 'utf8')) as BuildFile;
  }

  // Write a contract metadata to file cache
  private async writeBuildFileToCache(
    address: Address,
    buildFile: BuildFile
  ): Promise<void> {
    if (!(await fileExists(this.cacheDir()))) {
      await fs.mkdir(this.cacheDir());
    }

    let cacheBuildFile = this.cacheBuildFile(address);
    await fs.writeFile(cacheBuildFile, JSON.stringify(buildFile, null, 4));
  }

  // Write a pointers map to file cache
  private async writePointersFileToCache(pointers: PointersMap): Promise<void> {
    if (!(await fileExists(this.cacheDir()))) {
      await fs.mkdir(this.cacheDir());
    }

    let pointersFile = this.pointersFile();
    await fs.writeFile(pointersFile, JSON.stringify(pointers, null, 4));
  }

  // Write a proxies map to file cache
  private async writeProxiesFileToCache(proxies: ProxiesMap): Promise<void> {
    if (!(await fileExists(this.cacheDir()))) {
      await fs.mkdir(this.cacheDir());
    }

    let proxiesFile = this.proxiesFile();
    await fs.writeFile(proxiesFile, JSON.stringify(proxies, null, 4));
  }

  // Read root information for given deployment
  private async getRoots(): Promise<Roots> {
    return JSON.parse(await fs.readFile(this.rootsFile(), 'utf8')) as Roots;
  }

  // Read relation configuration for given deployment
  private async getRelationConfig(): Promise<RelationConfigMap> {
    return JSON.parse(
      await fs.readFile(this.relationsFile(), 'utf8')
    ) as RelationConfigMap;
  }

  // Reads all cached contracts for given deployment into a map
  private async getCachedContracts(): Promise<BuildMap> {
    return Object.fromEntries(
      await Promise.all(
        (
          await fs.readdir(this.cacheDir())
        ).map(async (file) => {
          let address = readAddressFromFilename(file);
          return [address, await this.readBuildFileFromCache(address)];
        })
      )
    );
  }

  // Reads all cached aliases for given deployment into a map
  private async getCachedAliases(): Promise<AliasesMap> {
    // TODO: Can read aliases from `pointers.json`.
    return new Map();
  }

  // Reads the cached proxy map for a given deployment into a map
  private async getCachedProxies(): Promise<ProxiesMap> {
    return JSON.parse(await fs.readFile(this.proxiesFile(), 'utf8')) as ProxiesMap;
  }

  // Builds a pointer map from aliases to addresses
  private async getPointersFromBuildMap(
    buildMap: BuildMap,
    aliasesMap: AliasesMap
  ): Promise<PointersMap> {
    let pointers: PointersMap = {};

    for (let [address, buildFile] of buildMap) {
      const metadata = getPrimaryContract(buildFile);
      if (aliasesMap.has(metadata.address)) {
        aliasesMap
          .get(metadata.address)
          .forEach((alias) => (pointers[alias] = metadata.address));
      } else {
        pointers[metadata.name] = metadata.address;
      }
    }

    return pointers;
  }

  // Returns an ethers' wrapped contract from a given build file (based on its name and address)
  private getContractFromBuildFile(
    buildFile: BuildFile,
    signer: Signer
  ): [string, Contract] {
    let metadata = getPrimaryContract(buildFile);
    return [
      metadata.name,
      new this.hre.ethers.Contract(metadata.address, metadata.abi, signer),
    ];
  }

  // Builds ether contract wrappers around a map of contract metadata
  private async getContractsFromBuildMap(
    buildMap: BuildMap,
    aliasesMap: AliasesMap
  ): Promise<ContractMap> {
    let contracts: ContractMap = {};
    const [signer] = await this.hre.ethers.getSigners(); // TODO: Hmm?

    for (let [address, buildFile] of buildMap) {
      let [name, contract] = this.getContractFromBuildFile(buildFile, signer);
      if (aliasesMap.has(address)) {
        aliasesMap
          .get(address)
          .forEach((alias) => (contracts[alias] = contract));
      } else {
        contracts[name] = contract;
      }
    }

    return contracts;
  }

  // Deploys a contract given a build file (e.g. something imported or spidered)
  private async deployFromBuildFile(
    buildFile: BuildFile,
    deployArgs: any[]
  ): Promise<Contract> {
    let metadata = getPrimaryContract(buildFile);
    const [signer] = await this.hre.ethers.getSigners(); // TODO: Hmm?
    const contractFactory = new this.hre.ethers.ContractFactory(
      metadata.abi,
      metadata.bin,
      signer
    );
    const contract = await contractFactory.deploy(...deployArgs);
    return await contract.deployed();
  }

  // Builds ether contract wrappers around a map of contract metadata and merges into `this.contracts` variable
  private async loadContractsFromBuildMap(
    buildMap: BuildMap,
    aliasesMap: AliasesMap
  ): Promise<ContractMap> {
    let newContracts = await this.getContractsFromBuildMap(
      buildMap,
      aliasesMap
    );
    this.contracts = mergeContracts(this.contracts, newContracts);
    return newContracts;
  }

  // Reads a contract if exists in cache, otherwise attempts to import contract by address
  private async readOrImportContract(address: Address): Promise<BuildFile> {
    if (await fileExists(this.cacheBuildFile(address))) {
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

      const contractMetadata = getPrimaryContract(buildFile);

      visited.set(address, buildFile);

      let relationConfig = relationConfigMap[contractMetadata.name];
      if (relationConfig) {
        let baseContract = new this.hre.ethers.Contract(
          address,
          contractMetadata.abi,
          this.hre.ethers.provider
        );

        // TODO: Consider using a Java-like Optional here?
        let implContractMetadata: ContractMetadata | null = null;
        if (relationConfig.implementation) {
          let [implAddress] = await getRelations(
            baseContract,
            relationConfig.implementation
          );
          proxies[address] = implAddress;

          let implBuildFile: BuildFile;
          if (visited[implAddress]) {
            implBuildFile = visited[implAddress];
          } else {
            implBuildFile = await this.readOrImportContract(implAddress);
            visited.set(implAddress, implBuildFile);
          }

          implContractMetadata = getPrimaryContract(implBuildFile);
        }

        let contract = new this.hre.ethers.Contract(
          address,
          implContractMetadata
            ? implContractMetadata.abi
            : contractMetadata.abi,
          this.hre.ethers.provider
        );

        let alias = await getAlias(
          contract,
          contractMetadata,
          relationConfig.alias
        );
        this.addAlias(alias, address, aliases);

        // If there is an impl contract, add its alias as well.
        if (
          implContractMetadata &&
          relationConfigMap[implContractMetadata.name]
        ) {
          let alias = await getAlias(
            contract,
            implContractMetadata,
            relationConfigMap[implContractMetadata.name].alias
          );
          this.addAlias(alias, implContractMetadata.address, aliases);
        }

        let relations = relationConfig.relations ?? [];
        let relatedAddresses = await Promise.all(
          relations.map((relation) => getRelations(contract, relation))
        );

        discovered.push(
          ...relatedAddresses.flat().filter((address) => !visited.has(address))
        );
      }
    }

    return await this.runSpider(
      relationConfigMap,
      discovered,
      visited,
      aliases,
      proxies
    );
  }

  // Wrapper for pulling contract data from Etherscan
  private async importContract(
    address: Address,
    retries: number
  ): Promise<BuildFile> {
    let buildFile;
    try {
      buildFile = (await loadContract(
        'etherscan',
        this.deployment,
        address
      )) as BuildFile;
    } catch (e) {
      if (retries === 0) {
        throw e;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, this.importRetryDelay())
      );
      return await this.importContract(address, retries - 1);
    }

    if (this.config.writeCacheToDisk) {
      await this.writeBuildFileToCache(address, buildFile);
    }
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
    let [buildMap, aliasesMap, proxiesMap] = await this.runSpider(
      await this.getRelationConfig(),
      nodes,
      new Map(),
      new Map(),
      new Map()
    );

    if (this.config.writeCacheToDisk) {
      let pointers = await this.getPointersFromBuildMap(buildMap, aliasesMap);
      await this.writePointersFileToCache(pointers);
      await this.writeProxiesFileToCache(proxiesMap);
    }

    return await this.loadContractsFromBuildMap(buildMap, aliasesMap);
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
  async deployBuild(
    buildFile: BuildFile,
    deployArgs: any[]
  ): Promise<Contract> {
    return this.deployFromBuildFile(buildFile, deployArgs);
  }

  /**
   * Gets contracts exclusively from cache.
   */
  async getContracts(): Promise<ContractMap> {
    let buildMap = await this.getCachedContracts();
    let aliasesMap = await this.getCachedAliases();
    return await this.loadContractsFromBuildMap(buildMap, aliasesMap);
  }

  /**
   * Write a roots file to file cache
   */
  async writeRootsFileToCache(roots: Roots): Promise<void> {
    if (!(await fileExists(this.cacheDir()))) {
      await fs.mkdir(this.cacheDir(), { recursive: true });
    }

    let rootsFile = this.rootsFile();
    await fs.writeFile(rootsFile, JSON.stringify(roots, null, 4));
  }
}
