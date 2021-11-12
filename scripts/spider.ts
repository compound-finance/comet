import { ethers } from 'hardhat';
import axios from 'axios';

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

async function main() {
  const abi = await getAbi('0x4b0181102a0112a2ef11abee5563bb4a3176c9d7');
  const provider = new ethers.providers.InfuraProvider;
  const contract = new ethers.Contract('0x4b0181102a0112a2ef11abee5563bb4a3176c9d7', abi, provider);

  console.log(await contract.name());
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
