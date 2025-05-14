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
import sepoliaUsdcRelationConfigMap from './deployments/sepolia/usdc/relations';
import sepoliaWethRelationConfigMap from './deployments/sepolia/weth/relations';
import mainnetRelationConfigMap from './deployments/mainnet/usdc/relations';
import mainnetWethRelationConfigMap from './deployments/mainnet/weth/relations';
import mainnetUsdtRelationConfigMap from './deployments/mainnet/usdt/relations';
import mainnetWstETHRelationConfigMap from './deployments/mainnet/wsteth/relations';
import mainnetUsdsRelationConfigMap from './deployments/mainnet/usds/relations';
import mainnetWbtcRelationConfigMap from './deployments/mainnet/wbtc/relations';
import polygonRelationConfigMap from './deployments/polygon/usdc/relations';
import polygonUsdtRelationConfigMap from './deployments/polygon/usdt/relations';
import arbitrumBridgedUsdcRelationConfigMap from './deployments/arbitrum/usdc.e/relations';
import arbitrumNativeUsdcRelationConfigMap from './deployments/arbitrum/usdc/relations';
import arbitrumWETHRelationConfigMap from './deployments/arbitrum/weth/relations';
import arbitrumUsdtRelationConfigMap from './deployments/arbitrum/usdt/relations';
import baseUsdbcRelationConfigMap from './deployments/base/usdbc/relations';
import baseWethRelationConfigMap from './deployments/base/weth/relations';
import baseUsdcRelationConfigMap from './deployments/base/usdc/relations';
import baseAeroRelationConfigMap from './deployments/base/aero/relations';
import baseUSDSRelationConfigMap from './deployments/base/usds/relations';
import optimismRelationConfigMap from './deployments/optimism/usdc/relations';
import optimismUsdtRelationConfigMap from './deployments/optimism/usdt/relations';
import optimismWethRelationConfigMap from './deployments/optimism/weth/relations';
import mantleRelationConfigMap from './deployments/mantle/usde/relations';
import unichainRelationConfigMap from './deployments/unichain/usdc/relations';
import scrollRelationConfigMap from './deployments/scroll/usdc/relations';
import roninRelationConfigMap from './deployments/ronin/weth/relations';

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  for (const account of await hre.ethers.getSigners()) console.log(account.address);
});

/* note: boolean environment variables are imported as strings */
const {
  COINMARKETCAP_API_KEY,
  ETH_PK,
  ETHERSCAN_KEY,
  SNOWTRACE_KEY,
  POLYGONSCAN_KEY,
  ARBISCAN_KEY,
  BASESCAN_KEY,
  OPTIMISMSCAN_KEY,
  MANTLESCAN_KEY,
  SCROLLSCAN_KEY,
  ANKR_KEY,
  //TENDERLY_KEY_RONIN,
  MNEMONIC = 'myth like bonus scare over problem client lizard pioneer submit female collect',
  REPORT_GAS = 'false',
  NETWORK_PROVIDER = '',
  GOV_NETWORK_PROVIDER = '',
  GOV_NETWORK = '',
  UNICHAIN_QUICKNODE_KEY = '',
  REMOTE_ACCOUNTS = ''
} = process.env;

function* deriveAccounts(pk: string, n: number = 10) {
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
  'ANKR_KEY',
  'POLYGONSCAN_KEY',
  'ARBISCAN_KEY',
  'LINEASCAN_KEY',
  'OPTIMISMSCAN_KEY',
  'MANTLESCAN_KEY',
  'UNICHAIN_QUICKNODE_KEY',
  'SCROLLSCAN_KEY'
].map((v) => requireEnv(v));

// Networks
interface NetworkConfig {
  network: string;
  chainId: number;
  url?: string;
  gas?: number | 'auto';
  gasPrice?: number | 'auto';
}

