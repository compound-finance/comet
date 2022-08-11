import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Address, BuildFile } from './Types';
import { getBuildFile, storeBuildFile } from './ContractMap';
import { Cache } from './Cache';
import { loadContract } from '../import/import';

const DEFAULT_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 10_000;

/**
 * Imports a contract from remote, e.g. Etherscan, generating local build file.
 */
export async function fetchAndCacheContract(
  cache: Cache,
  network: string,
  address: Address,
  importRetries = DEFAULT_RETRIES,
  importRetryDelay = DEFAULT_RETRY_DELAY,
  force = false
): Promise<BuildFile> {
  const buildFile = await fetchContract(cache, network, address, importRetries, importRetryDelay, force);
  await storeBuildFile(cache, network, address, buildFile);
  return buildFile;
}

// Wrapper for pulling contract data from Etherscan
export async function importContract(
  network: string,
  address: Address,
  retries: number = DEFAULT_RETRIES,
  retryDelay: number = DEFAULT_RETRY_DELAY
): Promise<BuildFile> {
  try {
    console.log(`Importing ${address} from ${network} etherscan`);
    return (await loadContract('etherscan', network, address)) as BuildFile;
  } catch (e) {
    if (retries === 0 || (e.message && e.message.includes('Contract source code not verified'))) {
      throw e;
    }

    console.warn(`Import failed for ${network}@${address} (${e.message}), retrying in ${retryDelay / 1000}s; ${retries} retries left`);

    await new Promise(ok => setTimeout(ok, retryDelay));
    return importContract(network, address, retries - 1, retryDelay * 2);
  }
}

// Reads a contract if exists in cache, otherwise attempts to import contract by address
export async function fetchContract(
  cache: Cache,
  network: string,
  address: Address,
  importRetries = DEFAULT_RETRIES,
  importRetryDelay = DEFAULT_RETRY_DELAY,
  force = false
): Promise<BuildFile> {
  const cachedBuildFile = !force && await getBuildFile(cache, network, address);
  if (cachedBuildFile) {
    return cachedBuildFile;
  } else {
    return importContract(network, address, importRetries, importRetryDelay);
  }
}

// Reads a contract if exists in cache, otherwise attempts to load contract by artifact
export async function readContract(
  cache: Cache,
  hre: HardhatRuntimeEnvironment,
  fullyQualifiedName: string,
  network: string,
  address: Address,
  force = false
): Promise<BuildFile> {
  const cachedBuildFile = !force && await getBuildFile(cache, network, address);
  if (cachedBuildFile) {
    return cachedBuildFile;
  } else {
    const artifact = await hre.artifacts.readArtifact(fullyQualifiedName);
    const buildInfo = await hre.artifacts.getBuildInfo(fullyQualifiedName);
    return {
      contract: artifact.contractName,
      contracts: {
        [`${artifact.sourceName}:${artifact.contractName}`]: {
          address,
          name: artifact.contractName,
          abi: artifact.abi,
          bin: artifact.bytecode,
          metadata: 'unknown',
          source: buildInfo.input.sources[artifact.sourceName].content,
          constructorArgs: 'unknown',
        },
      },
      version: buildInfo.solcLongVersion,
    };
  }
}
