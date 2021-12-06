import { Contract } from 'ethers';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { loadContract } from './import';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

/**
 * PROOF OF CONCEPT CRAWLER FOR COMPOUND V2 CONTRACTS
 */

// A node within the contract dependency tree.
interface ContractNode {
  name: string,
  contractName: string,
  // abi,
  address: string,
  children: ContractNode[], // Make into a map to remove dupes
}

// A rule to apply to a contract to find its children.
interface Rule {
  name: string;
  applies: (contractName: string) => boolean;
  findChild: (contract: Contract) => Promise<string> | Promise<string[]> | null;
}

export async function pullConfigs(hre: HardhatRuntimeEnvironment, network: string) {
  let rootsFile = path.join(__dirname, `../deployments/${network}/roots.json`);
  let roots = JSON.parse(fs.readFileSync(rootsFile, 'utf-8'));
  console.log('Reading roots.js: ' + roots);
  for (let contractName in roots) {
    let address = roots[contractName];
    let web = await expand(hre, network, address, contractName);
    console.log(JSON.stringify(web, null, 4));
  }
}

async function getAbi(address: string): Promise<string> {
  return await axios.get('https://api.etherscan.io/api?module=contract', {
    params: {
      address,
      action: 'getabi',
      apikey: process.env.ETHERSCAN_KEY,
    }
  }).then((response) => {
    return response.data.result;
  })
    .catch((error) => {
      console.log(error);
    })
}

// TODO: Stretch goal - make a generalized rule that can just pull all fields that store
// an address of a contract.
function createRules(hre: HardhatRuntimeEnvironment): Rule[] {
  const provider = new hre.ethers.providers.InfuraProvider;
  let rules: Rule[] = [];
  rules.push({
    // Ctoken implementation
    name: 'Delegate',
    applies: (contractName: string) => ['CErc20Delegator'].includes(contractName),
    findChild: async (contract: Contract) => await contract.implementation()
  });
  rules.push({
    name: 'Underlying',
    applies: (contractName: string) => ['CErc20Delegator'].includes(contractName),
    findChild: async (contract: Contract) => await contract.underlying()
  });
  rules.push({
    name: 'ComptrollerImplementation',
    applies: (contractName: string) => ['Unitroller'].includes(contractName),
    findChild: async (contract: Contract) => await contract.comptrollerImplementation()
  });
  rules.push({
    name: 'AllMarkets',
    applies: (contractName: string) => ['Unitroller'].includes(contractName),
    findChild: async (contract: Contract) => {
      // Read implementation as proxy.
      const implAbi = await getAbi(await contract.comptrollerImplementation());
      const proxy = new hre.ethers.Contract(contract.address, implAbi, provider);
      return await proxy.getAllMarkets();
    }
  });
  rules.push({
    name: 'Oracle',
    applies: (contractName: string) => ['Unitroller'].includes(contractName),
    findChild: async (contract: Contract) => {
      // Read implementation as proxy.
      const implAbi = await getAbi(await contract.comptrollerImplementation());
      const proxy = new hre.ethers.Contract(contract.address, implAbi, provider);
      return await proxy.oracle();
    }
  });
  rules.push({
    name: 'Timelock',
    applies: (contractName: string) => ['Unitroller'].includes(contractName),
    findChild: async (contract: Contract) => {
      // Read implementation as proxy.
      const implAbi = await getAbi(await contract.comptrollerImplementation());
      const proxy = new hre.ethers.Contract(contract.address, implAbi, provider);
      return await proxy.admin();
    }
  });
  
  return rules;
}

// DFS expansion starting from root contract.
// TODO: Return a flat map with {k: address, v: node object} instead. 
// TODO: Need to handle naming of exported configs when multiple dependencies have same contract name (e.g. CTokens).
// TODO: Can optimize by checking if address already exists in cache and reduce computation that way. Have an option
// to force overwrite of cache if necessary.
async function expand(hre: HardhatRuntimeEnvironment, network: string, startingAddress: string, name: string): Promise<ContractNode> {
  let contractNode: ContractNode;
  let loadedContract = await loadContract('etherscan', network, startingAddress, `../deployments/${network}/cache`, 0);
  const abi = loadedContract.contract.abi;
  const contractName = loadedContract.contract.name;
  const provider = new hre.ethers.providers.InfuraProvider;
  const contract = new hre.ethers.Contract(startingAddress, abi, provider);
  try {
    const symbol = await contract.symbol();
    name = symbol ? symbol : name;
  } catch { }
  let children = [];

  // Apply each rule to find child contracts.
  const rules = createRules(hre);
  for (var rule of rules) {
    if (!rule.applies(contractName)) continue;
    try {
      const addresses = await rule.findChild(contract);
      if (typeof addresses === 'string') {
        children.push(await expand(hre, network, addresses, name + rule.name));
      } else {
        // addresses is string[]
        for (var addr of addresses) {
          children.push(await expand(hre, network, addr, name + rule.name));
        }
      }
    } catch (e) {
      console.log(e);
      console.log('rule ' + rule.name + ' does not apply to ' + contractName);
    }
  }

  contractNode = { name, contractName, address: startingAddress, children }
  return contractNode;
}