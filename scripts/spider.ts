import { Contract } from 'ethers';
import { loadContract } from './import';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import * as path from 'path';
import * as fs from 'fs';

/**
 * PROOF OF CONCEPT CRAWLER FOR COMPOUND V2 CONTRACTS.
 * 
 * Can be easily adapted for Comet or any other system of contracts by
 * modifying the createRelations() method.
 */

type address = string;

// A node within the contract dependency tree.
interface ContractNode {
  name: string,
  contractName: string,
  // abi,
  address: address,
  children: ContractNode[], // Make into a map to remove dupes
}

interface Relation {
  // TODO: What if proxy's contract name is non-unique?
  proxy?: string; // contract name of proxy, if one exists.
  relations: (contract: Contract) => Promise<address[]>;
}

interface Relations {
  [contractName: string]: Relation;
}

export async function pullConfigs(hre: HardhatRuntimeEnvironment, network: string) {
  let rootsFile = path.join(__dirname, `../deployments/${network}/roots.json`);
  let roots = JSON.parse(fs.readFileSync(rootsFile, 'utf-8'));
  console.log('Reading roots.js: ' + JSON.stringify(roots));
  const relations = createRelations();
  // Start branching out from each root contract.
  for (let contractName in roots) {
    let address = roots[contractName];
    let web = await expand(hre, network, relations, address, contractName, new Map());
    console.log(JSON.stringify(web, null, 4));
  }
}

function createRelations(): Relations {
  let relations: Relations = {
    'CErc20Delegator': {
      relations: async (contract: Contract) => {
        return [
          await contract.implementation(),
          await contract.underlying(),
        ];
      },
    },
    'Unitroller': {
      relations: async (contract: Contract) => {
        return [
          await contract.comptrollerImplementation(),
        ];
      },
    },
    'Comptroller': {
      proxy: 'Unitroller',
      relations: async (contract: Contract) => {
        return [
          ...(await contract.getAllMarkets()),
          await contract.oracle(),
          await contract.admin(),
        ];
      },
    },
  };
  return relations;
}

// DFS expansion starting from root contract.
// TODO: Can optimize by checking if address already exists in cache and reduce computation that way. Have an option
// to force overwrite of cache if necessary.
// TODO: Need to think about merging implementation ABIs to proxies.
async function expand(hre: HardhatRuntimeEnvironment, network: string, relations: Relations, address: address, name: string, visited: Map<string, address>): Promise<ContractNode> {
  const loadedContract = await loadContract('etherscan', network, address, `../deployments/${network}/cache`, 0);
  const abi = loadedContract.contract.abi;
  const contractName = loadedContract.contract.name;
  const provider = new hre.ethers.providers.InfuraProvider;
  let contract = new hre.ethers.Contract(address, abi, provider);
  visited.set(contractName, address);

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
      const proxyAddr = visited.get(relation.proxy); // The proxy should always exist in the map already.
      contract = new hre.ethers.Contract(proxyAddr, abi, provider);
    }
    const dependencies: address[] = await relations[contractName].relations(contract);
    for (let addr of dependencies) {
      children.push(await expand(hre, network, relations, addr, name, visited));
    }
  }

  // TODO: Write a simplified, flattened set of configs to `config.json`.
  return { name, contractName, address, children };
}