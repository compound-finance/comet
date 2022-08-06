import { task } from 'hardhat/config';
import { diff } from 'jest-diff';
import { Migration, loadMigrations } from '../../plugins/deployment_manager/Migration';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import hreForBase from '../../plugins/scenario/utils/hreForBase';

// TODO: Don't depend on scenario's hreForBase
function getForkEnv(env: HardhatRuntimeEnvironment): HardhatRuntimeEnvironment {
  const base = env.config.scenario.bases.find(b => b.name == env.network.name);
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
  .addParam('deployment', 'The deployment to deploy')
  .setAction(
    async ({ simulate, deployment }, env: HardhatRuntimeEnvironment) => {
      let maybeForkEnv: HardhatRuntimeEnvironment = env;
      if (simulate) {
        maybeForkEnv = getForkEnv(env);
      }
      const network = env.network.name;
      const tag = `${network}/${deployment}`;
      const dm = new DeploymentManager(
        network,
        deployment,
        maybeForkEnv,
        {
          writeCacheToDisk: !simulate, // Don't write to disk when simulating
          verificationStrategy: 'lazy',
        }
      );
      const delta = await dm.deployMissing(true); // XXX truly idempotent will change the arg here
      console.log(`[${tag}] Deployed ${dm.counter} contracts to initialize world 🗺`);
      console.log(`[${tag}]\n${diff(delta.new, delta.old, {aAnnotation: 'New addresses', bAnnotation: 'Old addresses'})}`);
    }
  );

task('gen:migration', 'Generates a new migration')
  .addPositionalParam('name', 'name of the migration')
  .addParam('deployment', 'The deployment to generate the migration for')
  .setAction(async ({ name, deployment }, env: HardhatRuntimeEnvironment) => {
    let network = env.network.name;
    let dm = new DeploymentManager(
      network,
      deployment,
      env,
      {
        writeCacheToDisk: true,
        verificationStrategy: 'lazy',
      }
    );
    let file = await dm.generateMigration(name);
    console.log(`Generated migration ${network}/${deployment}/${file}`);
  });

task('migrate', 'Runs migration')
  .addPositionalParam('migration', 'name of migration')
  .addParam('deployment', 'The deployment to apply the migration to')
  .addFlag('prepare', 'runs preparation [defaults to true if enact not specified]')
  .addFlag('enact', 'enacts migration [implies prepare]')
  .addFlag('simulate', 'only simulates the blockchain effects')
  .addFlag('overwrite', 'overwrites artifact if exists, fails otherwise')
  .setAction(
    async (
      { migration: migrationName, prepare, enact, simulate, overwrite, deployment },
      env: HardhatRuntimeEnvironment
    ) => {
      let maybeForkEnv: HardhatRuntimeEnvironment = env;
      if (simulate) {
        maybeForkEnv = getForkEnv(env);
      }
      let network = env.network.name;
      let dm = new DeploymentManager(
        network,
        deployment,
        maybeForkEnv,
        {
          writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
          verificationStrategy: 'lazy',
        }
      );
      await dm.spider();

      let migrationPath = `${__dirname}/../../deployments/${network}/${deployment}/migrations/${migrationName}.ts`;
      let [migration] = await loadMigrations([migrationPath]);
      if (!migration) {
        throw new Error(`Unknown migration for network ${network}/${deployment}: \`${migrationName}\`.`);
      }
      if (!prepare && !enact) {
        prepare = true;
      }

      await runMigration(dm, prepare, enact, migration, overwrite);
    }
  );
