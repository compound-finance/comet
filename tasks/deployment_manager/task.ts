import { task } from 'hardhat/config';
import { Migration, loadMigrations } from '../../plugins/deployment_manager/Migration';
import '../../plugins/deployment_manager/type-extensions';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import * as types from 'hardhat/internal/core/params/argumentTypes'; // TODO harhdat argument types not from internal
import * as path from 'path';
import * as fs from 'fs/promises';
import hreForBase from '../../plugins/scenario/utils/hreForBase';

// TODO: Don't depend on scenario's hreForBase
function getBase(env: HardhatRuntimeEnvironment): HardhatRuntimeEnvironment {
  let baseMap = Object.fromEntries(env.config.scenario.bases.map((base) => [base.name, base]));
  let base = baseMap[env.network.name];
  if (!base) {
    throw new Error(`No fork spec for ${env.network.name}`);
  }
  return hreForBase(base);
}

async function runMigration<T>(
  deploymentManager: DeploymentManager,
  prepare: boolean,
  enact: boolean,
  migration: Migration<T>,
  overwrite: boolean
) {
  let artifact: T = await deploymentManager.readArtifact(migration);
  if (prepare) {
    if (artifact && !overwrite) {
      throw new Error(
        'Artifact already exists for migration, please specify --overwrite to overwrite artifact.'
      );
    }

    console.log('Running preparation step...');
    artifact = await migration.actions.prepare(deploymentManager);
    console.log('Preparation artifact', artifact);
    let outputFile = await deploymentManager.storeArtifact(migration, artifact);
    if (deploymentManager.cache.writeCacheToDisk) {
      console.log(`Migration preparation artifact stored in ${outputFile}.`);
    } else {
      console.log(`Migration preparation artifact would have been stored in ${outputFile}, but not writing to disk in a simulation.`);
    }
  }

  if (enact) {
    if (artifact === undefined) {
      throw new Error(
        'No artifact found for migration. Please run --prepare first, or specify both --prepare and --enact'
      );
    }
    console.log('Running enactment step with artifact...', artifact);
    await migration.actions.enact(deploymentManager, artifact);
    console.log('Enactment complete');
  }
}

task('gen:migration', 'Generates a new migration')
  .addPositionalParam('name', 'name of the migration')
  .setAction(async ({ name }, env: HardhatRuntimeEnvironment) => {
    let network = env.network.name;
    let dm = new DeploymentManager(network, env, {
      writeCacheToDisk: true,
      debug: true,
      verifyContracts: true,
    });
    let file = await dm.generateMigration(name);
    console.log(`Generated migration ${file}`);
  });

task('migrate', 'Runs migration')
  .addPositionalParam('migration', 'name of migration')
  .addFlag('prepare', 'runs preparation [defaults to true if enact not specified]')
  .addFlag('enact', 'enacts migration [implies prepare]')
  .addFlag('simulate', 'only simulates the blockchain effects')
  .addFlag('overwrite', 'overwrites artifact if exists, fails otherwise')
  .setAction(
    async (
      { migration: migrationName, prepare, enact, simulate, overwrite },
      env: HardhatRuntimeEnvironment
    ) => {
      let theEnv: HardhatRuntimeEnvironment = env;
      if (simulate) {
        theEnv = getBase(env);
      }
      let network = env.network.name;
      let dm = new DeploymentManager(network, theEnv, {
        writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
        debug: true,
        verifyContracts: true,
      });
      await dm.spider();
      let migrationsGlob = path.join('deployments', network, 'migrations', '**.ts');
      let migrations = await loadMigrations(migrationsGlob);

      let migration = migrations[migrationName];
      if (!migration) {
        throw new Error(
          `Unknown migration for network ${network}: \`${migrationName}\`. Known migrations: ${JSON.stringify(
            Object.keys(migrations)
          )}`
        );
      }
      if (!prepare && !enact) {
        prepare = true;
      }

      await runMigration(dm, prepare, enact, migration, overwrite);
    }
  );
