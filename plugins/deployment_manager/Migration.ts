import { join } from 'path';
import { DeploymentManager } from './DeploymentManager';
import { FileSpec } from './Cache';

interface Action<T> {
  prepare: (dm: DeploymentManager) => Promise<T>;
  enact: (dm: DeploymentManager, t: T) => Promise<void>;
}

export interface Migration<T> {
  name: string;
  actions: Action<T>;
}

export class Loader<T> {
  migrations: { [name: string]: Migration<T> };

  constructor() {
    this.migrations = {};
  }

  addMigration(name: string, actions: Action<T>) {
    if (this.migrations[name]) {
      throw new Error(`Duplicate migration by name: ${name}`);
    }
    this.migrations[name] = {
      name,
      actions
    };
  }

  getMigrations(): { [name: string]: Migration<T> } {
    return this.migrations;
  }
}

export let loader: any;

export function setupLoader<T>() {
  loader = new Loader<T>();
}

export function getLoader<T>(): Loader<T> {
  if (!loader) {
    throw new Error('Loader not initialized');
  }

  return <Loader<T>>loader;
}

export async function loadMigrations<T>(paths: string[]): Promise<{ [name: string]: Migration<T> }> {
  setupLoader<T>();

  for (let path of paths) {
    /* Import scenario file */
    await import(join(process.cwd(), path));
    /* Import complete */
  }

  return loader.getMigrations();
}

export function migration<T>(name: string, actions: Action<T>) {
  getLoader().addMigration(name, actions);
}

export function getArtifactSpec<T>(migration: Migration<T>): FileSpec {
  return { rel: [ 'artifacts', `${migration.name}.json` ] };
}
