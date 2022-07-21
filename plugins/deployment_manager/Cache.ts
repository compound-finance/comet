import * as fs from 'fs/promises';
import * as nodepath from 'path';
import { inspect } from 'util';
import { fileExists, objectFromMap, objectToMap } from './Utils';

export type FileSpec = string | string[] | { rel: string | string[] };

function compose<A, B, C>(f: (a: A) => B, g: (b: B) => C): (a: A) => C {
  return (x) => g(f(x));
}

function deepClone(c: CacheMap): CacheMap {
  let res = new Map();
  for (let [name, entry] of c.entries()) {
    if (entry instanceof Map) {
      res.set(name, deepClone(entry));
    } else {
      res.set(name, entry);
    }
  }
  return res;
}

function parseJson<K>(x: string | undefined): K {
  if (x === undefined) {
    return undefined;
  } else {
    return JSON.parse(x);
  }
}

function stringifyJson<K>(k: K): string {
  return JSON.stringify(
    k,
    (_key, value) =>
      typeof value === 'bigint'
        ? value.toString()
        : value,
    4
  );
}

type CacheMap = Map<string, any | CacheMap>;

export class Cache {
  cache: CacheMap;
  deployment: string;
  deploymentDir: string;
  writeCacheToDisk: boolean;

  constructor(deployment: string, writeCacheToDisk?: boolean, deploymentDir?: string) {
    this.cache = new Map(); // todo cache config?
    this.deployment = deployment;
    this.deploymentDir = deploymentDir ?? nodepath.join(process.cwd(), 'deployments');
    this.writeCacheToDisk = writeCacheToDisk ?? false;
  }

  private getPath(spec: FileSpec): string[] {
    if (typeof spec === 'string') {
      return [spec.toLowerCase()];
    } else if (Array.isArray(spec)) {
      return spec.map((s) => s.toLowerCase());
    } else if (spec.hasOwnProperty('rel')) {
      return [this.deployment, ...this.getPath(spec.rel)];
    }
  }

  getFilePath(spec: FileSpec): string {
    let path = this.getPath(spec);
    path[path.length - 1] = path[path.length - 1];
    return nodepath.join(this.deploymentDir, ...path);
  }

  private getMemory<T>(spec: FileSpec): T | undefined {
    let c = this.cache;
    for (let path of this.getPath(spec)) {
      if (c instanceof Map && c.has(path)) {
        c = c.get(path);
      } else {
        return undefined;
      }
    }
    return c as unknown as T; // Since we don't really know what "values" are.
  }

  private putMemory<T>(spec: FileSpec, data: T) {
    let c = this.cache;
    let paths = this.getPath(spec);
    for (let [i, path] of paths.entries()) {
      if (i === paths.length - 1) {
        c.set(path, data);
        return;
      } else {
        if (c instanceof Map && c.has(path)) {
          c = c.get(path);
        } else {
          // If we're an intermediate key, we want to build an object to iterate on
          // But if we're the last key, we want to store the object here.
          c.set(path, new Map());
          c = c.get(path);
        }
      }
    }
    throw new Error('unreachable');
  }

  private async putDisk<T>(spec: FileSpec, data: T, transformer: (T) => string) {
    let path = this.getFilePath(spec);
    let dir = nodepath.dirname(path);
    // TODO: Fix this logic
    if (!(await fileExists(dir))) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(path, transformer(data));
  }

  private async getDisk<T>(spec: FileSpec, transformer: (x: string | undefined) => T): Promise<T> {
    let filePath = this.getFilePath(spec);
    if (await fileExists(filePath)) {
      return transformer(await fs.readFile(filePath, 'utf8'));
    } else {
      return transformer(undefined);
    }
  }

  async readCache<T>(
    spec: FileSpec,
    diskTransformer: (x: string | undefined) => T = parseJson
  ): Promise<T | undefined> {
    let cached = this.getMemory<T>(spec);
    if (cached) {
      return cached;
    } else {
      return await this.getDisk<T>(spec, diskTransformer);
    }
  }

  async storeCache<T>(spec: FileSpec, data: T, diskTransformer: (T) => string = stringifyJson) {
    this.putMemory<T>(spec, data);
    if (this.writeCacheToDisk) {
      return await this.putDisk<T>(spec, data, diskTransformer);
    }
  }

  async readMap<V>(spec: FileSpec): Promise<Map<string, V>> {
    return await this.readCache(spec, compose<string, object, Map<string, V>>(parseJson, objectToMap));
  }

  async storeMap<K, V>(spec: FileSpec, map: Map<K, V>) {
    await this.storeCache(spec, map, compose(objectFromMap, stringifyJson));
  }

  clearMemory() {
    this.cache = new Map();
  }

  storeMemory(): object {
    return deepClone(this.cache);
  }

  loadMemory(cache: CacheMap) {
    this.cache = deepClone(cache);
  }

  cloneMemory() {
    this.cache = deepClone(this.cache);
  }

  show() {
    console.log('Cache', inspect(this.cache, { depth: Infinity }));
  }
}
