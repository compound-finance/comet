import { Alias, Address } from './Types';
import { Cache } from './Cache';

export type Proxies = Map<Alias, Address>;

// File to store proxies information in, e.g. `$pwd/deployments/$network/proxies.json`
let proxiesSpec = { rel: 'proxies.json' };

// Reads root information for given deployment
export async function getProxies(cache: Cache): Promise<Proxies> {
  return await cache.readMap<Alias, Address>(proxiesSpec);
}

// Stores new proxies for a given deployment in cache
export async function storeProxies(cache: Cache, proxies: Proxies) {
  await cache.storeMap<Alias, Address>(proxiesSpec, proxies);
}

export async function putProxy(cache: Cache, alias: Alias, address: Address) {
  let proxies = await getProxies(cache);
  proxies.set(alias, address);
  await storeProxies(cache, proxies);
}
