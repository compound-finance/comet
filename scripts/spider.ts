import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import axios from 'axios';

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
  findChild: (contract: Contract) => Promise<string> | null;
}

async function main() {
  // cSUSHI token
  let web = await expand('0x4b0181102a0112a2ef11abee5563bb4a3176c9d7');
  console.log(web);
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

function createRules(): Rule[] {
  let rules: Rule[] = [];
  // TODO: Some rules might only apply to certain types of parent contracts.
  rules.push({
    name: 'Implementation', 
    findChild: async (contract: Contract) => await contract.implementation()
  });
  rules.push({
    name: 'Underlying',
    findChild: async (contract: Contract) => await contract.underlying()
  });
  return rules;
}

// DFS expansion starting from root contract.
async function expand(startingAddress: string): Promise<ContractNode> {
  let contractNode: ContractNode;
  const abi = await getAbi(startingAddress);
  const contractName = await getContractName(startingAddress);
  const contract = new ethers.Contract(startingAddress, abi, PROVIDER);
  const name = await contract.name();
  let children = [];

  // Apply each rule to find child contracts.
  const rules = createRules();
  for (var rule of rules) {
    try {
      const childAddress = await rule.findChild(contract);
      children.push(await expand(childAddress));
    } catch {
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
