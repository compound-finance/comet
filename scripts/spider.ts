import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import axios from 'axios';

/**
 * PROOF OF CONCEPT CRAWLER FOR COMPOUND V2 CONTRACTS
 */

const PROVIDER = new ethers.providers.InfuraProvider;

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

async function main() {
  let web = await expand('0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B', 'Unitroller');
  console.log(JSON.stringify(web, null, 4));
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

async function getContractName(address: string): Promise<string> {
  return await axios.get('https://api.etherscan.io/api?module=contract', {
    params: {
      address,
      action: 'getsourcecode',
      apikey: process.env.ETHERSCAN_KEY,
    }
  }).then((response) => {
    return response.data.result[0].ContractName;
  })
    .catch((error) => {
      console.log(error);
    })
}

// TODO: Stretch goal - make a generalized rule that can just pull all fields that store
// an address of a contract.
function createRules(): Rule[] {
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
      const proxy = new ethers.Contract(contract.address, implAbi, PROVIDER);
      return await proxy.getAllMarkets();
    }
  });
  rules.push({
    name: 'Oracle',
    applies: (contractName: string) => ['Unitroller'].includes(contractName),
    findChild: async (contract: Contract) => {
      // Read implementation as proxy.
      const implAbi = await getAbi(await contract.comptrollerImplementation());
      const proxy = new ethers.Contract(contract.address, implAbi, PROVIDER);
      return await proxy.oracle();
    }
  });
  rules.push({
    name: 'Timelock',
    applies: (contractName: string) => ['Unitroller'].includes(contractName),
    findChild: async (contract: Contract) => {
      // Read implementation as proxy.
      const implAbi = await getAbi(await contract.comptrollerImplementation());
      const proxy = new ethers.Contract(contract.address, implAbi, PROVIDER);
      return await proxy.admin();
    }
  });
  
  return rules;
}

// DFS expansion starting from root contract.
// TODO: Return a flat map with {k: address, v: node object} instead. 
// Can check if address is already visited and reduce computation that way.
async function expand(startingAddress: string, name: string): Promise<ContractNode> {
  let contractNode: ContractNode;
  const abi = await getAbi(startingAddress);
  const contractName = await getContractName(startingAddress);
  const contract = new ethers.Contract(startingAddress, abi, PROVIDER);
  try {
    const symbol = await contract.symbol();
    name = symbol ? symbol : name;
  } catch { }
  let children = [];

  // Apply each rule to find child contracts.
  const rules = createRules();
  for (var rule of rules) {
    if (!rule.applies(contractName)) continue;
    try {
      const addresses = await rule.findChild(contract);
      if (typeof addresses === 'string') {
        children.push(await expand(addresses, name + rule.name));
      } else {
        // addresses is string[]
        for (var addr of addresses) {
          children.push(await expand(addr, name + rule.name));
        }
      }
    } catch (e) {
      // do nothing
      console.log('rule ' + rule.name + ' does not apply to ' + contractName);
    }
  }

  contractNode = { name, contractName, address: startingAddress, children }
  return contractNode;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
