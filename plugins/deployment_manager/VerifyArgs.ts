import { Address, Alias } from './Types';
import { Cache } from './Cache';
import { VerifyArgs } from './Verify';

export type VerifyArgsMap = Map<Address, VerifyArgs>;
export type InvertedAliases = Map<Address, Alias[]>;

// File to store verification metadata in, e.g. `$pwd/deployments/deployment/verify/args.json`
let verificationSpec = { rel: ['verify', 'args.json'] };

// Read verify args
export async function getVerifyArgs(cache: Cache): Promise<VerifyArgsMap> {
  return await cache.readMap<VerifyArgs>(verificationSpec);
}

// Stores verify args
export async function storeVerifyArgs(cache: Cache, verifyArgsMap: VerifyArgsMap) {
  await cache.storeMap<Address, VerifyArgs>(verificationSpec, verifyArgsMap);
}

export async function putVerifyArgs(cache: Cache, address: Address, verifyArgs: VerifyArgs) {
  let verifyArgsMap = await getVerifyArgs(cache);
  verifyArgsMap.set(address, verifyArgs);
  await storeVerifyArgs(cache, verifyArgsMap);
}
