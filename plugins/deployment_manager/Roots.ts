import { Alias, Address } from './Types';
import { Cache } from './Cache';

export type Roots = Map<Alias, Address>;

// File to store root information in, e.g. `$pwd/deployments/$network/roots.json`
let rootsSpec = { rel: 'roots.json' };

// Reads root information for given deployment
export async function getRoots(cache: Cache): Promise<Roots> {
  return await cache.readMap<Alias, Address>(rootsSpec);
}

// Stores new roots for a given deployment in cache
export async function putRoots(cache: Cache, roots: Roots) {
  await cache.storeMap<Alias, Address>(rootsSpec, roots);
}
