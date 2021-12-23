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
  canonicalName: string,
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
    let rootNode = await expand({
      network: deploymentName,
      hre,
      relations,
      address,
      visited,
      proxies,
      writeToCache: false
    });
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
  let canonicalName = rootNode.canonicalName ? rootNode.canonicalName : rootNode.contractName;
  contractMap[canonicalName] = new hre.ethers.Contract(
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
  const roots :{string:string} = await getRootsForDeployment(network);
  const relations = await createRelations(network);
  let visited = new Map<Address, string>(); // mapping from address to contract name
  let proxies = new Map<Address, Address>();
  // Start branching out from each root contract.
  let config = {};
  await Promise.all(Object.entries(roots).map(async ([name, address]) => {
    const rootNode = await expand({network, hre, relations, address, visited, proxies});
    mergeConfig(config, rootNode);
  }));

  // Write config to file
  const configDir = path.join(__dirname, '..', '..', 'deployments', network);
  let configFile = path.join(configDir, 'pointers.json');
  await fs.promises.writeFile(configFile, JSON.stringify(config, null, 4));

  // Write proxies to file
  const proxiesFile = path.join(configDir, "proxies.json");
  await fs.promises.writeFile(proxiesFile, JSON.stringify(proxies, null, 4));
}

function mergeConfig(config, rootNode: ContractNode) {
  let canonicalName = rootNode.canonicalName ? rootNode.canonicalName : rootNode.contractName;
  config[canonicalName] = rootNode.address;
  for (let child of rootNode.children) {
    mergeConfig(config, child);
  }
}

// DFS expansion starting from root contract.
// TODO: Short-circuit function if address has already been visited. Though some CTokens share the same Delegator contract.
// TODO: Need to think about merging implementation ABIs to proxies.
interface ExpandParameters {
  network: string;
  hre: HardhatRuntimeEnvironment;
  relations: Relations;
  address: Address;
  visited: Map<Address, string>;
  // Proxy to impl
  proxies: Map<Address, Address>;
  currentProxy?: Address;
  writeToCache?: boolean;
};

async function expand({
  network,
  hre,
  relations,
  address,
  visited,
  proxies,
  currentProxy,
  writeToCache = false
}: ExpandParameters): Promise<ContractNode> {
  if (address === '0x0000000000000000000000000000000000000000') return null;

  const loadedContract = await loadContractConfig({network, hre, address, writeToCache});

  //
  const key = Object.keys(loadedContract.contracts)[0]; // TODO: assert contracts length is 1
  const abi = loadedContract.contracts[key].abi;
  const contractName = loadedContract.contracts[key].name;
  let contract = new hre.ethers.Contract(
    currentProxy ?? address,
    abi,
    hre.ethers.provider
  );
  visited.set(address, contractName);

  let canonicalName;
  let children = [];
  // Iterate through dependencies if contract has any relations.
  if (contractName in relations) {
    const relation = relations[contractName];
    let dependencies: Address[], implementation: Address;
    [dependencies, implementation, canonicalName] = await Promise.all([
      relation.relations
        ? relation.relations(contract)
        : null,
        relation.implementation
        ? relation.implementation(contract)
        : null,
      relation.canonicalName
        ? relation.canonicalName(contract)
        : null,
    ]);
    if (implementation) {
      proxies[address] = implementation;
      const newChild = await expand({
        network,
        hre,
        relations,
        address: implementation,
        visited,
        proxies,
        currentProxy: address,
        writeToCache
      });
      if (newChild) {
        children.push(newChild);
      }
    }
    if (dependencies) {
      const newChildren = await Promise.all(dependencies.map(addr => expand({network, hre, relations, address: addr, visited, proxies, writeToCache})));
      for (const newChild of newChildren) {
        if (newChild) {
          children.push(newChild);
        }
      }
    }
  }

  return { canonicalName, contractName, address, abi, children };
}

// Loads a contract's config by reading it from cache or pulling it from Etherscan if it does not exist.
// TODO: Have an command-line argument to override all cached configs.
interface LoadContractConfigParameters {
  network: string;
  hre: HardhatRuntimeEnvironment;
  address: Address;
  writeToCache?: boolean;
}

async function loadContractConfig({
  network,
  hre,
  address,
  writeToCache = false
}: LoadContractConfigParameters) {
  if (address === '0x0000000000000000000000000000000000000000') {
    throw "Spider Error: loading zero address";
  }

  const outdir = path.join(__dirname, '..', '..', 'deployments', network, 'cache');
  const outfile = path.join(outdir, `${address}.json`);

  let res;
  try {
    if(!fs.existsSync(outfile)) throw Error("File DNE");
    res = JSON.parse(fs.readFileSync(outfile, 'utf-8'));
  }
  catch (err) {
    switch(err.name) {
      case "SyntaxError":
        // JSON parsing error
      case "Error":
        // File does not exist or read error
      default:
        res = await importContract(hre, address, outdir);
        break;
    }
  }
  return res;
}

async function importContract(hre, address, outdir, count = 0) {
  if (count == 10) throw "Error: Etherscan API not resolving";
  try {
    return await hre.run('import', { address, outdir });
  } catch {
    await new Promise(r => setTimeout(r, 2000));
    return await importContract(hre, address, outdir, count + 1);
  }
}
