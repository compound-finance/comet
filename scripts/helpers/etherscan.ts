import request from 'request';

export interface Result {
  status: string
  message: string
  result: string
}

export function getEtherscanApiUrl(network: string): string {
  let host = {
    kovan: 'api-kovan.etherscan.io',
    rinkeby: 'api-rinkeby.etherscan.io',
    ropsten: 'api-ropsten.etherscan.io',
    goerli: 'api-goerli.etherscan.io',
    mainnet: 'api.etherscan.io'
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
    mainnet: 'etherscan.io'
  }[network];

  if (!host) {
    throw new Error(`Unknown etherscan host for network ${network}`);
  }

  return `https://${host}`;
}

export function post(url, data): Promise<object> {
  return new Promise((resolve, reject) => {
    request.post(url, {form: data}, (err, httpResponse, body) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(body));
      }
    });
  });
}

export function get(url, data, parser: any=JSON.parse): Promise<object | string> {
  return new Promise((resolve, reject) => {
    request.get(url, {form: data}, (err, httpResponse, body) => {
      if (err) {
        reject(err);
      } else {
        resolve(parser ? parser(body): body);
      }
    });
  });
}