const networkConfigs: NetworkConfig[] = [
  {
    network: 'mainnet',
    chainId: 1,
    url: `https://rpc.ankr.com/eth/${ANKR_KEY}`,
  },
  {
    network: 'sepolia',
    chainId: 11155111,
    url: `https://rpc.ankr.com/eth_sepolia/${ANKR_KEY}`,
  },
  {
    network: 'ronin',
    chainId: 2020,
    //url: `https://ronin.gateway.tenderly.co/${TENDERLY_KEY_RONIN}`,
    url: 'https://ronin.lgns.net/rpc',
  },
  {
    network: 'polygon',
    chainId: 137,
    url: `https://rpc.ankr.com/polygon/${ANKR_KEY}`,
  },
  {
    network: 'optimism',
    chainId: 10,
    url: `https://rpc.ankr.com/optimism/${ANKR_KEY}`,
  },
  {
    network: 'mantle',
    chainId: 5000,
    // link for scenarios
    url: `https://rpc.ankr.com/mantle/${ANKR_KEY}`,
    // link for deployment
    // url: `https://rpc.mantle.xyz`,
  },
  {
    network: 'unichain',
    chainId: 130,
    url: `https://multi-boldest-patina.unichain-mainnet.quiknode.pro/${UNICHAIN_QUICKNODE_KEY}`,
  },
  {
    network: 'base',
    chainId: 8453,
    url: `https://rpc.ankr.com/base/${ANKR_KEY}`,
  },
  {
    network: 'arbitrum',
    chainId: 42161,
    url: `https://rpc.ankr.com/arbitrum/${ANKR_KEY}`,
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
    network: 'scroll',
    chainId: 534352,
    url: `https://rpc.ankr.com/scroll/${ANKR_KEY}`,
  }
];

