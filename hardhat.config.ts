import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers'
import '@typechain/hardhat'
import 'solidity-coverage';
import 'hardhat-gas-reporter';
import '@tenderly/hardhat-tenderly';

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  for (const account of await hre.ethers.getSigners())
    console.log(account.address);
});

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
export default {
  solidity: {
    version: '0.8.4',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },
  gasReporter: {
    enabled: (process.env.REPORT_GAS) ? true : false,
    currency: 'USD',
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    gasPrice: 200, // gwei
  },
  typechain: {
    outDir: 'build/types',
    target: 'ethers-v5',
  },
  tenderly: {
    username: "freeta",
    project: "project"
  },
  networks: {
    local: {
      url: 'http://127.0.0.1:8545'
    }
  }
};
