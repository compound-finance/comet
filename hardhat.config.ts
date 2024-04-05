import 'dotenv/config';

import { HardhatUserConfig, task } from 'hardhat/config';
import '@compound-finance/hardhat-import';
import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-etherscan';
import '@typechain/hardhat';
import 'hardhat-chai-matchers';
import 'hardhat-change-network';
import 'hardhat-contract-sizer';
import 'hardhat-cover';
import 'hardhat-gas-reporter';

// Hardhat tasks
import './tasks/deployment_manager/task.ts';
import './tasks/spider/task.ts';
import './tasks/scenario/task.ts';

// Relation Config
import relationConfigMap from './deployments/relations';
import goerliRelationConfigMap from './deployments/goerli/usdc/relations';
import goerliWethRelationConfigMap from './deployments/goerli/weth/relations';
import goerliUsdtRelationConfigMap from './deployments/goerli/usdt/relations';
import sepoliaUsdcRelationConfigMap from './deployments/sepolia/usdc/relations';
import sepoliaWethRelationConfigMap from './deployments/sepolia/weth/relations';
import mumbaiRelationConfigMap from './deployments/mumbai/usdc/relations';
import mainnetRelationConfigMap from './deployments/mainnet/usdc/relations';
import mainnetWethRelationConfigMap from './deployments/mainnet/weth/relations';
import polygonRelationConfigMap from './deployments/polygon/usdc/relations';
import arbitrumBridgedUsdcRelationConfigMap from './deployments/arbitrum/usdc.e/relations';
import arbitrumNativeUsdcRelationConfigMap from './deployments/arbitrum/usdc/relations';
import arbitrumBridgedUsdcGoerliRelationConfigMap from './deployments/arbitrum-goerli/usdc.e/relations';
import arbitrumGoerliNativeUsdcRelationConfigMap from './deployments/arbitrum-goerli/usdc/relations';
import baseUsdbcRelationConfigMap from './deployments/base/usdbc/relations';
import baseWethRelationConfigMap from './deployments/base/weth/relations';
import baseUsdcRelationConfigMap from './deployments/base/usdc/relations';
import baseGoerliRelationConfigMap from './deployments/base-goerli/usdc/relations';
import baseGoerliWethRelationConfigMap from './deployments/base-goerli/weth/relations';
import lineaGoerliRelationConfigMap from './deployments/linea-goerli/usdc/relations';
import scrollGoerliRelationConfigMap from './deployments/scroll-goerli/usdc/relations';
import scrollRelationConfigMap from './deployments/scroll/usdc/relations';


task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  for (const account of await hre.ethers.getSigners()) console.log(account.address);
});

/* note: boolean environment variables are imported as strings */
const {
  COINMARKETCAP_API_KEY,
  ETH_PK = '',
  ETHERSCAN_KEY,
  SNOWTRACE_KEY,
  POLYGONSCAN_KEY,
  ARBISCAN_KEY,
  BASESCAN_KEY,
  LINEASCAN_KEY,
  INFURA_KEY,
  QUICKNODE_KEY,
  MNEMONIC = 'myth like bonus scare over problem client lizard pioneer submit female collect',
  REPORT_GAS = 'false',
  NETWORK_PROVIDER = '',
  GOV_NETWORK_PROVIDER = '',
  GOV_NETWORK = '',
  REMOTE_ACCOUNTS = ''
} = process.env;

function *deriveAccounts(pk: string, n: number = 10) {
  for (let i = 0; i < n; i++)
    yield (BigInt('0x' + pk) + BigInt(i)).toString(16);
}

export function requireEnv(varName, msg?: string): string {
  const varVal = process.env[varName];
  if (!varVal) {
    throw new Error(msg ?? `Missing required environment variable '${varName}'`);
  }
  return varVal;
}

// required environment variables
[
  'ETHERSCAN_KEY',
  'SNOWTRACE_KEY',
  'INFURA_KEY',
  'POLYGONSCAN_KEY',
  'ARBISCAN_KEY',
  'LINEASCAN_KEY'
].map(v => requireEnv(v));

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
  { network: 'sepolia', chainId: 11155111 },
  {
    network: 'polygon',
    chainId: 137,
    url: `https://polygon-mainnet.infura.io/v3/${INFURA_KEY}`,
  },
  {
    network: 'base',
    chainId: 8453,
    url: `https://clean-spring-wind.base-mainnet.discover.quiknode.pro/${QUICKNODE_KEY}`,
  },
  {
    network: 'arbitrum',
    chainId: 42161,
    url: `https://arbitrum-mainnet.infura.io/v3/${INFURA_KEY}`,
  },
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
  {
    network: 'mumbai',
    chainId: 80001,
    url: `https://polygon-mumbai.infura.io/v3/${INFURA_KEY}`,
  },
  {
    network: 'arbitrum-goerli',
    chainId: 421613,
    url: `https://arbitrum-goerli.infura.io/v3/${INFURA_KEY}`,
  },
  {
    network: 'base-goerli',
    chainId: 84531,
    url: `https://goerli.base.org/`,
  },
  {
    network: 'linea-goerli',
    chainId: 59140,
    url: `https://linea-goerli.infura.io/v3/${INFURA_KEY}`,
  },
  {
    network: 'scroll-goerli',
    chainId: 534353,
    url: 'https://alpha-rpc.scroll.io/l2',
  },
  {
    network: 'scroll',
    chainId: 534352,
    url: 'https://rpc.scroll.io',
  }
];

