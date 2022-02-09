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
  .addFlag('noSpider', 'skip spider')
  .addFlag('sync', 'run synchronously')
  .addOptionalParam('stall', 'milliseconds to wait until we fail for stalling', 60000, types.int)
  .addOptionalParam('workers', 'count of workers', 6, types.int)
  .setAction(async (taskArgs, env: HardhatRuntimeEnvironment) => {
    let bases: ForkSpec[] = getBasesFromTaskArgs(taskArgs.bases, env);

    if (!taskArgs.noSpider) {
      await env.run('scenario:spider', taskArgs);
    }
    await runScenario(env.config.scenario, bases, taskArgs.workers, !taskArgs.sync, taskArgs.stall);
  });

task('scenario:spider', 'Runs spider in preparation for scenarios')
  .addOptionalParam('bases', 'Bases to run on [defaults to all]')
  .setAction(async (taskArgs, env) => {
    let bases: ForkSpec[] = getBasesFromTaskArgs(taskArgs.bases, env);

    await Promise.all(bases.map(async (base) => {
      if (base.name !== 'development') {
        let hre = hreForBase(base);
        let dm = new DeploymentManager(base.name, hre, {
          writeCacheToDisk: true,
        });
        await dm.spider();
      }
    }));
  });
