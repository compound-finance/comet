import { task } from 'hardhat/config';
import { Migration, loadMigrations } from '../../plugins/deployment_manager/Migration';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
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
  .addFlag('simulate', 'only simulates the blockchain effects')
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
        writeCacheToDisk: !simulate, // Don't write to disk when simulating
        debug: true,
        verifyContracts: true,
      });
      await dm.spider();
      let migrationPath = `deployments/${network}/migrations/${migrationName}.ts`;
      let migrations = await loadMigrations([migrationPath]);
      let migration = migrations[migrationName];
      if (!migration) {
        throw new Error(
          `Unknown migration for network ${network}: \`${migrationName}\`. Known migrations: ${JSON.stringify(
            Object.keys(migrations)
          )}`
        );
      }
      console.log('Running migration...');
      await migration.actions.run(dm);
    }
  );