function getDefaultProviderURL(network: string) {
  return `https://${network}.infura.io/v3/${INFURA_KEY}`;
}

function setupDefaultNetworkProviders(hardhatConfig: HardhatUserConfig) {
  for (const netConfig of networkConfigs) {
    hardhatConfig.networks[netConfig.network] = {
      chainId: netConfig.chainId,
      url:
        (netConfig.network === GOV_NETWORK ? GOV_NETWORK_PROVIDER : undefined) ||
        NETWORK_PROVIDER ||
        netConfig.url ||
        getDefaultProviderURL(netConfig.network),
      gas: netConfig.gas || 'auto',
      gasPrice: netConfig.gasPrice || 'auto',
      accounts: REMOTE_ACCOUNTS ? 'remote' : ( ETH_PK ? [...deriveAccounts(ETH_PK)] : { mnemonic: MNEMONIC } ),
    };
  }
}

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.15',
    settings: {
      optimizer: (
        process.env['OPTIMIZER_DISABLED'] ? { enabled: false } : {
          enabled: true,
          runs: 2,
          details: {
            yulDetails: {
              optimizerSteps: 'dhfoDgvulfnTUtnIf [xa[r]scLM cCTUtTOntnfDIul Lcul Vcul [j] Tpeul xa[rul] xa[r]cL gvif CTUca[r]LsTOtfDnca[r]Iulc] jmul[jul] VcTOcul jmul'
            },
          },
        }
      ),
      outputSelection: {
        '*': {
          '*': ['evm.deployedBytecode.sourceMap']
        },
      },
      viaIR: process.env['OPTIMIZER_DISABLED'] ? false : true,
    },
  },

  networks: {
    hardhat: {
      chainId: 1337,
      loggingEnabled: !!process.env['LOGGING'],
      gas: 120000000,
      gasPrice: 'auto',
      blockGasLimit: 120000000,
      accounts: ETH_PK ?
        [...deriveAccounts(ETH_PK)].map(privateKey => ({ privateKey, balance: (10n ** 36n).toString() }))
        : { mnemonic: MNEMONIC, accountsBalance: (10n ** 36n).toString() },
      // this should only be relied upon for test harnesses and coverage (which does not use viaIR flag)
      allowUnlimitedContractSize: true,
      hardfork: 'shanghai'
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
      sepolia: ETHERSCAN_KEY,
      // Avalanche
      avalanche: SNOWTRACE_KEY,
      avalancheFujiTestnet: SNOWTRACE_KEY,
      // Polygon
      polygon: POLYGONSCAN_KEY,
      polygonMumbai: POLYGONSCAN_KEY,
      // Arbitrum
      arbitrumOne: ARBISCAN_KEY,
      arbitrumTestnet: ARBISCAN_KEY,
      arbitrum: ARBISCAN_KEY,
      'arbitrum-goerli': ARBISCAN_KEY,
      // Base
      base: BASESCAN_KEY,
      'base-goerli': BASESCAN_KEY,
      // Linea
      'linea-goerli': LINEASCAN_KEY,
      // Scroll Testnet
      'scroll-goerli': ETHERSCAN_KEY,
      // Scroll
      'scroll': ETHERSCAN_KEY,
    },
    customChains: [
      {
        // Hardhat's Etherscan plugin calls the network `arbitrumOne`, so we need to add an entry for our own network name
        network: 'arbitrum',
        chainId: 42161,
        urls: {
          apiURL: 'https://api.arbiscan.io/api',
          browserURL: 'https://arbiscan.io/'
        }
      },
      {
        // Hardhat's Etherscan plugin calls the network `arbitrumGoerli`, so we need to add an entry for our own network name
        network: 'arbitrum-goerli',
        chainId: 421613,
        urls: {
          apiURL: 'https://api-goerli.arbiscan.io/api',
          browserURL: 'https://goerli.arbiscan.io/'
        }
      },
      {
        // Hardhat's Etherscan plugin doesn't have support Base, so we need to add an entry for our own network name
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://basescan.org/'
        }
      },
      {
        // Hardhat's Etherscan plugin calls the network `baseGoerli`, so we need to add an entry for our own network name
        network: 'base-goerli',
        chainId: 84531,
        urls: {
          apiURL: 'https://api-goerli.basescan.org/api',
          browserURL: 'https://goerli.basescan.org/'
        }
      },
      {
        network: 'linea-goerli',
        chainId: 59140,
        urls: {
          apiURL: 'https://api-goerli.lineascan.build/api',
          browserURL: 'https://goerli.lineascan.build/'
        }
      },
      {
        network: 'scroll-goerli',
        chainId: 534353,
        urls: {
          apiURL: 'https://alpha-blockscout.scroll.io/api',
          browserURL: 'https://alpha-blockscout.scroll.io/'
        }
      },
      {
        network: 'scroll',
        chainId: 534352,
        urls: {
          apiURL: 'https://api.scrollscan.com/api',
          browserURL: 'https://scrollscan.com/'
        }
      }
    ]
  },

  typechain: {
    outDir: 'build/types',
    target: 'ethers-v5',
  },

  deploymentManager: {
    relationConfigMap,
    networks: {
      goerli: {
        usdc: goerliRelationConfigMap,
        weth: goerliWethRelationConfigMap, 
        usdt: goerliUsdtRelationConfigMap,
      },
      sepolia: {
        usdc: sepoliaUsdcRelationConfigMap,
        weth: sepoliaWethRelationConfigMap
      },
      mumbai: {
        usdc: mumbaiRelationConfigMap
      },
      mainnet: {
        usdc: mainnetRelationConfigMap,
        weth: mainnetWethRelationConfigMap
      },
      polygon: {
        usdc: polygonRelationConfigMap
      },
      arbitrum: {
        'usdc.e': arbitrumBridgedUsdcRelationConfigMap,
        usdc: arbitrumNativeUsdcRelationConfigMap
      },
      'arbitrum-goerli': {
        'usdc.e': arbitrumBridgedUsdcGoerliRelationConfigMap,
        usdc: arbitrumGoerliNativeUsdcRelationConfigMap
      },
      'base': {
        usdbc: baseUsdbcRelationConfigMap,
        weth: baseWethRelationConfigMap,
        usdc: baseUsdcRelationConfigMap
      },
      'base-goerli': {
        usdc: baseGoerliRelationConfigMap,
        weth: baseGoerliWethRelationConfigMap
      },
      'linea-goerli': {
        usdc: lineaGoerliRelationConfigMap
      },
      'scroll-goerli': {
        usdc: scrollGoerliRelationConfigMap
      },
      'scroll': {
        usdc: scrollRelationConfigMap
      }
    },
  },

  scenario: {
    bases: [
      {
        name: 'mainnet',
        network: 'mainnet',
        deployment: 'usdc',
        allocation: 1.0, // eth
      },
      {
        name: 'mainnet-weth',
        network: 'mainnet',
        deployment: 'weth',
      },
      {
        name: 'development',
        network: 'hardhat',
        deployment: 'dai'
      },
      {
        name: 'fuji',
        network: 'fuji',
        deployment: 'usdc'
      },
      {
        name: 'goerli',
        network: 'goerli',
        deployment: 'usdc'
      },
      {
        name: 'goerli-weth',
        network: 'goerli',
        deployment: 'weth',
      },
      {
        name: 'sepolia-usdc',
        network: 'sepolia',
        deployment: 'usdc'
      },
      {
        name: 'sepolia-weth',
        network: 'sepolia',
        deployment: 'weth'
      },
      {
        name: 'goerli-usdt',
        network: 'goerli',
        deployment: 'usdt',
      },
      {
        name: 'mumbai',
        network: 'mumbai',
        deployment: 'usdc',
        auxiliaryBase: 'goerli'
      },
      {
        name: 'polygon',
        network: 'polygon',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'arbitrum-usdc.e',
        network: 'arbitrum',
        deployment: 'usdc.e',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'arbitrum-usdc',
        network: 'arbitrum',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'arbitrum-goerli-usdc.e',
        network: 'arbitrum-goerli',
        deployment: 'usdc.e',
        auxiliaryBase: 'goerli'
      },
      {
        name: 'arbitrum-goerli-usdc',
        network: 'arbitrum-goerli',
        deployment: 'usdc',
        auxiliaryBase: 'goerli'
      },
      {
        name: 'base-usdbc',
        network: 'base',
        deployment: 'usdbc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'base-weth',
        network: 'base',
        deployment: 'weth',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'base-usdc',
        network: 'base',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'base-goerli',
        network: 'base-goerli',
        deployment: 'usdc',
        auxiliaryBase: 'goerli'
      },
      {
        name: 'base-goerli-weth',
        network: 'base-goerli',
        deployment: 'weth',
        auxiliaryBase: 'goerli'
      },
      {
        name: 'linea-goerli',
        network: 'linea-goerli',
        deployment: 'usdc',
        auxiliaryBase: 'goerli'
      },
      {
        name: 'scroll-goerli',
        network: 'scroll-goerli',
        deployment: 'usdc',
        auxiliaryBase: 'goerli'
      },
      {
        name: 'scroll-usdc',
        network: 'scroll',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      }
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
    timeout: 150_000
  },

  paths: {
    tests: './test',
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
