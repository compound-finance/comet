import axios from 'axios';

export interface Result {
  status: string;
  message: string;
  result: string;
}

export function getBlockscoutApiUrl(network: string): string {
  let host = {
    'unichain-sepolia': 'unichain-sepolia.blockscout.com',
  }[network];

  if (!host) {
    throw new Error(`Unknown blockscout API host for network ${network}`);
  }

  return `https://${host}/api`;
}

export function getBlockscoutUrl(network: string): string {
  let host = {
    'unichain-sepolia': 'unichain-sepolia.blockscout.com',
  }[network];

  if (!host) {
    throw new Error(`Unknown blockscout host for network ${network}`);
  }

  return `https://${host}`;
}

export async function getBlockscoutRPCUrl(network: string): Promise<string> {
  let host = {
    'unichain-sepolia': 'sepolia.unichain.org',
  }[network];

  if (!host) {
    throw new Error(`Unknown blockscout RPC host for network ${network}`);
  }

  return `https://${host}`;
}

export async function get(url, data) {
  const res = (await axios.get(url, { params: data }))['data'];
  return res;
}

