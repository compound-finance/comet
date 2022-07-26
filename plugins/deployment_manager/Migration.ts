import * as path from 'path';
import { DeploymentManager } from './DeploymentManager';
import { FileSpec } from './Cache';

interface Action {
  run: (dm: DeploymentManager) => Promise<void>;
}

export interface Migration {
  name: string;
  actions: Action;
}

export class Loader {
  migrations: { [name: string]: Migration };

  constructor() {
    this.migrations = {};
  }

  addMigration(name: string, actions: Action) {
    if (this.migrations[name]) {
      throw new Error(`Duplicate migration by name: ${name}`);
    }
    this.migrations[name] = {
      name,
      actions
    };
  }

  getMigrations(): { [name: string]: Migration } {
    return this.migrations;
  }
}

export let loader: any;

export function setupLoader() {
  loader = new Loader();
}

export function getLoader(): Loader {
  if (!loader) {
    throw new Error('Loader not initialized');
  }

  return <Loader>loader;
}

export async function loadMigrations(paths: string[]): Promise<{ [name: string]: Migration }> {
  setupLoader();

  for (let p of paths) {
    /* Import scenario file */
    await import(path.join(process.cwd(), p));
    /* Import complete */
  }

  return loader.getMigrations();
}

export function migration(name: string, actions: Action) {
  getLoader().addMigration(name, actions);
}
