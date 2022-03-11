import 'dotenv/config';

import { HardhatUserConfig, task } from 'hardhat/config';
import '@compound-finance/hardhat-import';
import '@nomiclabs/hardhat-waffle';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@typechain/hardhat';
import 'solidity-coverage';
import 'hardhat-contract-sizer';
import 'hardhat-gas-reporter';

// Hardhat tasks
import './tasks/deployment_manager/task.ts';
import './tasks/spider/task.ts';
import './tasks/scenario/task.ts';

// Relation Config
import relationConfigMap from './deployments/relations';
import fujiRelationConfigMap from './deployments/fuji/relations';
import kovanRelationConfigMap from './deployments/kovan/relations';

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  for (const account of await hre.ethers.getSigners()) console.log(account.address);
});

/* note: boolean environment variables are imported as strings */
const {
  COINMARKETCAP_API_KEY,
  ETH_PK = '',
  ETHERSCAN_KEY,
  SNOWTRACE_KEY,
  INFURA_KEY,
  MNEMONIC = '',
  REPORT_GAS = 'false',
} = process.env;

function throwIfMissing(envVariable, msg: string) {
  if (!envVariable) {
    throw new Error(msg);
  }
}

// required environment variables
throwIfMissing(ETHERSCAN_KEY, 'Missing required environment variable: ETHERSCAN_KEY');
throwIfMissing(SNOWTRACE_KEY, 'Missing required environment variable: SNOWTRACE_KEY');
throwIfMissing(INFURA_KEY, 'Missing required environment variable: INFURA_KEY');

// Networks
interface NetworkConfig {
  network: string;
  chainId: number;
  url?: string;
  gas?: number | 'auto';
  gasPrice?: number | 'auto';
}

const networkConfigs: NetworkConfig[] = [
  { network: 'mainnet', chainId: 1 },
  { network: 'ropsten', chainId: 3 },
  { network: 'rinkeby', chainId: 4 },
  { network: 'goerli', chainId: 5 },
  { network: 'kovan', chainId: 42 },
  {
    network: 'avalanche',
    chainId: 43114,
    url: 'https://api.avax.network/ext/bc/C/rpc',
  },
  {
    network: 'fuji',
    chainId: 43113,
    url: 'https://api.avax-test.network/ext/bc/C/rpc',
  },
];

function getDefaultProviderURL(network: string) {
  return `https://${network}.infura.io/v3/${INFURA_KEY}`;
}

function setupDefaultNetworkProviders(hardhatConfig: HardhatUserConfig) {
  for (const netConfig of networkConfigs) {
    hardhatConfig.networks[netConfig.network] = {
      chainId: netConfig.chainId,
      url: netConfig.url || getDefaultProviderURL(netConfig.network),
      gas: netConfig.gas || 'auto',
      gasPrice: netConfig.gasPrice || 'auto',
      accounts: ETH_PK
        ? [ETH_PK]
        : {
            mnemonic: MNEMONIC,
          },
    };
  }
}

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.11',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1,
      },
      viaIR: true,
    },
  },

  networks: {
    hardhat: {
      chainId: 1337,
      loggingEnabled: !!process.env['LOGGING'],
      gas: 12000000,
      gasPrice: 'auto',
      blockGasLimit: 12000000,
      accounts: {
        mnemonic: 'myth like bonus scare over problem client lizard pioneer submit female collect',
      },
      // this should be default commented out and only enabled during dev to allow partial testing
      // XXX comment out by default once we've made the full contract fit
      allowUnlimitedContractSize: true,
    },
  },

  // See https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html#multiple-api-keys-and-alternative-block-explorers
  etherscan: {
    apiKey: {
      // Ethereum
      mainnet: ETHERSCAN_KEY,
      ropsten: ETHERSCAN_KEY,
      rinkeby: ETHERSCAN_KEY,
      goerli: ETHERSCAN_KEY,
      kovan: ETHERSCAN_KEY,
      // Avalanche
      avalanche: SNOWTRACE_KEY,
      avalancheFujiTestnet: SNOWTRACE_KEY,
    },
  },

  typechain: {
    outDir: 'build/types',
    target: 'ethers-v5',
  },

  deploymentManager: {
    relationConfigMap,
    networks: {
      fuji: fujiRelationConfigMap,
      kovan: kovanRelationConfigMap,
    },
  },

  scenario: {
    bases: [
      {
        name: 'development',
      },
      {
        name: 'kovan',
        chainId: 42,
        url: getDefaultProviderURL('kovan'),
        allocation: 0.1, // eth
      },
      {
        name: 'fuji',
        chainId: 43113,
        url: 'https://api.avax-test.network/ext/bc/C/rpc',
      },
    ],
  },

  mocha: {
    reporter: 'mocha-multi-reporters',
    reporterOptions: {
      reporterEnabled: ['spec', 'json'],
      jsonReporterOptions: {
        output: 'test-results.json',
      },
    },
  },

  paths: {
    tests: './{test,plugins/deployment_manager/test}',
  },

  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: false, // allow tests to run anyway
  },

  gasReporter: {
    enabled: REPORT_GAS === 'true' ? true : false,
    currency: 'USD',
    coinmarketcap: COINMARKETCAP_API_KEY,
    gasPrice: 200, // gwei
  },
};

setupDefaultNetworkProviders(config);

export default config;
