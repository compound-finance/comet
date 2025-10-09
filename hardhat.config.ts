import 'dotenv/config';

import { HardhatUserConfig, subtask, task } from 'hardhat/config';
import '@compound-finance/hardhat-import';
import '@nomiclabs/hardhat-etherscan';
import '@tenderly/hardhat-tenderly';
import '@nomiclabs/hardhat-ethers';
import '@typechain/hardhat';
import 'hardhat-chai-matchers';
import 'hardhat-change-network';
import 'hardhat-contract-sizer';
import 'solidity-coverage';
import 'hardhat-gas-reporter';
import { TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS } from 'hardhat/builtin-tasks/task-names';
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
import unichainWETHRelationConfigMap from './deployments/unichain/weth/relations';
import scrollRelationConfigMap from './deployments/scroll/usdc/relations';
import roninRelationConfigMap from './deployments/ronin/weth/relations';
import roninWronRelationConfigMap from './deployments/ronin/wron/relations';
import lineaUsdcRelationConfigMap from './deployments/linea/usdc/relations';
import lineaWethRelationConfigMap from './deployments/linea/weth/relations';

task('accounts', 'Prints the list of accounts', async (taskArgs, hre) => {
  for (const account of await hre.ethers.getSigners()) console.log(account.address);
});

/* note: boolean environment variables are imported as strings */
const {
  COINMARKETCAP_API_KEY,
  ETH_PK,
  ETHERSCAN_KEY,
  SNOWTRACE_KEY,
  ANKR_KEY,
  _TENDERLY_KEY_RONIN,
  _TENDERLY_KEY_POLYGON,
  MNEMONIC = 'myth like woof scare over problem client lizard pioneer submit female collect',
  REPORT_GAS = 'false',
  NETWORK_PROVIDER = '',
  GOV_NETWORK_PROVIDER = '',
  GOV_NETWORK = '',
  UNICHAIN_QUICKNODE_KEY = '',
  REMOTE_ACCOUNTS = ''
} = process.env;

function* deriveAccounts(pk: string, n: number = 10) {
  for (let i = 0; i < n; i++){
    if(!pk.startsWith('0x')) pk = '0x' + pk;
    yield (BigInt(pk) + BigInt(i)).toString(16);
  }
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
  'UNICHAIN_QUICKNODE_KEY'
].map((v) => requireEnv(v));

// Networks
interface NetworkConfig {
  network: string;
  chainId: number;
  url?: string;
  gas?: number | 'auto';
  gasPrice?: number | 'auto';
}

subtask(TASK_COMPILE_SOLIDITY_GET_SOURCE_PATHS).setAction(async (_, __, runSuper) => {
  const paths = await runSuper();
  
  return paths.filter((p: string) => {
    return !(
      p.includes('contracts/capo/contracts/test/') ||
      p.includes('contracts/capo/test/') ||
      p.includes('forge-std') ||
      p.endsWith('.t.sol')
    );
  });
});

export const networkConfigs: NetworkConfig[] = [
  {
    network: 'mainnet',
    chainId: 1,
    url: `https://rpc.ankr.com/eth/${ANKR_KEY}`
  },
  {
    network: 'sepolia',
    chainId: 11155111,
    url: `https://rpc.ankr.com/eth_sepolia/${ANKR_KEY}`,
  },
  {
    network: 'ronin',
    chainId: 2020,
    url: `https://ronin.gateway.tenderly.co/${_TENDERLY_KEY_RONIN}`,
  },
  {
    network: 'polygon',
    chainId: 137,
    url: `https://polygon.gateway.tenderly.co/${_TENDERLY_KEY_POLYGON}`,
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
    network: 'linea',
    chainId: 59144,
    url: `https://rpc.ankr.com/linea/${ANKR_KEY}`,
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
    url: 'https://rpc.scroll.io',
  },
  {
    network: 'linea',
    chainId: 59144,
    url: `https://rpc.ankr.com/linea/${ANKR_KEY}`,
  },
];

