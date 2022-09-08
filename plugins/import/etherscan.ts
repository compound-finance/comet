import axios from 'axios';

export interface Result {
  status: string;
  message: string;
  result: string;
}

export function getEtherscanApiUrl(network: string): string {
  let host = {
    kovan: 'api-kovan.etherscan.io',
    rinkeby: 'api-rinkeby.etherscan.io',
    ropsten: 'api-ropsten.etherscan.io',
    goerli: 'api-goerli.etherscan.io',
    mainnet: 'api.etherscan.io',
    fuji: 'api-testnet.snowtrace.io',
    avalanche: 'api.snowtrace.io',
    mumbai: 'api-mumbai.polygonscan.com',
    polygon: 'api.polygonscan.com'
  }[network];

  if (!host) {
    throw new Error(`Unknown etherscan API host for network ${network}`);
  }

  return `https://${host}/api`;
}

export function getEtherscanUrl(network: string): string {
  let host = {
    kovan: 'kovan.etherscan.io',
    rinkeby: 'rinkeby.etherscan.io',
    ropsten: 'ropsten.etherscan.io',
    goerli: 'goerli.etherscan.io',
    mainnet: 'etherscan.io',
    fuji: 'testnet.snowtrace.io',
    avalanche: 'snowtrace.io',
    mumbai: 'mumbai.polygonscan.com',
    polygon: 'polygonscan.com',
  }[network];

  if (!host) {
    throw new Error(`Unknown etherscan host for network ${network}`);
  }

  return `https://${host}`;
}

export function getEtherscanApiKey(network: string): string {
  let apiKey = {
    kovan: process.env.ETHERSCAN_KEY,
    rinkeby: process.env.ETHERSCAN_KEY,
    ropsten: process.env.ETHERSCAN_KEY,
    goerli: process.env.ETHERSCAN_KEY,
    mainnet: process.env.ETHERSCAN_KEY,
    fuji: process.env.SNOWTRACE_KEY,
    avalanche: process.env.SNOWTRACE_KEY,
    mumbai: process.env.POLYGONSCAN_KEY,
    polygon: process.env.POLYGONSCAN_KEY,
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
