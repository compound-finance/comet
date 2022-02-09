import fg from 'fast-glob';
import * as path from 'path';

import { FileSpec } from './Cache';

interface Action<T> {
  prepare?: (DeploymentManager) => Promise<T>;
  enact?: (DeploymentManager, T) => Promise<void>;
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
      actions,
    };
  }

  getMigrations(): { [name: string]: Migration<T> } {
    return this.migrations;
  }
}

export let loader: any;

export function setupLoader<T>() {
  if (loader) {
    throw new Error('Loader already initialized');
  }

  loader = new Loader<T>();
}

export function getLoader<T>(): Loader<T> {
  if (!loader) {
    throw new Error('Loader not initialized');
  }

  return <Loader<T>>loader;
}

export async function loadMigrations<T>(glob: string): Promise<{ [name: string]: Migration<T> }> {
  setupLoader<T>();

  const entries = await fg(glob); // Grab all potential migration files

  for (let entry of entries) {
    let entryPath = path.join(process.cwd(), entry);

    /* Import scenario file */
    await import(entryPath);
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
