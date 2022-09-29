import { task } from 'hardhat/config';
import { Migration, loadMigrations } from '../../plugins/deployment_manager/Migration';
import { writeEnacted } from '../../plugins/deployment_manager/Enacted';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager, VerifyArgs } from '../../plugins/deployment_manager';
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
  governanceDeploymentManager: DeploymentManager,
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
    await migration.actions.enact(governanceDeploymentManager, artifact);
    console.log('Enactment complete');
  }
}

task('deploy', 'Deploys market')
  .addFlag('simulate', 'only simulates the blockchain effects')
  .addFlag('noDeploy', 'skip the actual deploy step')
  .addFlag('noVerify', 'do not verify any contracts')
  .addFlag('noVerifyImpl', 'do not verify the impl contract')
  .addFlag('overwrite', 'overwrites cache')
  .addParam('deployment', 'The deployment to deploy')
  .setAction(async ({ simulate, noDeploy, noVerify, noVerifyImpl, overwrite, deployment }, env) => {
    const maybeForkEnv = simulate ? getForkEnv(env) : env;
    const network = env.network.name;
    const tag = `${network}/${deployment}`;
    const dm = new DeploymentManager(
      network,
      deployment,
      maybeForkEnv,
      {
        writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
        verificationStrategy: 'lazy',
      }
    );

    if (noDeploy) {
      // Don't run the deploy script
    } else {
      const overrides = undefined; // TODO: pass through cli args
      const delta = await dm.runDeployScript(overrides ?? { allMissing: true });
      console.log(`[${tag}] Deployed ${dm.counter} contracts, spent ${dm.spent} Ξ`);
      console.log(`[${tag}]\n${dm.diffDelta(delta)}`);
    }

    const verify = noVerify ? false : !simulate;
    const desc = verify ? 'Verify' : 'Would verify';
    if (noVerify && simulate) {
      // Don't even print if --no-verify is set with --simulate
    } else {
      await dm.verifyContracts(async (address, args) => {
        if (args.via === 'buildfile') {
          const { contract: _, ...rest } = args;
          console.log(`[${tag}] ${desc} ${address}:`, rest);
        } else {
          console.log(`[${tag}] ${desc} ${address}:`, args);
        }
        return verify;
      });

      if (noVerifyImpl) {
        // Don't even try if --no-verify-impl
      } else {
        // Maybe verify the comet impl too
        const comet = await dm.contract('comet');
        const cometImpl = await dm.contract('comet:implementation');
        const configurator = await dm.contract('configurator');
        const config = await configurator.getConfiguration(comet.address);
        const args: VerifyArgs = {
          via: 'artifacts',
          address: cometImpl.address,
          constructorArguments: [config]
        };
        console.log(`[${tag}] ${desc} ${cometImpl.address}:`, args);
        if (verify) {
          await dm.verifyContract(args);
        }
      }
    }
  });

task('gen:migration', 'Generates a new migration')
  .addPositionalParam('name', 'name of the migration')
  .addParam('deployment', 'The deployment to generate the migration for')
  .setAction(async ({ name, deployment }, env) => {
    const network = env.network.name;
    const dm = new DeploymentManager(
      network,
      deployment,
      env,
      {
        writeCacheToDisk: true,
        verificationStrategy: 'lazy',
      }
    );
    const file = await dm.generateMigration(name);
    console.log(`Generated migration ${network}/${deployment}/${file}`);
  });

task('migrate', 'Runs migration')
  .addPositionalParam('migration', 'name of migration')
  .addParam('deployment', 'The deployment to apply the migration to')
  .addFlag('prepare', 'runs preparation [defaults to true if enact not specified]')
  .addFlag('enact', 'enacts migration [implies prepare]')
  .addFlag('noEnacted', 'do not write enacted to the migration script')
  .addFlag('simulate', 'only simulates the blockchain effects')
  .addFlag('overwrite', 'overwrites artifact if exists, fails otherwise')
  .setAction(
    async ({ migration: migrationName, prepare, enact, noEnacted, simulate, overwrite, deployment }, env) => {
      const maybeForkEnv = simulate ? getForkEnv(env) : env;
      const network = env.network.name;
      const dm = new DeploymentManager(
        network,
        deployment,
        maybeForkEnv,
        {
          writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
          verificationStrategy: 'lazy',
        }
      );
      await dm.spider();

      let governanceDm: DeploymentManager;
      const base = env.config.scenario.bases.find(b => b.network === network && b.deployment === deployment);
      const isBridgedDeployment = base.auxiliaryBase !== undefined;
      const governanceBase = isBridgedDeployment ? env.config.scenario.bases.find(b => b.name === base.auxiliaryBase) : undefined;

      if (governanceBase) {
        const governanceEnv = hreForBase(governanceBase, simulate);
        governanceDm = new DeploymentManager(
          governanceBase.network,
          governanceBase.deployment,
          governanceEnv,
          {
            writeCacheToDisk: !simulate || overwrite, // Don't write to disk when simulating, unless overwrite is set
            verificationStrategy: 'lazy',
          }
        );
        await governanceDm.spider();
      } else {
        governanceDm = dm;
      }

      const migrationPath = `${__dirname}/../../deployments/${network}/${deployment}/migrations/${migrationName}.ts`;
      const [migration] = await loadMigrations([migrationPath]);
      if (!migration) {
        throw new Error(`Unknown migration for network ${network}/${deployment}: \`${migrationName}\`.`);
      }
      if (!prepare && !enact) {
        prepare = true;
      }

      await runMigration(dm, governanceDm, prepare, enact, migration, overwrite);

      if (enact && !noEnacted) {
        await writeEnacted(migration, dm, true);
      }
    }
  );
