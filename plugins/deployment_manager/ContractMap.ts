import { Contract } from 'ethers';
import { Cache, FileSpec } from './Cache';
import { Address, Alias, BuildFile } from './Types';

export type ContractMap = Map<Alias, Contract>;

function getFileSpec(network: string, address: Address): FileSpec {
  return { top: [network, '.contracts', address + '.json'] };
}

export async function getBuildFile(cache: Cache, network: string, address: Address): Promise<BuildFile> {
  return cache.readCache<BuildFile>(getFileSpec(network, address));
}

export async function storeBuildFile(cache: Cache, network: string, address: Address, buildFile: BuildFile) {
  await cache.storeCache(getFileSpec(network, address), buildFile);
}
