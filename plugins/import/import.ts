import { get, getEtherscanApiKey, getEtherscanApiUrl, getEtherscanUrl } from './etherscan';

export function debug(...args: any[]) {
  if (process.env['DEBUG']) {
    if (typeof args[0] === 'function') {
      console.log(...args[0]());
    } else {
      console.log(...args);
    }
  }
}

/**
 * Copied from Saddle import with some small modifications.
 *
 * NOTE: This program also exists as a Hardhat plugin in a separate repo, but we
 * are temporarily moving it back into the protocol repo for easier development.
 */

export async function loadContract(source: string, network: string, address: string) {
  if (address === '0x0000000000000000000000000000000000000000') {
    throw new Error(`Cannot load ${source} contract for address ${address} on network ${network}. Address invalid.`);
  }
  switch (source) {
    case 'etherscan':
      return await loadEtherscanContract(network, address);
    default:
      throw new Error(`Unknown source \`${source}\`, expected one of [etherscan]`);
  }
}

interface EtherscanSource {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  Runs: string;
  ConstructorArguments: string;
  Library: string;
  LicenseType: string;
  SwarmSource: string;
}

interface EtherscanData {
  source: string;
  abi: object;
  contract: string;
  compiler: string;
  optimized: boolean;
  optimizationRuns: number;
  constructorArgs: string;
}

async function getEtherscanApiData(network: string, address: string, apiKey: string): Promise<EtherscanData> {
  let apiUrl = await getEtherscanApiUrl(network);

  let result = await get(apiUrl, {
    module: 'contract',
    action: 'getsourcecode',
    address,
    apikey: apiKey,
  });

  if (result.status !== '1') {
    throw new Error(`Etherscan Error: ${result.message} - ${result.result}`);
  }

  let s = <EtherscanSource>(<unknown>result.result[0]);

  if (s.ABI === 'Contract source code not verified') {
    throw new Error('Contract source code not verified');
  }

  return {
    source: s.SourceCode,
    abi: JSON.parse(s.ABI),
    contract: s.ContractName,
    compiler: s.CompilerVersion,
    optimized: s.OptimizationUsed !== '0',
    optimizationRuns: Number(s.Runs),
    constructorArgs: s.ConstructorArguments,
  };
}

async function scrapeContractCreationCodeFromEtherscan(network: string, address: string) {
  const url = `${getEtherscanUrl(network)}/address/${address}#code`;
  debug(`Attempting to scrape Contract Creation code at ${url}`);
  const result = <string>await get(url, {});
  const regex = /<div id='verifiedbytecode2'>[\s\r\n]*([0-9a-fA-F]*)[\s\r\n]*<\/div>/g;
  const matches = [...result.matchAll(regex)];
  if (matches.length === 0) {
    if (result.match(/request throttled/i) || result.match(/try again later/i)) {
      throw new Error(`Request throttled: ${url}`);
    } else {
      throw new Error(`Failed to pull deployed contract code from Etherscan: ${url}`);
    }
  }
  debug(`Scraping successful for ${url}`);
  return matches[0][1];
}

function paramString(params: { [k: string]: string | number }) {
  return Object.entries(params).map(([k,v]) => `${k}=${v}`).join('&');
}

async function pullFirstTransactionForContract(network: string, address: string) {
  const params = {
    module: 'account',
    action: 'txlist',
    address,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: 10,
    sort: 'asc',
    apikey: getEtherscanApiKey(network)
  };
  const url = `${getEtherscanApiUrl(network)}?${paramString(params)}`;
  const debugUrl = `${getEtherscanApiUrl(network)}?${paramString({ ...params, ...{ apikey: '[API_KEY]'}})}`;

  debug(`Attempting to pull Contract Creation code from first tx at ${debugUrl}`);
  const result = await get(url, {});
  const contractCreationCode = result.result[0].input;
  if (!contractCreationCode) {
    throw new Error(`Unable to find Contract Creation tx at ${debugUrl}`);
  }
  debug(`Creation Code found in first tx at ${debugUrl}`);
  return contractCreationCode.slice(2);
}

async function getContractCreationCode(network: string, address: string) {
  const strategies = [
    scrapeContractCreationCodeFromEtherscan,
    pullFirstTransactionForContract
  ];
  let errors = [];
  for (const strategy of strategies) {
    try {
      return await strategy(network, address);
    } catch (error) {
      errors.push(error);
    }
  }
  throw new Error(errors.join('; '));
}

function parseSources({ source, contract, optimized, optimizationRuns }: EtherscanData) {
  if (source.startsWith('{') && source.endsWith('}')) {
    const sliced = source.slice(1, -1);
    if (sliced.startsWith('{') && sliced.endsWith('}')) {
      return JSON.parse(sliced);
    } else {
      return {
        language: 'Solidity',
        settings: {
          optimizer: {
            enabled: optimized,
            runs: optimizationRuns,
          }
        },
        sources: JSON.parse(source)
      };
    }
  } else {
    // Note: legacy for tests, but is this even right?
    return {
      language: 'Solidity',
      settings: {
        optimizer: {
          enabled: optimized,
          runs: optimizationRuns,
        }
      },
      sources: {
        [`contracts/${contract}.sol`]: {
          content: source,
          keccak256: '',
        }
      }
    };
  }
}

export async function loadEtherscanContract(network: string, address: string) {
  const apiKey = getEtherscanApiKey(network);
  const networkName = network;
  const etherscanData = await getEtherscanApiData(networkName, address, apiKey);
  const {
    abi,
    contract,
    compiler,
    constructorArgs
  } = etherscanData;
  const { language, settings, sources } = parseSources(etherscanData);
  const contractPath = Object.keys(sources)[0];
  const contractFQN = `${contractPath}:${contract}`;

  let contractCreationCode = await getContractCreationCode(networkName, address);
  if (constructorArgs.length > 0 && contractCreationCode.endsWith(constructorArgs)) {
    contractCreationCode = contractCreationCode.slice(0, -constructorArgs.length);
  }

  const encodedABI = JSON.stringify(abi);
  const contractBuild = {
    contract,
    contracts: {
      [contractFQN]: {
        network,
        address,
        name: contract,
        abi: encodedABI,
        bin: contractCreationCode,
        constructorArgs,
        metadata: JSON.stringify({
          compiler: {
            version: compiler,
          },
          language,
          output: {
            abi: encodedABI,
          },
          devdoc: {},
          sources,
          settings,
          version: 1,
        }),
      },
    },
    version: compiler,
  };

  return contractBuild;
}
