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
    console.log('Running enactment step with artifact...', artifact);
    await migration.actions.enact(deploymentManager, artifact);
    console.log('Enactment complete');
  }
}

task('deploy', 'Deploys market')
  .addFlag('simulate', 'only simulates the blockchain effects')
  .setAction(
    async ({ simulate }, env: HardhatRuntimeEnvironment) => {
      let maybeForkEnv: HardhatRuntimeEnvironment = env;
      if (simulate) {
        maybeForkEnv = getBase(env);
      }
      const network = env.network.name;
      const dm = new DeploymentManager(network, maybeForkEnv, {
        writeCacheToDisk: !simulate, // Don't write to disk when simulating
        debug: true,
        verifyContracts: true,
      });
      await dm.spider();

      // XXX wrap?
      const deployment = dm.deployment; // XXX should become per instance
      const { default: deploy } = await import(`../../deployments/${deployment}/deploy.ts`);
      if (!deploy) {
        throw new Error(`Missing deploy function for ${deployment}.`);
      }
      await deploy(dm);
    }
  );

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

      let migrationPath = `${__dirname}/../../deployments/${network}/migrations/${migrationName}.ts`;
      let [migration] = await loadMigrations([migrationPath]);
      if (!migration) {
        throw new Error(`Unknown migration for network ${network}: \`${migrationName}\`.`);
      }
      if (!prepare && !enact) {
        prepare = true;
      }

      await runMigration(dm, prepare, enact, migration, overwrite);
    }
  );
