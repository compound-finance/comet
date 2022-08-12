import { Address, Alias } from './Types';
import { Cache } from './Cache';

export type Aliases = Map<Alias, Address>;
export type InvertedAliases = Map<Address, Alias[]>;

// File to store aliases in, e.g. `$pwd/deployments/deployment/aliases.json`
const aliasesSpec = { rel: 'aliases.json' };

// Read aliases
export async function getAliases(cache: Cache): Promise<Aliases> {
  return await cache.readMap<Address>(aliasesSpec);
}

// Stores aliases
export async function storeAliases(cache: Cache, aliases: Aliases) {
  await cache.storeMap<Alias, Address>(aliasesSpec, aliases);
}

export async function putAlias(cache: Cache, alias: Alias, address: Address) {
  const aliases = await getAliases(cache);
  aliases.set(alias, address);
  await storeAliases(cache, aliases);
}

// Returns an inverted alias map where you can look up a list of aliases from an address
export async function getInvertedAliases(cache: Cache): Promise<InvertedAliases> {
  const aliases = await getAliases(cache);
  const inverted = new Map();
  for (const [alias, address] of aliases.entries()) {
    const addressLower = address.toLowerCase();
    const previous = inverted.get(addressLower) ?? [];
    inverted.set(addressLower, [...previous, alias]);
  }
  return inverted;
}
