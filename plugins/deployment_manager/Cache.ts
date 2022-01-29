import * as fs from 'fs/promises';
import * as nodepath from 'path';
import { inspect } from 'util';

import { Address, BuildFile } from './Types';
import { fileExists, objectFromMap, objectToMap } from './Utils';

export type FileSpec = string | string[] | { rel: string | string[] };

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

  private getFilePath(spec: FileSpec): string {
    let path = this.getPath(spec);
    path[path.length - 1] = path[path.length - 1] + '.json'; // Attach JSON file extension, always.
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

  private async putDisk<T>(spec: FileSpec, data: T, transformer: (T) => object) {
    let path = this.getFilePath(spec);
    let dir = nodepath.dirname(path);
    // TODO: Fix this logic
    if (!(await fileExists(dir))) {
      await fs.mkdir(dir, { recursive: true });
    }

    await fs.writeFile(path, JSON.stringify(transformer(data), null, 4));
  }

  private async getDisk<T>(spec: FileSpec, transformer: (x: object | undefined) => T): Promise<T> {
    let filePath = this.getFilePath(spec);
    if (await fileExists(filePath)) {
      return transformer(JSON.parse(await fs.readFile(filePath, 'utf8')));
    } else {
      return transformer(undefined);
    }
  }

  async readCache<T>(
    spec: FileSpec,
    diskTransformer: (x: object | undefined) => T = (x) => x as unknown as T
  ): Promise<T | undefined> {
    let cached = this.getMemory<T>(spec);
    if (cached) {
      return cached;
    } else {
      return await this.getDisk<T>(spec, diskTransformer);
    }
  }

  async storeCache<T>(spec: FileSpec, data: T, diskTransformer: (T) => object = (x) => x) {
    this.putMemory<T>(spec, data);
    if (this.writeCacheToDisk) {
      return await this.putDisk<T>(spec, data, diskTransformer);
    }
  }

  async readMap<K, V>(spec: FileSpec): Promise<Map<string, V>> {
    return await this.readCache(spec, (x) => objectToMap<V>(x as { [k: string]: V }));
  }

  async storeMap<K, V>(spec: FileSpec, map: Map<K, V>) {
    await this.storeCache(spec, map, objectFromMap);
  }

  clearMemory() {
    this.cache = {};
  }

  show() {
    console.log('Cache', inspect(this.cache, { depth: Infinity }));
  }
}