function getDefaultProviderURL(network: string) {
  return `https://rpc.ankr.com/${network}/${ANKR_KEY}`;
}

function setupDefaultNetworkProviders(hardhatConfig: HardhatUserConfig) {
  for (const netConfig of networkConfigs) {
    hardhatConfig.networks[netConfig.network] = {
      chainId: netConfig.chainId,
      url:
        (netConfig.network === GOV_NETWORK ? GOV_NETWORK_PROVIDER || undefined : undefined) ||
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
    optimismSepolia: {
      url: 'https://sepolia.optimism.io',
      chainId: 11155420
    },
    arbitrumSepolia: {
      url: 'https://arbitrum-sepolia.blockpi.network/v1/rpc/public',
      chainId: 421614
    },
    mainnetSepolia: {
      url: 'https://ethereum-sepolia.blockpi.network/v1/rpc/public',
      chainId: 11155111
    },
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
        if (chainId === 59144) {
          acc[chainId] = {
            hardforkHistory: {
              berlin: 1,
              london: 2,
            }
          };
          return acc;
        }
        if (chainId === 42161) {
          acc[chainId] = {
            hardforkHistory: {
              berlin: 1,
              london: 2,
            }
          };
          return acc;
        }
        if (chainId === 5000) {
          acc[chainId] = {
            hardforkHistory: {
              berlin: 1,
              london: 2,
            }
          };
          return acc;
        }
        if (chainId === 137) {
          acc[chainId] = {
            hardforkHistory: {
              berlin: 1,
              london: 2,
            }
          };
          return acc;
        }
        if (chainId === 534352) {
          acc[chainId] = {
            hardforkHistory: {
              berlin: 1,
              london: 2,
            }
          };
          return acc;
        }
        if (chainId === 2020) {
          acc[chainId] = {
            hardforkHistory: {
              berlin: 1,
              london: 2,
            }
          };
          return acc;
        }
        if (chainId === 42161) {
          acc[chainId] = {
            hardforkHistory: {
              berlin: 1,
              london: 2,
              shanghai: 3,
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
      polygon: ETHERSCAN_KEY,
      // Arbitrum
      arbitrumOne: ETHERSCAN_KEY,
      arbitrumTestnet: ETHERSCAN_KEY,
      arbitrum: ETHERSCAN_KEY,
      // Base
      base: ETHERSCAN_KEY,
      // optimism: OPTIMISMSCAN_KEY,
      optimisticEthereum: ETHERSCAN_KEY,
      // Mantle
      mantle: ETHERSCAN_KEY,
      unichain: ETHERSCAN_KEY,
      // Scroll
      'scroll': ETHERSCAN_KEY,
      linea: ETHERSCAN_KEY,
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
        network: 'linea',
        chainId: 59144,
        urls: {
          apiURL: 'https://api.lineascan.build/api',
          browserURL: 'https://lineascan.build/'
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
        'usdc': unichainRelationConfigMap,
        'weth': unichainWETHRelationConfigMap
      },
      'scroll': {
        usdc: scrollRelationConfigMap
      },
      'ronin': {
        weth: roninRelationConfigMap,
        wron: roninWronRelationConfigMap
      },
      'linea': {
        usdc: lineaUsdcRelationConfigMap,
        weth: lineaWethRelationConfigMap
      },
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
        name: 'unichain-weth',
        network: 'unichain',
        deployment: 'weth',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'scroll-usdc',
        network: 'scroll',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'linea-usdc',
        network: 'linea',
        deployment: 'usdc',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'linea-weth',
        network: 'linea',
        deployment: 'weth',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'ronin-weth',
        network: 'ronin',
        deployment: 'weth',
        auxiliaryBase: 'mainnet'
      },
      {
        name: 'ronin-wron',
        network: 'ronin',
        deployment: 'wron',
        auxiliaryBase: 'mainnet'
      },
    ],
  },

  tenderly: {
    project: 'comet',
    username: process.env.TENDERLY_USERNAME || '',
    accessKey: process.env.TENDERLY_ACCESS_KEY || '',
    privateVerification: false,
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