function getDefaultProviderURL(network: string) {
  return `https://rpc.ankr.com/${network}/${ANKR_KEY}`;
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
      accounts: REMOTE_ACCOUNTS ? 'remote' : (ETH_PK ? [...deriveAccounts(ETH_PK)] : { mnemonic: MNEMONIC }),
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
          runs: 1,
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
      //hardfork: 'london',
      chains: networkConfigs.reduce((acc, { chainId }) => {
        if (chainId === 1) return acc;
        if (chainId === 2020) {
          acc[chainId] = {
            hardforkHistory: {
              berlin: 1,
              london: 2,
            }
          };
          return acc;
        }
        acc[chainId] = {
          hardforkHistory: {
            berlin: 1,
            london: 2,
            shanghai: 3,
            cancun: 4,
          },
        };
        return acc;
      }, {}),
    },
  },

  // See https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html#multiple-api-keys-and-alternative-block-explorers
  etherscan: {
    apiKey: {
      // Ethereum
      mainnet: ETHERSCAN_KEY,
      sepolia: ETHERSCAN_KEY,
      // Avalanche
      avalanche: SNOWTRACE_KEY,
      avalancheFujiTestnet: SNOWTRACE_KEY,
      // Polygon
      polygon: POLYGONSCAN_KEY,
      // Arbitrum
      arbitrumOne: ARBISCAN_KEY,
      arbitrumTestnet: ARBISCAN_KEY,
      arbitrum: ARBISCAN_KEY,
      // Base
      base: BASESCAN_KEY,
      // optimism: OPTIMISMSCAN_KEY,
      optimisticEthereum: OPTIMISMSCAN_KEY,
      // Mantle
      mantle: MANTLESCAN_KEY,
      unichain: ETHERSCAN_KEY,
      // Scroll
      'scroll': SCROLLSCAN_KEY,
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
        // Hardhat's Etherscan plugin doesn't have support Base, so we need to add an entry for our own network name
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL: 'https://api.basescan.org/api',
          browserURL: 'https://basescan.org/'
        }
      },
      {
        network: 'scroll',
        chainId: 534352,
        urls: {
          apiURL: 'https://api.scrollscan.com/api',
          browserURL: 'https://scrollscan.com/'
        }
      },
      {
        network: 'unichain',
        chainId: 130,
        urls: {
          apiURL: 'https://unichain.blockscout.com/api',
          browserURL: 'https://unichain.blockscout.com/'
        }
      },
      {
        network: 'mantle',
        chainId: 5000,
        urls: {
          // apiURL: 'https://rpc.mantle.xyz',
          // links for scenarios
          apiURL: 'https://explorer.mantle.xyz/api',
          browserURL: 'https://explorer.mantle.xyz/'
          // links for deployment
          // apiURL: 'https://api.mantlescan.xyz/api',
          // browserURL: 'https://mantlescan.xyz/'
        }
      },
      {
        network: 'ronin',
        chainId: 2020,
        urls: {
          apiURL: 'https://explorer-kintsugi.roninchain.com/v2/2020',
          browserURL: 'https://app.roninchain.com'
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
      sepolia: {
        usdc: sepoliaUsdcRelationConfigMap,
        weth: sepoliaWethRelationConfigMap
      },
      mainnet: {
        usdc: mainnetRelationConfigMap,
        weth: mainnetWethRelationConfigMap,
        usdt: mainnetUsdtRelationConfigMap,
        wsteth: mainnetWstETHRelationConfigMap,
        usds: mainnetUsdsRelationConfigMap,
        wbtc: mainnetWbtcRelationConfigMap,
      },
      polygon: {
        usdc: polygonRelationConfigMap,
        usdt: polygonUsdtRelationConfigMap
      },
      arbitrum: {
        'usdc.e': arbitrumBridgedUsdcRelationConfigMap,
        usdc: arbitrumNativeUsdcRelationConfigMap,
        usdt: arbitrumUsdtRelationConfigMap,
        weth: arbitrumWETHRelationConfigMap
      },
      'base': {
        usdbc: baseUsdbcRelationConfigMap,
        weth: baseWethRelationConfigMap,
        usdc: baseUsdcRelationConfigMap,
        aero: baseAeroRelationConfigMap,
        usds: baseUSDSRelationConfigMap
      },
      optimism: {
        usdc: optimismRelationConfigMap,
        usdt: optimismUsdtRelationConfigMap,
        weth: optimismWethRelationConfigMap
      },
      'mantle': {
        'usde': mantleRelationConfigMap
      },
      'unichain': {
        'usdc': unichainRelationConfigMap
      },
      'scroll': {
        usdc: scrollRelationConfigMap
      },
      'ronin': {
        weth: roninRelationConfigMap
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
        name: 'mainnet-usdt',
        network: 'mainnet',
        deployment: 'usdt'
      },
      {
        name: 'mainnet-wsteth',
        network: 'mainnet',
        deployment: 'wsteth'
      },
      {
        name: 'mainnet-usds',
        network: 'mainnet',
        deployment: 'usds'
      },
      {
        name: 'mainnet-wbtc',
        network: 'mainnet',
        deployment: 'wbtc'
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
        name: 'polygon',
        network: 'polygon',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'polygon-usdt',
        network: 'polygon',
        deployment: 'usdt',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'arbitrum-usdc.e',
        network: 'arbitrum',
        deployment: 'usdc.e',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'arbitrum-usdt',
        network: 'arbitrum',
        deployment: 'usdt',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'arbitrum-usdc',
        network: 'arbitrum',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'arbitrum-weth',
        network: 'arbitrum',
        deployment: 'weth',
        auxiliaryBase: 'mainnet'
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
        name: 'base-aero',
        network: 'base',
        deployment: 'aero',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'base-usds',
        network: 'base',
        deployment: 'usds',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'optimism-usdc',
        network: 'optimism',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'optimism-usdt',
        network: 'optimism',
        deployment: 'usdt',
        auxiliaryBase: 'mainnet',
      },
      {
        name: 'optimism-weth',
        network: 'optimism',
        deployment: 'weth',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'mantle-usde',
        network: 'mantle',
        deployment: 'usde',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'unichain-usdc',
        network: 'unichain',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'scroll-usdc',
        network: 'scroll',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'ronin-weth',
        network: 'ronin',
        deployment: 'weth',
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