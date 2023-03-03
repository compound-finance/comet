import { task } from 'hardhat/config';
import { runScenarios } from '../../plugins/scenario/Runner';
import hreForBase from '../../plugins/scenario/utils/hreForBase';
import '../../plugins/scenario/type-extensions';
import { ForkSpec } from '../../plugins/scenario/World';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';

function getBasesFromTaskArgs(givenBases: string | undefined, env: HardhatRuntimeEnvironment): ForkSpec[] {
  let bases: ForkSpec[] = env.config.scenario.bases;
  if (givenBases) {
    let baseMap = Object.fromEntries(env.config.scenario.bases.map((base) => [base.name, base]));
    bases = givenBases.split(',').map((baseName) => {
      let base = baseMap[baseName];
      if (!base) {
        throw new Error(`Unknown base: ${baseName}`);
      }
      return base;
    });
  }

  return bases;
}

task('scenario', 'Runs scenario tests')
  .addOptionalParam('bases', 'Bases to run on [defaults to all]')
  .addFlag('spider', 'run spider persistently before scenarios')
  .setAction(async (taskArgs, env: HardhatRuntimeEnvironment) => {
    const bases: ForkSpec[] = getBasesFromTaskArgs(taskArgs.bases, env);
    if (taskArgs.spider) {
      await env.run('scenario:spider', taskArgs);
    }
    await runScenarios(bases);
  });

task('scenario:spider', 'Runs spider in preparation for scenarios')
  .addOptionalParam('bases', 'Bases to run on [defaults to all]')
  .setAction(async (taskArgs, env) => {
    const bases: ForkSpec[] = getBasesFromTaskArgs(taskArgs.bases, env);
    await Promise.all(bases.map(async (base) => {
      if (base.network !== 'hardhat') {
        let hre = hreForBase(base);
        let dm = new DeploymentManager(
          base.name,
          base.deployment,
          hre,
          {
            writeCacheToDisk: true,
          }
        );
        await dm.spider();
      }
    }));
  });
