import * as path from 'path';
import * as fs from 'fs/promises';

import { Contract } from 'ethers';
import fs from 'fs';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import * as path from 'path';

/**
 * Types, interfaces, and functions used to define relationships between contracts.
 *
 * The relations defined are used by the Spider script to crawl contracts and pull
 * their configs directly from the blockchain. The relations can be modified in the
 * `creatRelations()` function.
 *
 */
export interface Relation {
  relations?: (contract: Contract) => Promise<Address[]>;
  implementation?: (contract: Contract) => Promise<Address>;
}

export interface Relations {
  [contractName: string]: Relation;
}

export interface RelationConfig {
  [contractName: string]: {
    relations?: (contract: Contract) => Promise<string[]>;
    implementation?: (contract: Contract) => Promise<string>;
  }
}

interface DeploymentConfig {
  baseDir?: string;
}

type Address = string;
type Roots = { [contractName: string]: Address };

interface ContractMetadata {
  address: Address,
  name: string,
  abi: string,
  bin: string,
  metadata: string
};

interface BuildFile {
  contracts: {[fileContractName: string]: ContractMetadata}
  version: string
}

export interface ContractNode {
  name: string,
  contractName: string,
  abi: string,
  address: Address,
  children: ContractNode[],
}

export type ContractMap = {[name: string]: Contract};

function buildContractMap(
  hre: HardhatRuntimeEnvironment,
  admin: Signer,
  contractMap: ContractMap,
  rootNode: ContractNode
) {
  let contractName = rootNode.contractName;
  // TODO: Naming of contracts could be better.
  if (rootNode.name.toLowerCase() !== rootNode.contractName.toLowerCase()) {
    contractName = rootNode.name + rootNode.contractName;
  }
  contractMap[contractName] = new hre.ethers.Contract(
    rootNode.address,
    rootNode.abi,
    admin
  );
  for (let child of rootNode.children) {
    buildContractMap(hre, admin, contractMap, child);
  }
}

async function asAddress(contract: Contract, fnName: string): Promise<Address> {
  let fn = contract.functions[fnName];
  if (!fn) {
    throw new Error(`Cannot find contract function ${contract.name}.${fnName}()`);
  }
  let val = await fn();

  if (typeof(val) === 'string') {
    return val;
  } else if (Array.isArray(val)) {
    if typeof(val[0] === 'string') {
      return val[0];
    }
  }

  throw new Error(`Unable to coerce contract value ${contract.name}.${fnName}()=\`${a}\` to address`);
}

class DeploymentManager {
  deployment: string;
  config: DeploymentConfig;

  constructor(deployment: string, config: DeploymentConfig = {}) {
    this.deployment = deployment;
    this.config = config;
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

  private async getRelationConfig(): Promise<RelationConfig> {
    return JSON.parse(await fs.readFile(this.relationsFile(), 'utf8')) as RelationConfig;
  }

  async getEthersContractsForDeployment(hre: HardhatRuntimeEnvironment): Promise<ContractMap> {
    const roots = await this.getRoots();
    const relations = await this.createRelations();

    let visited = new Map<Address, string>(); // mapping from address to contract name
    let proxies = new Map<Address, Address>();
    let contractMap: ContractMap = {};

    const [admin] = await hre.ethers.getSigners();
    for (let contractName in roots) {
      let address = roots[contractName];
      let rootNode = await expand(deploymentName, hre, relations, address, contractName, visited, proxies);
      buildContractMap(hre, admin, contractMap, rootNode);
    }
    return contractMap;
  }

  // TODO: Consider abstracting this even more (Hardhat plugin?) so separate relations
  // can be defined in one repo. (e.g. different relations on each chain)
  async createRelations(): Promise<Relations> {
    let relationConfig = this.getRelationConfig();
    let relationsOutput: Relations = {};

    for (let [contractName, {relations, implementation}] of Object.entries(relationConfig)) {
      relationsOutput[contractName] = {};

      if (implementation) {
        relationsOutput[contractName].implementation = (contract: Contract) => asAddress(contract, implementation);
      }

      if (relations) {
        relationsOutput[contractName].relations = async (contract: Contract) => {
          let addresses: Address[] = await Promise.all(relations.map((relation) => asAddress(contract, relation)));
          return addresses.flat()
        }
      }
    }

    return relationsOutput;
  }

  private async wrapTree() {
    // As this walks the tree from root, it's collecting known nodes
    // 
  }

    // DFS expansion starting from root contract.
// TODO: Short-circuit function if address has already been visited. Though some CTokens share the same Delegator contract.
// TODO: Need to think about merging implementation ABIs to proxies.
async function expand(
  network: string,
  hre: HardhatRuntimeEnvironment,
  relations: Relations,
  address: Address,
  name: string,
  visited: Map<Address, string>,
  // Proxy to impl
  proxies: Map<Address, Address>,
  currentProxy?: Address
): Promise<ContractNode> {
  if (address === '0x0000000000000000000000000000000000000000') return null;

  const loadedContract = await loadContractConfig(network, hre, address);
  const key = Object.keys(loadedContract.contracts)[0]; // TODO: assert contracts length is 1
  const abi = loadedContract.contracts[key].abi;
  const contractName = loadedContract.contracts[key].name;
  let contract = new hre.ethers.Contract(
    currentProxy ?? address,
    abi,
    hre.ethers.provider
  );
  visited.set(address, contractName);

  // This is only used to better label ERC20 tokens.
  if (typeof contract.symbol === 'function') {
    const symbol = await contract.symbol();
    name = symbol ? symbol : name;
  }

  let children = [];
  // Iterate through dependencies if contract has any relations.
  if (contractName in relations) {
    const relation = relations[contractName];
    let dependencies: Address[], implementation: Address;
    [dependencies, implementation] = await Promise.all([
      relations[contractName].relations
        ? relations[contractName].relations(contract)
        : null,
      relations[contractName].implementation
        ? relations[contractName].implementation(contract)
        : null,
    ]);
    if (implementation) {
      proxies[address] = implementation;
      const newChild = await expand(
        network,
        hre,
        relations,
        implementation,
        name,
        visited,
        proxies,
        address
      );
      if (newChild) {
        children.push(newChild);
      }
    }
    if (dependencies) {
      for (let addr of dependencies) {
        const newChild = await expand(
          network,
          hre,
          relations,
          addr,
          name,
          visited,
          proxies
        );
        if (newChild) {
          children.push(newChild);
        }
      }
    }
  }

  return { name, contractName, address, abi, children };
}
  }

  /**
   * Pulls known contracts from
   */
  async load(): Promise<void> {
    
  }

  /**
   * Pulls known contracts from
   */
  async deploy(): Promise<void> {

  }

  /**
   * Import
   */
  async spider(): Promise<void> {

  }

  async import(): Promise<void> {

  }


}