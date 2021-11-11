import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers'
import '@typechain/hardhat'
import 'solidity-coverage';
import 'hardhat-gas-reporter';
import '@tenderly/hardhat-tenderly'

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

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
    // denominated in gwei
    gasPrice: 200 
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
