import { task } from 'hardhat/config';
import { Migration, loadMigrations } from '../../plugins/deployment_manager/Migration';
import '../../plugins/deployment_manager/type-extensions';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import * as types from 'hardhat/internal/core/params/argumentTypes'; // TODO harhdat argument types not from internal
import * as path from 'path';

async function runMigration<T>(deploymentManager: DeploymentManager, enact: boolean, migration: Migration<T>) {
  let t: T = await migration.actions.prepare(deploymentManager);

  if (enact) {
    await migration.actions.enact(deploymentManager, t);
  }
}

task('migrate', 'Runs migration')
  .addParam('migration', 'name of migration')
  .addFlag('prepare', 'runs preparation')
  .addFlag('enact', 'enacts migration [implies prepare]')
  .setAction(async ({migration: migrationName, prepare, enact}, env: HardhatRuntimeEnvironment) => {
    let network = env.network.name;
    let dm = new DeploymentManager(network, env, {
      writeCacheToDisk: true,
      debug: true,
      verifyContracts: true,
    });
    let migrationsGlob = path.join('deployments', network, 'migrations', '**.ts');
    let migrations = await loadMigrations(migrationsGlob);

    let migration = migrations[migrationName];
    if (!migration) {
      throw new Error(`Unknown migration for network ${network}: \`${migrationName}\`. Known migrations: ${JSON.stringify(Object.keys(migrations))}`);
    }
    if (!prepare && !enact) {
      console.error("Migration found. Please run with --prepare or --enact. Exiting...");
    } else {
      await runMigration(dm, enact, migration);
    }
  });
