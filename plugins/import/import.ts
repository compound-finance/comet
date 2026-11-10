import { get, getEtherscanApiKey, getEtherscanApiUrl, getEtherscanUrl } from './etherscan';
import { getBlockscoutApiUrl } from './blockscout';

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
    case 'blockscout':
      return await loadBlockscoutContract(network, address);
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

interface BlockscoutSource {
  SourceCode: string;
  ABI: string;
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string;
  OptimizationRuns: string;
  ConstructorArguments: string;
  Library: string;
  LicenseType: string;
  SwarmSource: string;
  ImplementationAddress: string;
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

async function pullFirstTransactionForContractFromBlockscout(network: string, address: string) {
  const params = {
    module: 'account',
    action: 'txlist',
    address: address,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: 10,
    sort: 'asc',
  };
  const url = `${getBlockscoutApiUrl(network)}?${paramString(params)}`;
  const debugUrl = `${getBlockscoutApiUrl(network)}?${paramString(params)}`;

  debug(`Attempting to pull Contract Creation code from first tx at ${debugUrl}`);
  const result = await get(url, {});

  const contractCreationCode = result.result?.[0]?.input;
  if (!contractCreationCode) {
    throw new Error(`Unable to find Contract Creation tx at ${debugUrl}`);
  }
  debug(`Creation Code found in first tx at ${debugUrl}`);
  return contractCreationCode.slice(2);
}

// Sourcify chain IDs for networks whose own Blockscout instance has real gaps in verification
// coverage that Sourcify's independent verification database fills — seen repeatedly for Ronin
// contracts verified via Sourcify but not (yet, or ever) through explorer.roninchain.com itself.
const sourcifyChainIds: { [network: string]: number } = {
  ronin: 2020,
};

async function getSourcifyApiData(network: string, address: string): Promise<EtherscanData> {
  const chainId = sourcifyChainIds[network];
  if (!chainId) {
    throw new Error('Contract source code not verified');
  }

  const result = await get(`https://sourcify.dev/server/v2/contract/${chainId}/${address}`, {
    fields: 'abi,compilation,metadata,sources',
  });

  if (!result?.metadata) {
    throw new Error('Contract source code not verified');
  }

  const { abi, compilation, metadata, sources } = result;

  return {
    // Etherscan's SourceCode field double-wraps standard-json-input sources in an extra pair
    // of braces (see parseSources() below); mimic that so multi-file Sourcify sources parse
    // the same way, using real file content instead of just the keccak256/urls that
    // metadata.sources normally carries.
    source: `{${JSON.stringify({ ...metadata, sources })}}`,
    abi,
    contract: compilation.name,
    compiler: compilation.compilerVersion,
    optimized: metadata.settings?.optimizer?.enabled ?? false,
    optimizationRuns: metadata.settings?.optimizer?.runs ?? 0,
    // Sourcify's creation-time constructor args aren't fetched here, so contractCreationCode
    // won't get its constructor-args suffix stripped for this fallback path — a minor
    // completeness gap, not a correctness one (bin just retains that trailing data).
    constructorArgs: '',
  };
}

async function getBlockscoutApiData(
  network: string,
  address: string,
  retries: number = 3,
  retryDelay: number = 2000
): Promise<EtherscanData> {
  let apiUrl = await getBlockscoutApiUrl(network);

  let result = await get(apiUrl, {
    module: 'contract',
    action: 'getsourcecode',
    address,
  });

  if (result.status !== '1') {
    throw new Error(`Blockscout Error: ${result.message} - ${result.result}`);
  }

  let s = <BlockscoutSource>(<unknown>result.result[0]);

  if (s.ABI === 'Contract source code not verified') {
    return await getSourcifyApiData(network, address);
  }

  if (!s.ABI) {
    // For networks with a Sourcify fallback configured, an incomplete Blockscout response has
    // consistently turned out to be permanent (Blockscout never gets it), not transient — so
    // retrying Blockscout here just wastes up to ~14s per contract for nothing. Go straight to
    // Sourcify instead. Networks without a Sourcify fallback keep the retry-then-fail behavior,
    // since for those an incomplete response really has been a transient hiccup.
    if (sourcifyChainIds[network]) {
      return await getSourcifyApiData(network, address);
    }

    if (retries === 0) {
      throw new Error('Contract source code not verified');
    }

    debug(`Blockscout returned an incomplete response for ${network}@${address}, retrying in ${retryDelay / 1000}s; ${retries} retries left`);

    await new Promise(ok => setTimeout(ok, retryDelay));
    return getBlockscoutApiData(network, address, retries - 1, retryDelay * 2 > 10000 ? 10000 : retryDelay * 2);
  }

  return {
    source: s.SourceCode,
    abi: JSON.parse(s.ABI),
    contract: s.ContractName,
    compiler: s.CompilerVersion,
    optimized: s.OptimizationUsed !== '0',
    optimizationRuns: Number(s.OptimizationRuns),
    constructorArgs: s.ConstructorArguments,
  };
}

// Blockscout v2 returns the code that created the contract, even when a factory deployed it.
// Don't swap this for eth_getCode: that returns the code already deployed at the address,
// which reverts when deployed again as if it were creation code.
async function pullContractCreationCodeFromBlockscoutV2(network: string, address: string) {
  const url = `${getBlockscoutApiUrl(network)}/v2/smart-contracts/${address}`;

  debug(`Attempting to pull Contract Creation code from ${url}`);
  const result = await get(url, {});

  const contractCreationCode = result?.creation_bytecode;
  if (!contractCreationCode) {
    throw new Error(`Unable to find Contract Creation code at ${url}`);
  }
  debug(`Creation Code found at ${url}`);
  return contractCreationCode.slice(2);
}

async function getContractCreationCodeFromBlockscout(network: string, address: string) {
  const strategies = [
    pullContractCreationCodeFromBlockscoutV2,
    pullFirstTransactionForContractFromBlockscout,
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

export async function loadBlockscoutContract(network: string, address: string) {
  const networkName = network;
  const blockscoutData = await getBlockscoutApiData(networkName, address);
  const {
    abi,
    contract,
    compiler,
    constructorArgs
  } = blockscoutData;
  const { language, settings, sources } = parseSources(blockscoutData);
  const contractPath = Object.keys(sources)[0];
  const contractFQN = `${contractPath}:${contract}`;


  let contractCreationCode = await getContractCreationCodeFromBlockscout(networkName, address);

  if (constructorArgs?.length > 0 && contractCreationCode?.endsWith(constructorArgs)) {
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

  // check if this is a contract and not a wallet
  if (!s.SourceCode || !s.ABI || !s.ContractName) {
    throw new Error(`No source code found for address ${address} on network ${network}.`);
  }

  if (s.ABI === 'Contract source code not verified') {
    throw new Error(`Contract source code not verified for address ${address} on network ${network}.`);
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

async function scrapeContractCreationCodeFromEtherscanApi(network: string, address: string, i?: number) {
  const params = {
    module: 'proxy',
    action: 'eth_getCode',
    address,
    apikey: getEtherscanApiKey(network, i)
  };
  const url = `${getEtherscanApiUrl(network)}&${paramString(params)}`;
  const debugUrl = `${getEtherscanApiUrl(network)}&${paramString({ ...params, ...{ apikey: '[API_KEY]' } })}`;

  debug(`Attempting to pull Contract Creation code from API at ${debugUrl}`);
  const result = await get(url, {});
  const contractCreationCode = result.result;
  if (!contractCreationCode) {
    throw new Error(`Unable to find Contract Creation code from API at ${debugUrl}`);
  }
  debug(`Creation Code found in first tx at ${debugUrl}`);
  return contractCreationCode.slice(2);
}

/**
 * @description Does not work for 0x566511a1A09561e2896F8c0fD77E8544E59bFDB0 as etherscan starts using some firewall
 */
async function scrapeContractCreationCodeFromEtherscan(network: string, address: string) {
  const url = `${getEtherscanUrl(network)}/address/${address}#code`;
  debug(`Attempting to scrape Contract Creation code at ${url}`);
  const result = <string>await get(url, {});
  const regex = /<div id='verifiedbytecode2'>[\s\r\n]*([0-9a-fA-F]*)[\s\r\n]*<\/div>/g;
  const regexDoubleQuotes = /<div id="verifiedbytecode2">[\s\r\n]*([0-9a-fA-F]*)[\s\r\n]*<\/div>/g;
  const matches = [...result.matchAll(regex), ...result.matchAll(regexDoubleQuotes)];
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
  return Object.entries(params).map(([k, v]) => `${k}=${v}`).join('&');
}

async function pullFirstTransactionForContractFromEtherscan(network: string, address: string, i?: number) {
  const params = {
    module: 'account',
    action: 'txlist',
    address,
    startblock: 0,
    endblock: 99999999,
    page: 1,
    offset: 10,
    sort: 'asc',
    apikey: getEtherscanApiKey(network, i)
  };
  const url = `${getEtherscanApiUrl(network)}&${paramString(params)}`;
  const debugUrl = `${getEtherscanApiUrl(network)}&${paramString({ ...params, ...{ apikey: '[API_KEY]' } })}`;

  debug(`Attempting to pull Contract Creation code from first tx at ${debugUrl}`);
  const result = await get(url, {});
  const contractCreationCode = result.result[0].input;
  if (!contractCreationCode) {
    throw new Error(`Unable to find Contract Creation tx at ${debugUrl}`);
  }
  debug(`Creation Code found in first tx at ${debugUrl}`);
  return contractCreationCode.slice(2);
}

async function getContractCreationCode(network: string, address: string, i: number = 0) {
  const strategies = [
    (net: string, addr: string) => scrapeContractCreationCodeFromEtherscan(net, addr),
    (net: string, addr: string) => scrapeContractCreationCodeFromEtherscanApi(net, addr, i),
    (net: string, addr: string) => pullFirstTransactionForContractFromEtherscan(net, addr, i),
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
  const networkName = network;
  const maxRetries = 12; // Maximum number of API key rotations
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const apiKey = getEtherscanApiKey(network, i);
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

      let contractCreationCode = await getContractCreationCode(networkName, address, i);
      if (contractCreationCode.endsWith(constructorArgs) && constructorArgs.length > 0) {
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
    } catch (error) {
      lastError = error;
      debug(`Attempt ${i + 1} failed for loadEtherscanContract: ${error.message}`);
      if (i < maxRetries - 1) {
        debug(`Retrying with next API key...`);
      }
    }
  }

  throw new Error(`Failed to load Etherscan contract after ${maxRetries} attempts: ${lastError?.message}`);
}