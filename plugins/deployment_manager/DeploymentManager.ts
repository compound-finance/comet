import * as path from 'path';
import * as fs from 'fs/promises';

import { Contract } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Address, ContractMetadata, BuildFile, ContractMap, BuildMap } from './Types';
export { ContractMap } from './Types';
import { getPrimaryContract, getRelation, fileExists, readAddressFromFilename } from './Utils';

export interface ProxyAddress {
  address: Address,
  proxy: Address | null
}

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
  writeImports?: boolean;
}

export class DeploymentManager {
  deployment: string;
  hre: HardhatRuntimeEnvironment;
  config: DeploymentConfig;

  constructor(deployment: string, hre: HardhatRuntimeEnvironment, config: DeploymentConfig = {}) {
    this.deployment = deployment;
    this.hre = hre;
    this.config = config;
  }

  private importRetries(): number {
    return this.config.importRetries ?? 10;
  }

  private importRetryDelay(): number {
    return this.config.importRetryDelay ?? 2000;
  }

  private baseDir(): string {
    return this.config.baseDir || process.cwd();
  }

  private deploymentDir(): string {
    return path.join(this.baseDir(), this.deployment);
  }

  private cacheDir(): string {
    return path.join(this.deploymentDir(), 'cache');
  }

  private pointersFile(): string {
    return path.join(this.deploymentDir(), 'pointers.json');
  }

  private relationsFile(): string {
    return path.join(this.deploymentDir(), 'relations.json');
  }

  private rootsFile(): string {
    return path.join(this.deploymentDir(), 'roots.json');
  }

  private cacheBuildFile(address: Address): string {
    return path.join(this.cacheDir(), `${address.toLowerCase()}.json`);
  }

  private async readBuildFileFromCache(address: Address): Promise<BuildFile> {
    let cacheBuildFile = this.cacheBuildFile(address);
    return JSON.parse(await fs.readFile(cacheBuildFile, 'utf8')) as BuildFile;
  }

  private async writeBuildFileToCache(address: Address, buildFile: BuildFile): Promise<void> {
    let cacheBuildFile = this.cacheBuildFile(address);
    await fs.writeFile(cacheBuildFile, JSON.stringify(buildFile));
  }

  private async getRoots(): Promise<Roots> {
    return JSON.parse(await fs.readFile(this.rootsFile(), 'utf8')) as Roots;
  }

  private async getRelationConfig(): Promise<RelationConfigMap> {
    return JSON.parse(await fs.readFile(this.relationsFile(), 'utf8')) as RelationConfigMap;
  }

  private async getCachedContracts(): Promise<BuildMap> {
    return Object.fromEntries(await Promise.all((await fs.readdir(this.cacheDir())).map(async (file) => {
      let address = readAddressFromFilename(file);
      return [address, await this.readBuildFileFromCache(address)]
    })));
  }

  private async getContractsFromBuildMap(buildMap: BuildMap): Promise<ContractMap> {
    let contracts: ContractMap = {};
    const [ signer ] = await this.hre.ethers.getSigners(); // TODO: Hmm?

    for (let [address, buildFile] of Object.entries(buildMap)) {
      contracts[buildFile.name] = new this.hre.ethers.Contract(
        buildFile.address,
        buildFile.abi,
        signer,
      );
    }

    return contracts;
  }

  private async readOrImportContract(address: Address): Promise<BuildFile> {
    if (await fileExists(this.cacheBuildFile(address))) {
      return await this.readBuildFileFromCache(address);
    } else {
      return await this.importContract(address, this.importRetries());
    }
  }

  private async runSpider(relationConfigMap: RelationConfigMap, discovered: ProxyAddress[], visited: BuildMap): Promise<BuildMap> {
    if (discovered.length === 0) {
      return visited;
    }

    let { address, proxy } = discovered.shift();

    // if (address === '0x0000000000000000000000000000000000000000') { // TODO?

    const buildFile = await this.readOrImportContract(address);

    const { name, abi } = getPrimaryContract(buildFile);

    let contract = new this.hre.ethers.Contract(
      proxy ?? address,
      abi,
      this.hre.ethers.provider
    );

    visited.set(address, buildFile);

    // TODO: Allow aliasing, e.g. `.symbol`

    let relationConfig = relationConfigMap[name];
    if (relationConfig) {
      let relations = relationConfig.relations ?? [];
      let relatedAddresses = await Promise.all(relations.map((relation) => getRelation(contract, relation)));
      let newNodes = relatedAddresses.map((address) => ({ address, proxy: null }));

      if (relationConfig.implementation) {
        let implementationAddress = await getRelation(contract, relationConfig.implementation);

        newNodes.push({
          address: implementationAddress,
          proxy: address
        });
      }

      newNodes.filter(({address}) => !visited.has(address))
      discovered.push(...newNodes);
    }

    return await this.runSpider(relationConfigMap, discovered, visited);
  }

  private async importContract(address: Address, retries: number): Promise<BuildFile> {
    let buildFile;
    try {
      buildFile = (await this.hre.run('import', { address })) as BuildFile;
    } catch (e) {
      if (retries === 0) {
        throw e;
      }

      await new Promise(resolve => setTimeout(resolve, this.importRetryDelay()));
      return await this.importContract(address, retries - 1);
    }

    if (this.config.writeImports === true) {
      await this.writeBuildFileToCache(address, buildFile);
    }
    return buildFile;
  }

  /**
    * Runs Spider method to pull full contract configuration from base roots using relation metadata.
    */
  async spider(): Promise<ContractMap> {
    let nodes = Object.values(await this.getRoots()).map((root: string): ProxyAddress => {
      return {
        address: root,
        proxy: null
      };
    });

    let buildMap = await this.runSpider(await this.getRelationConfig(), nodes, new Map());

    return await this.getContractsFromBuildMap(buildMap);
  }

  /**
    * Imports a contract from remote, e.g. Etherscan, generating local build file
    */
  async import(address: Address): Promise<BuildFile> {
    return await this.importContract(address, this.importRetries());
  }

  /**
    * Loads contracts from 
    */
  async loadContracts(): Promise<ContractMap> {
    let buildMap = await this.getCachedContracts();
    return await this.getContractsFromBuildMap(buildMap);
  }
}
