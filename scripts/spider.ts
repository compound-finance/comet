import { ethers } from 'hardhat';
import axios from 'axios';

const PROVIDER = new ethers.providers.InfuraProvider;

interface ContractNode {
  name: string,
  contractName: string,
  // abi,
  address: string,
  children: ContractNode[],
}

async function main() {

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
    console.log(response.data.result);
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
    console.log(response.data.result[0]);
    return response.data.result[0].ContractName;
  })
    .catch((error) => {
      console.log(error);
    })
}

// DFS expansion starting from root contract
async function expand(startingAddress: string): Promise<ContractNode> {
  let contractNode: ContractNode;
  const abi = await getAbi(startingAddress);
  const contractName = await getContractName(startingAddress);
  const contract = new ethers.Contract(startingAddress, abi, PROVIDER);
  const name = await contract.name();
  let children = [];
  try {
    // TODO: Add more rules here for fetching dependent contracts.
    // One idea is to have a list of rules that are iterated over. Each
    // rule can add more children to the `children` list.
    const implementationAddress = await contract.implementation();
    children.push(await expand(implementationAddress));
  } catch {
    // do nothing
    console.log('no such field for ' + contractName);
  }
  contractNode = {name, contractName, address: startingAddress, children}
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
