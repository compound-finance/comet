import 'dotenv/config';

import { HardhatUserConfig } from 'hardhat/types';
import { task } from 'hardhat/config';
import '@compound-finance/hardhat-import';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-gas-reporter';

// Hardhat tasks
import './tasks/spider/task.ts';
import './tasks/scenario/task.ts';

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  for (const account of await hre.ethers.getSigners())
    console.log(account.address);
});

// Networks
interface NetworkConfig {
  network: string
  chainId: number
  gas?: number | 'auto'
  gasPrice?: number | 'auto'
}

const networkConfigs: NetworkConfig[] = [
  { network: 'mainnet', chainId: 1 },
  { network: 'ropsten', chainId: 3 },
  { network: 'rinkeby', chainId: 4 },
  { network: 'kovan', chainId: 42 },
]

function getAccountMnemonic() {
  return process.env.MNEMONIC || ''
}

function getDefaultProviderURL(network: string) {
  return `https://${network}.infura.io/v3/${process.env.INFURA_KEY}`
}

function setupDefaultNetworkProviders(hardhatConfig: HardhatUserConfig) {
  for (const netConfig of networkConfigs) {
    hardhatConfig.networks[netConfig.network] = {
      chainId: netConfig.chainId,
      url: getDefaultProviderURL(netConfig.network),
      gas: netConfig.gasPrice || 'auto',
      gasPrice: netConfig.gasPrice || 'auto',
      accounts: {
        mnemonic: getAccountMnemonic(),
      },
    };
  }
}


/**
 * @type import('hardhat/config').HardhatUserConfig
 */
 const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.4',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
    },
  },

  networks: {
    hardhat: {
      chainId: 1337,
      loggingEnabled: false,
      gas: 12000000,
      gasPrice: 'auto',
      blockGasLimit: 12000000,
      accounts: {
        mnemonic: 'myth like bonus scare over problem client lizard pioneer submit female collect',
      },
    },
  },

  etherscan: {
    apiKey: process.env.ETHERSCAN_KEY,
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

  scenario: {
    bases: [
      {
        name: "development",
      },
      {
        name: "goerli",
        url: "https://eth-goerli.alchemyapi.io/v2/Xs9F4EHXAb1wg_PvxlKu3HaXglyPkc2E"
      }
    ],
  },

};

setupDefaultNetworkProviders(config);

export default config;