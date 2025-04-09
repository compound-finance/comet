import axios from 'axios';

export interface Result {
  status: string;
  message: string;
  result: string;
}

export function getEtherscanApiUrl(network: string): string {
  let host = {
    rinkeby: 'api-rinkeby.etherscan.io',
    ropsten: 'api-ropsten.etherscan.io',
    sepolia: 'api-sepolia.etherscan.io',
    mainnet: 'api.etherscan.io',
    fuji: 'api-testnet.snowtrace.io',
    avalanche: 'api.snowtrace.io',
    polygon: 'api.polygonscan.com',
    arbitrum: 'api.arbiscan.io',
    base: 'api.basescan.org',
    optimism: 'api-optimistic.etherscan.io',
    mantle: 'api.mantlescan.xyz',
    linea: 'api.lineascan.build',
    scroll: 'api.scrollscan.com'
  }[network];

  if (!host) {
    throw new Error(`Unknown etherscan API host for network ${network}`);
  }

  return `https://${host}/api`;
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
    polygon: process.env.POLYGONSCAN_KEY,
    arbitrum: process.env.ARBISCAN_KEY,
    base: process.env.BASESCAN_KEY,
    optimism: process.env.OPTIMISMSCAN_KEY,
    mantle: process.env.MANTLESCAN_KEY,
    linea: process.env.LINEASCAN_KEY,
    scroll: process.env.SCROLLSCAN_KEY
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
