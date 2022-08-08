import { Contract, Signer } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { Cache, FileSpec } from './Cache';
import { ABI, Address, Alias, BuildFile } from './Types';
import { Aliases, getAliases } from './Aliases';
import { Proxies, getProxies } from './Proxies';
import { getPrimaryContract, mergeABI } from './Utils';

export type ContractMap = Map<Alias, Contract>;

// Gets list of contracts from given aliases
export async function getContractsFromAliases(
  cache: Cache,
  aliases: Aliases,
  proxies: Proxies,
  hre: HardhatRuntimeEnvironment,
  signer?: Signer
): Promise<ContractMap> {
  let contracts: ContractMap = new Map();
  let theSigner = signer ?? (await hre.ethers.getSigners())[0];
  for (let [alias, address] of aliases.entries()) {
    let contract = await getContractByAddressProxy(
      cache,
      proxies,
      address,
      hre,
      theSigner,
      [],
      alias,
      address
    );

    contracts.set(alias, contract);
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
): Promise<Contract> {
  let { abi } = await getContractByAddress(cache, accAlias, accAddress, hre, signer);
  let nextABI = mergeABI(abi, accABI); // duplicate entries (like constructor) defer to accABI
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
): Promise<{ name: string, contract: Contract, abi: ABI }> {
  let buildFile = await getRequiredBuildFile(cache, address, alias);
  let [contractName, metadata] = getPrimaryContract(buildFile);
  let abi;
  if (implBuildFile) {
    let [_implContractName, implMetadata] = getPrimaryContract(implBuildFile);
    abi = implMetadata.abi;
  } else {
    abi = metadata.abi;
  }

  return { name: contractName, contract: new hre.ethers.Contract(address, abi, signer), abi: abi };
}

function getFileSpec(address: Address): FileSpec {
  return { rel: ['contracts', address + '.json'] };
}

export async function getBuildFile(cache: Cache, address: Address): Promise<BuildFile> {
  return cache.readCache<BuildFile>(getFileSpec(address));
}

export async function storeBuildFile(cache: Cache, address: Address, buildFile: BuildFile) {
  await cache.storeCache(getFileSpec(address), buildFile);
}

async function getRequiredBuildFile(
  cache: Cache,
  address: Address,
  alias?: Alias
): Promise<BuildFile> {
  let buildFile = await getBuildFile(cache, address);
  if (!buildFile) {
    throw new Error(`Failed to find contract${alias ? ' by alias ' + alias : ''} at ${address}`);
  }
  return buildFile;
}

/**
 * Gets Etherscan contracts from known cache.
 */
export async function getContracts(
  cache: Cache,
  hre: HardhatRuntimeEnvironment,
  signer?: Signer
): Promise<ContractMap> {
  let aliases = await getAliases(cache);
  let proxies = await getProxies(cache);
  return await getContractsFromAliases(cache, aliases, proxies, hre, signer);
}
