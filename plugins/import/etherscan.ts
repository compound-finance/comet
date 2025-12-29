import axios from 'axios';
import { networkConfigs } from '../../hardhat.config';

export interface Result {
  status: string;
  message: string;
  result: string;
}

// Updated because of Etherscan V2 update. Not tested and could lead to issues
export function getEtherscanApiUrl(network: string): string {
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

export function getEtherscanApiKey(network: string, i?: number): string {
  // Primary key for each network
  const primaryKeys = {
    sepolia: process.env.ETHERSCAN_KEY,
    mainnet: process.env.ETHERSCAN_KEY,
    fuji: process.env.SNOWTRACE_KEY,
    avalanche: process.env.SNOWTRACE_KEY,
    polygon: process.env.ETHERSCAN_KEY_FOR_POLYGON,
    arbitrum: process.env.ETHERSCAN_KEY_FOR_ARBITRUM,
    base: process.env.ETHERSCAN_KEY_FOR_BASE,
    optimism: process.env.ETHERSCAN_KEY_FOR_OPTIMISM,
    mantle: process.env.ETHERSCAN_KEY,
    scroll: process.env.ETHERSCAN_KEY,
    linea: process.env.ETHERSCAN_KEY_FOR_LINEA,
  };

  // All available keys for rotation (after primary)
  const allKeys = [
    process.env.ETHERSCAN_KEY,
    process.env.ETHERSCAN_KEY_FOR_POLYGON,
    process.env.ETHERSCAN_KEY_FOR_ARBITRUM,
    process.env.ETHERSCAN_KEY_FOR_BASE,
    process.env.ETHERSCAN_KEY_FOR_OPTIMISM,
    process.env.ETHERSCAN_KEY_FOR_LINEA
  ].filter(key => key !== undefined && key !== '');

  const primaryKey = primaryKeys[network];
  
  if (!primaryKey && allKeys.length === 0) {
    throw new Error(`No etherscan API keys configured for network ${network}`);
  }

  // If 'i' is not provided or is 0, return primary key
  if (i === undefined || i === 0) {
    if (!primaryKey) {
      throw new Error(`No primary etherscan API key configured for network ${network}`);
    }
    return primaryKey;
  }

  // For i > 0, rotate through all available keys
  if (allKeys.length === 0) {
    throw new Error(`No additional etherscan API keys available for rotation`);
  }

  const keyIndex = (i - 1) % allKeys.length;
  return allKeys[keyIndex];
}

export async function get(url, data) {
  const res = (await axios.get(url, { params: data }))['data'];
  return res;
}

export async function post(url, data) {
  const res = (await axios.post(url, data))['data'];
  return res;
}
