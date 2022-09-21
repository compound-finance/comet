import { DeploymentManager } from './DeploymentManager';
import { FileSpec } from './Cache';

export interface Actions<T> {
  prepare: (dm: DeploymentManager) => Promise<T>;
  enact: (dm: DeploymentManager, t: T) => Promise<void>;
  enacted?: (dm: DeploymentManager) => Promise<boolean>;
  verify?: (dm: DeploymentManager) => Promise<void>;
}

export class Migration<T> {
  name: string;
  actions: Actions<T>;

  constructor(name: string, actions: Actions<T>) {
    this.name = name;
    this.actions = actions;
  }
}

export async function loadMigration(path: string): Promise<Migration<any>> {
  const { default: thing } = await import(path);
  if (!(thing instanceof Migration))
    throw new Error(`Does not export a valid default Migration`);
  return thing;
}

export async function loadMigrations(paths: string[]): Promise<Migration<any>[]> {
  const migrations = [];
  for (const path of paths) {
    migrations.push(await loadMigration(path));
  }
  return migrations;
}

export function migration<T>(name: string, actions: Actions<T>) {
  return new Migration(name, actions);
}

export function getArtifactSpec<T>(migration: Migration<T>): FileSpec {
  return { rel: ['artifacts', `${migration.name}.json`] };
}
