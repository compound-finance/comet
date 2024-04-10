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
    goerli: 'api-goerli.etherscan.io',
    sepolia: 'api-sepolia.etherscan.io',
    mainnet: 'api.etherscan.io',
    fuji: 'api-testnet.snowtrace.io',
    avalanche: 'api.snowtrace.io',
    mumbai: 'api-mumbai.polygonscan.com',
    polygon: 'api.polygonscan.com',
    arbitrum: 'api.arbiscan.io',
    'arbitrum-goerli': 'api-goerli.arbiscan.io',
    base: 'api.basescan.org',
    'base-goerli': 'api-goerli.basescan.org',
    'linea-goerli': 'api-goerli.lineascan.build',
    optimism: 'api-optimistic.etherscan.io',
    'scroll-goerli': 'alpha-blockscout.scroll.io',
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
    goerli: 'goerli.etherscan.io',
    sepolia: 'sepolia.etherscan.io',
    mainnet: 'etherscan.io',
    fuji: 'testnet.snowtrace.io',
    avalanche: 'snowtrace.io',
    mumbai: 'mumbai.polygonscan.com',
    polygon: 'polygonscan.com',
    arbitrum: 'arbiscan.io',
    'arbitrum-goerli': 'goerli.arbiscan.io',
    base: 'basescan.org',
    'base-goerli': 'goerli.basescan.org',
    'linea-goerli': 'goerli.lineascan.build',
    optimism: 'optimistic.etherscan.io',
    'scroll-goerli': 'alpha-blockscout.scroll.io',
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
    goerli: process.env.ETHERSCAN_KEY,
    sepolia: process.env.ETHERSCAN_KEY,
    mainnet: process.env.ETHERSCAN_KEY,
    fuji: process.env.SNOWTRACE_KEY,
    avalanche: process.env.SNOWTRACE_KEY,
    mumbai: process.env.POLYGONSCAN_KEY,
    polygon: process.env.POLYGONSCAN_KEY,
    arbitrum: process.env.ARBISCAN_KEY,
    'arbitrum-goerli': process.env.ARBISCAN_KEY,
    base: process.env.BASESCAN_KEY,
    'base-goerli': process.env.BASESCAN_KEY,
    'linea-goerli': process.env.LINEASCAN_KEY,
    optimism: process.env.OPTIMISMSCAN_KEY,
    'scroll-goerli': process.env.ETHERSCAN_KEY,
    scroll: process.env.ETHERSCAN_KEY
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
