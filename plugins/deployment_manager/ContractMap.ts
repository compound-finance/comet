import { Contract } from 'ethers';
import { Cache, FileSpec } from './Cache';
import { Address, Alias, BuildFile } from './Types';

export type ContractMap = Map<Alias, Contract>;

function getFileSpec(address: Address): FileSpec {
  return { top: ['.contracts', address + '.json'] };
}

export async function getBuildFile(cache: Cache, address: Address): Promise<BuildFile> {
  return cache.readCache<BuildFile>(getFileSpec(address));
}

export async function storeBuildFile(cache: Cache, address: Address, buildFile: BuildFile) {
  await cache.storeCache(getFileSpec(address), buildFile);
}
