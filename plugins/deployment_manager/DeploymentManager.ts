import * as path from 'path';
import * as fs from 'fs/promises';

import { Contract } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Address, ContractMetadata, BuildFile, ContractMap, BuildMap } from './Types';
export { ContractMap } from './Types';
import { getPrimaryContract, getImplementation, getRelations, fileExists, mergeContracts, readAddressFromFilename } from './Utils';

type Roots = { [contractName: string]: Address };

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
  memoryImports?: boolean;
}

export class DeploymentManager {
  deployment: string;
  hre: HardhatRuntimeEnvironment;
  config: DeploymentConfig;
  contracts: ContractMap;

  constructor(deployment: string, hre: HardhatRuntimeEnvironment, config: DeploymentConfig = {}) {
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
  private async writeBuildFileToCache(address: Address, buildFile: BuildFile): Promise<void> {
    if (!(await fileExists(this.cacheDir()))) {
      await fs.mkdir(this.cacheDir());
    }

    let cacheBuildFile = this.cacheBuildFile(address);
    await fs.writeFile(cacheBuildFile, JSON.stringify(buildFile));
  }

  // Read root information for given deployment
  private async getRoots(): Promise<Roots> {
    return JSON.parse(await fs.readFile(this.rootsFile(), 'utf8')) as Roots;
  }

  // Read relation configuration for given deployment
  private async getRelationConfig(): Promise<RelationConfigMap> {
    return JSON.parse(await fs.readFile(this.relationsFile(), 'utf8')) as RelationConfigMap;
  }

  // Reads all cached contracts for given deployment into a map
  private async getCachedContracts(): Promise<BuildMap> {
    return Object.fromEntries(await Promise.all((await fs.readdir(this.cacheDir())).map(async (file) => {
      let address = readAddressFromFilename(file);
      return [address, await this.readBuildFileFromCache(address)]
    })));
  }

  // Builds ether contract wrappers around a map of contract metadata
  private async getContractsFromBuildMap(buildMap: BuildMap): Promise<ContractMap> {
    let contracts: ContractMap = {};
    const [ signer ] = await this.hre.ethers.getSigners(); // TODO: Hmm?

    for (let [address, buildFile] of buildMap) {
      let metadata = getPrimaryContract(buildFile);
      contracts[metadata.name] = new this.hre.ethers.Contract(
        metadata.address,
        metadata.abi,
        signer,
      );
    }

    return contracts;
  }

  // Builds ether contract wrappers around a map of contract metadata and merges into `this.contracts` variable
  private async loadContractsFromBuildMap(buildMap: BuildMap): Promise<ContractMap> {
    let newContracts = await this.getContractsFromBuildMap(buildMap);
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

  // Tail-call optimized version of spider method, which crawls a dependency graph gathering contract data
  private async runSpider(relationConfigMap: RelationConfigMap, discovered: Address[], visited: BuildMap): Promise<BuildMap> {
    if (discovered.length === 0) {
      return visited;
    }

    let address = discovered.shift();

    if (address !== '0x0000000000000000000000000000000000000000') {
      const buildFile = await this.readOrImportContract(address);

      const { name, abi } = getPrimaryContract(buildFile);

      visited.set(address, buildFile);

      // TODO: Allow aliasing, e.g. `.symbol`

      let relationConfig = relationConfigMap[name];
      if (relationConfig) {
        let maybeProxyABI = abi;

        let baseContract = new this.hre.ethers.Contract(
          address,
          abi,
          this.hre.ethers.provider
        );

        if (relationConfig.implementation) {
          let implementationAddress = await getImplementation(baseContract, relationConfig.implementation);

          let implBuildFile: BuildFile;
          if (visited[implementationAddress]) {
            implBuildFile = visited[implementationAddress];
          } else {
            implBuildFile = await this.readOrImportContract(implementationAddress);
            visited.set(implementationAddress, implBuildFile);
          }

          maybeProxyABI = getPrimaryContract(implBuildFile).abi;
        }

        let contract = new this.hre.ethers.Contract(
          address,
          maybeProxyABI,
          this.hre.ethers.provider
        );

        let relations = relationConfig.relations ?? [];
        let relatedAddresses = await Promise.all(relations.flatMap((relation) => getRelations(contract, relation)));

        discovered.push(...relatedAddresses.flat().filter((address) => !visited.has(address)));
      }
    }

    return await this.runSpider(relationConfigMap, discovered, visited);
  }

  // Wrapper for pulling contract data from Etherscan
  private async importContract(address: Address, retries: number): Promise<BuildFile> {
    let buildFile;
    try {
      buildFile = (await this.hre.run('import', { address, networkNameOverride: this.deployment })) as BuildFile;
    } catch (e) {
      if (retries === 0) {
        throw e;
      }

      await new Promise(resolve => setTimeout(resolve, this.importRetryDelay()));
      return await this.importContract(address, retries - 1);
    }

    if (!this.config.memoryImports) {
      await this.writeBuildFileToCache(address, buildFile);
    }
    return buildFile;
  }

  /**
    * Runs Spider method to pull full contract configuration from base roots using relation metadata.
    */
  async spider(): Promise<ContractMap> {
    let nodes = Object.values(await this.getRoots());
    let buildMap = await this.runSpider(await this.getRelationConfig(), nodes, new Map());

    return await this.loadContractsFromBuildMap(buildMap);
  }

  /**
    * Imports a contract from remote, e.g. Etherscan, generating local build file.
    */
  async import(address: Address): Promise<BuildFile> {
    return await this.importContract(address, this.importRetries());
  }

  /**
    * Gets contracts exclusively from cache.
    */
  async getContracts(): Promise<ContractMap> {
    let buildMap = await this.getCachedContracts();
    return await this.loadContractsFromBuildMap(buildMap);
  }
}
