import axios from 'axios';
import { networkConfigs } from '../../hardhat.config';

export interface Result {
  status: string;
  message: string;
  result: string;
}

// Updated because of Etherscan V2 update. Not tested and could lead to issues
export function getEtherscanApiUrl(network: string): string {
  // let host = {
  //   rinkeby: 'api-rinkeby.etherscan.io',
  //   ropsten: 'api-ropsten.etherscan.io',
  //   sepolia: 'api-sepolia.etherscan.io',
  //   mainnet: 'api.etherscan.io',
  //   fuji: 'api-testnet.snowtrace.io',
  //   avalanche: 'api.snowtrace.io',
  //   polygon: 'api.polygonscan.com',
  //   arbitrum: 'api.arbiscan.io',
  //   base: 'api.basescan.org',
  //   optimism: 'api-optimistic.etherscan.io',
  //   mantle: 'api.mantlescan.xyz',
  //   'ronin': 'explorer-kintsugi.roninchain.com/v2/2020',
  //   scroll: 'api.scrollscan.com'
  // }[network];

  // if (!host) {
  //   throw new Error(`Unknown etherscan API host for network ${network}`);
  // }

  const chainId = networkConfigs.find(config => config.network.toLowerCase() === network.toLowerCase())?.chainId;

  if (!chainId) {
    throw new Error(`Unknown etherscan API host for network ${network}`);
  }

  if (network === 'avalanche') {
    return `https://api.snowtrace.io/api`;
  } else if (network === 'fuji') {
    return `https://api-testnet.snowtrace.io/api`;
  }

  return `https://api.etherscan.io/v2/api?chainid=${chainId}`;
}

export function getEtherscanUrl(network: string): string {
  let host = {
    rinkeby: 'rinkeby.etherscan.io',
    ropsten: 'ropsten.etherscan.io',
    sepolia: 'sepolia.etherscan.io',
    mainnet: 'etherscan.io',
    fuji: 'testnet.snowtrace.io',
    avalanche: 'snowtrace.io',
    polygon: 'polygonscan.com',
    arbitrum: 'arbiscan.io',
    base: 'basescan.org',
    optimism: 'optimistic.etherscan.io',
    mantle: 'mantlescan.xyz',
    linea: 'lineascan.build',
    'ronin': 'explorer-kintsugi.roninchain.com/v2/2020',
    scroll: 'scrollscan.com'
  }[network];

  if (!host) {
    throw new Error(`Unknown etherscan host for network ${network}`);
  }

  return `https://${host}`;
}

export function getEtherscanApiKey(network: string): string {
  let apiKey = {
    rinkeby: process.env.ETHERSCAN_KEY,
    ropsten: process.env.ETHERSCAN_KEY,
    sepolia: process.env.ETHERSCAN_KEY,
    mainnet: process.env.ETHERSCAN_KEY,
    fuji: process.env.SNOWTRACE_KEY,
    avalanche: process.env.SNOWTRACE_KEY,
    polygon: process.env.ETHERSCAN_KEY,
    arbitrum: process.env.ETHERSCAN_KEY,
    base: process.env.ETHERSCAN_KEY,
    optimism: process.env.ETHERSCAN_KEY,
    mantle: process.env.ETHERSCAN_KEY,
    scroll: process.env.ETHERSCAN_KEY,
    linea: process.env.ETHERSCAN_KEY,
  }[network];

  if (!apiKey) {
    throw new Error(`Unknown etherscan API key for network ${network}`);
  }

  return apiKey;
}

export async function get(url, data) {
  const res = (await axios.get(url, { params: data }))['data'];
  return res;
}

export async function post(url, data) {
  const res = (await axios.post(url, data))['data'];
  return res;
}
