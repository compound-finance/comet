import * as fs from 'fs/promises';
import * as nodepath from 'path';
import { inspect } from 'util';

import { Address, BuildFile } from './Types';
import { fileExists, objectFromMap, objectToMap } from './Utils';

export type FileSpec = string | string[] | { rel: string | string[] };

function curry<A, B, C>(f: (A) => B, g: (B) => C): (A) => C {
  return (x) => g(f(x));
}

function parseJson<K>(x: string | undefined): K {
  if (x === undefined) {
    return undefined;
  } else {
    return JSON.parse(x);
  }
}

function stringifyJson<K>(k: K): string {
  return JSON.stringify(k, null, 4);
}

export class Cache {
  cache: object;
  deployment: string;
  deploymentDir: string;
  writeCacheToDisk: boolean;

  constructor(deployment: string, writeCacheToDisk?: boolean, deploymentDir?: string) {
    this.cache = {}; // todo cache config?
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
      if (c.hasOwnProperty(path)) {
        c = c[path];
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
      if (c.hasOwnProperty(path)) {
        c = c[path];
      } else {
        // If we're an intermediate key, we want to build an object to iterate on
        // But if we're the last key, we want to store the object here.
        if (i === paths.length - 1) {
          c[path] = data;
        } else {
          c[path] = {};
          c = c[path];
        }
      }
    }
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

  async readMap<K, V>(spec: FileSpec): Promise<Map<string, V>> {
    return await this.readCache(spec, curry<K, string, Map<string, V>>(parseJson, objectToMap));
  }

  async storeMap<K, V>(spec: FileSpec, map: Map<K, V>) {
    await this.storeCache(spec, map, curry(objectFromMap, stringifyJson));
  }

  clearMemory() {
    this.cache = {};
  }

  show() {
    console.log('Cache', inspect(this.cache, { depth: Infinity }));
  }
}
