import { task } from 'hardhat/config';
import { runScenario } from '../../plugins/scenario/worker/Parent';
import hreForBase from '../../plugins/scenario/utils/hreForBase';
import '../../plugins/scenario/type-extensions';
import { ForkSpec } from '../../plugins/scenario/World';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import * as types from 'hardhat/internal/core/params/argumentTypes'; // TODO harhdat argument types not from internal

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
  .addOptionalParam('stall', 'milliseconds to wait until we fail for stalling', 240_000, types.int)
  .addOptionalParam('workers', 'count of workers', 1, types.int) // TODO: optimize parallelized workers better (1 per base?)
  .setAction(async (taskArgs, env: HardhatRuntimeEnvironment) => {
    const bases: ForkSpec[] = getBasesFromTaskArgs(taskArgs.bases, env);
    if (taskArgs.spider) {
      await env.run('scenario:spider', taskArgs);
    }
    await runScenario(env.config.scenario, bases, taskArgs.workers, taskArgs.workers > 1, taskArgs.stall);
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
