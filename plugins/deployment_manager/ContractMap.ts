import { Contract, Signer } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { Cache, FileSpec } from './Cache';
import { ABI, Address, Alias, BuildFile } from './Types';
import { Aliases, getAliases } from './Aliases';
import { Proxies, getProxies } from './Proxies';
import { debug, getPrimaryContract, mergeABI } from './Utils';

export type ContractMap = Map<Alias, Contract>;

// Gets list of contracts from given aliases
export async function getContractsFromAliases(
  cache: Cache,
  aliases: Aliases,
  proxies: Proxies,
  hre: HardhatRuntimeEnvironment,
  signer?: Signer
): Promise<ContractMap> {
  const contracts: ContractMap = new Map();
  const theSigner = signer ?? (await hre.ethers.getSigners())[0];
  for (const [alias, address] of aliases.entries()) {
    const contract = await getContractByAddressProxy(
      cache,
      proxies,
      address,
      hre,
      theSigner,
      [],
      alias,
      address
    );

    if (contract) {
      contracts.set(alias, contract);
    }
  }

  return contracts;
}

// Returns an ethers' wrapped contract from a given build file (based on its name and address)
async function getContractByAddressProxy(
  cache: Cache,
  proxies: Proxies,
  address: Address,
  hre: HardhatRuntimeEnvironment,
  signer: Signer,
  accABI: ABI,
  accAlias: string,
  accAddress: Address
): Promise<Contract | null> {
  const contract = await getContractByAddress(cache, accAlias, accAddress, hre, signer);
  if (!contract) {
    return null; // NB: assume its not a contract
  }
  const { abi } = contract;
  const nextABI = mergeABI(abi, accABI); // duplicate entries (like constructor) defer to accABI
  if (proxies.has(accAlias)) {
    return await getContractByAddressProxy(
      cache,
      proxies,
      address,
      hre,
      signer,
      nextABI,
      `${accAlias}:implementation`,
      proxies.get(accAlias)
    );
  } else {
    return new hre.ethers.Contract(address, nextABI, signer);
  }
}

// Returns an ethers' wrapped contract from a given build file (based on its name and address)
async function getContractByAddress(
  cache: Cache,
  alias: Alias,
  address: Address,
  hre: HardhatRuntimeEnvironment,
  signer: Signer,
  implBuildFile?: BuildFile
): Promise<{ name: string, contract: Contract, abi: ABI } | null> {
  const buildFile = await getBuildFile(cache, address);
  if (!buildFile) {
    debug(`No build file for ${alias} (${address}), assuming its not a contract`);
    return null;
  }
  const [contractName, metadata] = getPrimaryContract(buildFile);
  let abi;
  if (implBuildFile) {
    const [_implContractName, implMetadata] = getPrimaryContract(implBuildFile);
    abi = implMetadata.abi;
  } else {
    abi = metadata.abi;
  }
  return { name: contractName, contract: new hre.ethers.Contract(address, abi, signer), abi: abi };
}

function getFileSpec(address: Address): FileSpec {
  return { top: ['.contracts', address + '.json'] };
}

export async function getBuildFile(cache: Cache, address: Address): Promise<BuildFile> {
  return cache.readCache<BuildFile>(getFileSpec(address));
}

export async function storeBuildFile(cache: Cache, address: Address, buildFile: BuildFile) {
  await cache.storeCache(getFileSpec(address), buildFile);
}

/**
 * Gets Etherscan contracts from known cache.
 */
export async function getContracts(
  cache: Cache,
  hre: HardhatRuntimeEnvironment,
  signer?: Signer
): Promise<ContractMap> {
  const aliases = await getAliases(cache);
  const proxies = await getProxies(cache);
  return await getContractsFromAliases(cache, aliases, proxies, hre, signer);
}
