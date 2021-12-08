import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Address, Relations, createRelations } from './spider/relation';
import * as path from 'path';
import * as fs from 'fs';

/**
 * PROOF OF CONCEPT CRAWLER FOR COMPOUND V2 CONTRACTS.
 * 
 * Can be easily adapted for Comet or any other system of contracts by
 * modifying the createRelations() method in `scripts/spider/relation.ts`.
 */

// A node within the contract dependency tree.
interface ContractNode {
  name: string,
  contractName: string,
  // abi,
  address: Address,
  children: ContractNode[],
}

export async function pullConfigs(hre: HardhatRuntimeEnvironment) {
  const network = hre.network.name;
  const configDir = path.join(__dirname, '..', 'deployments', network);
  const rootsFile = path.join(configDir, 'roots.json');
  const roots = JSON.parse(await fs.promises.readFile(rootsFile, 'utf-8'));
  console.log('Reading roots.js: ' + JSON.stringify(roots));
  const relations = createRelations();
  let visited = new Map<Address, string>(); // mapping from address to contract name
  // Start branching out from each root contract.
  let config = {};
  for (let contractName in roots) {
    let address = roots[contractName];
    let rootNode = await expand(hre, relations, address, contractName, visited);
    mergeConfig(config, rootNode);
  }
  // Write config to file
  let configFile = path.join(configDir, 'config.json');
  await fs.promises.writeFile(configFile, JSON.stringify(config, null, 4));
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
async function expand(hre: HardhatRuntimeEnvironment, relations: Relations, address: Address, name: string, visited: Map<Address, string>): Promise<ContractNode> {
  const loadedContract = await loadContractConfig(hre, address);
  const key = Object.keys(loadedContract.contracts)[0]; // TODO: assert contracts length is 1
  const abi = loadedContract.contracts[key].abi;
  const contractName = loadedContract.contracts[key].name;
  const provider = new hre.ethers.providers.InfuraProvider;
  let contract = new hre.ethers.Contract(address, abi, provider);
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
    // If contract has proxy, set the proxy as the contract to read from.
    if (relation.proxy) {
      const proxyAddr = findAddressByName(relation.proxy, visited); // The proxy should always exist in the map already.
      contract = new hre.ethers.Contract(proxyAddr, abi, provider);
    }
    const dependencies: Address[] = await relations[contractName].relations(contract);
    for (let addr of dependencies) {
      children.push(await expand(hre, relations, addr, name, visited));
    }
  }

  return { name, contractName, address, children };
}

// Loads a contract's config by reading it from cache or pulling it from Etherscan if it does not exist.
// TODO: Have an command-line argument to override all cached configs.
async function loadContractConfig(hre: HardhatRuntimeEnvironment, address: Address) {
  const network = hre.network.name;
  const outdir = path.join(__dirname, '..', 'deployments', network, 'cache');
  // Hardhat-import plugin (fork of Saddle import)
  const outfile = path.join(outdir, `${address}.json`);
  return await fs.promises.readFile(outfile, 'utf-8')
    .then((config) => JSON.parse(config))
    .catch(async () => await hre.run('import', { address, outdir }));
}

function findAddressByName(name: string, addressesToName: Map<Address, string>): Address {
  for (let [k, v] of addressesToName) {
    if (v === name) return k;
  }
  throw new Error('Spider Error: Cannot find contract address by name.');
}