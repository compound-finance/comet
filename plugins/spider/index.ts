import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract, Signer } from 'ethers';
import { Address, Relations, createRelations } from './relation';
import * as path from 'path';
import * as fs from 'fs';

/**
 * PROOF OF CONCEPT CRAWLER FOR COMPOUND V2 CONTRACTS.
 * 
 * Can be easily adapted for Comet or any other system of contracts by
 * modifying the createRelations() method in `tasks/spider/relation.ts`.
 */

// A node within the contract dependency tree.
export interface ContractNode {
  name: string,
  contractName: string,
  abi: string,
  address: Address,
  children: ContractNode[],
}

export type ContractMap = {[name: string]: Contract};

async function getRootsForDeployment(network: string) {
  const configDir = path.join(__dirname, '..', '..', 'deployments', network);
  const rootsFile = path.join(configDir, 'roots.json');
  const roots = JSON.parse(await fs.promises.readFile(rootsFile, 'utf-8'));
  console.log('Reading roots.js: ' + JSON.stringify(roots));
  return roots;
}

export async function getEthersContractsForDeployment(
  hre: HardhatRuntimeEnvironment,
  deploymentName: string
): Promise<ContractMap> {
  const roots = await getRootsForDeployment(deploymentName);
  const relations = await createRelations(deploymentName);
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

export async function pullConfigs(hre: HardhatRuntimeEnvironment) {
  const network = hre.network.name;
  const roots = await getRootsForDeployment(network);
  const relations = await createRelations(network);
  let visited = new Map<Address, string>(); // mapping from address to contract name
  let proxies = new Map<Address, Address>();
  // Start branching out from each root contract.
  let config = {};
  for (let contractName in roots) {
    let address = roots[contractName];
    let rootNode = await expand(network, hre, relations, address, contractName, visited, proxies);
    mergeConfig(config, rootNode);
  }
  // Write config to file
  const configDir = path.join(__dirname, '..', '..', 'deployments', network);
  let configFile = path.join(configDir, 'config.json');
  await fs.promises.writeFile(configFile, JSON.stringify(config, null, 4));

  // Write proxies to file
  const proxiesFile = path.join(configDir, "proxies.json");
  await fs.promises.writeFile(proxiesFile, JSON.stringify(proxies, null, 4));
}

function mergeConfig(config, rootNode: ContractNode) {
  let contractName = rootNode.contractName;
  // TODO: Naming of contracts could be better.
  if (rootNode.name.toLowerCase() !== rootNode.contractName.toLowerCase()) {
    contractName = rootNode.name + rootNode.contractName;
  }
  config[contractName] = rootNode.address;
  for (let child of rootNode.children) {
    mergeConfig(config, child);
  }
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

// Loads a contract's config by reading it from cache or pulling it from Etherscan if it does not exist.
// TODO: Have an command-line argument to override all cached configs.
async function loadContractConfig(
  network: string,
  hre: HardhatRuntimeEnvironment,
  address: Address
) {
  if (address === '0x0000000000000000000000000000000000000000') {
    throw "Spider Error: loading zero address";
  }

  const outdir = path.join(__dirname, '..', '..', 'deployments', network, 'cache');
  const outfile = path.join(outdir, `${address}.json`);
  return await fs.promises.readFile(outfile, 'utf-8') // fsStat
    .then((config) => JSON.parse(config))
    // Hardhat-import plugin (fork of Saddle import)
    .catch(async () => await hre.run('import', { address, outdir }));
}
