import { Address, BuildFile } from './Types';
import { getBuildFile, storeBuildFile } from './ContractMap';
import { Cache } from './Cache';
import { loadContract } from '../import/import';

const DEFAULT_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 7500;

/**
 * Imports a contract from remote, e.g. Etherscan, generating local build file.
 */
export async function fetchAndCacheContract(
  cache: Cache,
  network: string,
  address: Address,
  importRetries = DEFAULT_RETRIES,
  importRetryDelay = DEFAULT_RETRY_DELAY
): Promise<BuildFile> {
  // TODO: Handle storing to a different deployment?
  let buildFile = await fetchContract(cache, network, address, importRetries, importRetryDelay);
  await storeBuildFile(cache, address, buildFile);
  return buildFile;
}

// Wrapper for pulling contract data from Etherscan
export async function importContract(
  network: string,
  address: Address,
  retries: number = DEFAULT_RETRIES,
  retryDelay: number = DEFAULT_RETRY_DELAY
): Promise<BuildFile> {
  let buildFile;
  try {
    buildFile = (await loadContract('etherscan', network, address)) as BuildFile;
  } catch (e) {
    if (retries === 0 || (e.message && e.message.includes('Contract source code not verified'))) {
      throw e;
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelay));
    return await importContract(network, address, retries - 1, retryDelay);
  }

  return buildFile;
}

// Reads a contract if exists in cache, otherwise attempts to import contract by address
export async function fetchContract(
  cache: Cache,
  network: string,
  address: Address,
  importRetries = DEFAULT_RETRIES,
  importRetryDelay = DEFAULT_RETRY_DELAY
): Promise<BuildFile> {
  let cachedBuildFile = await getBuildFile(cache, address);
  if (cachedBuildFile) {
    return cachedBuildFile;
  } else {
    return await importContract(network, address, importRetries, importRetryDelay);
  }
}
