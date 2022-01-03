import { task } from 'hardhat/config';
import { run } from '../../plugins/scenario/worker/Parent';
import '../../plugins/scenario/type-extensions';
import { ForkSpec } from '../../plugins/scenario/Runner';

task('scenario', 'Runs scenario tests')
  .addOptionalParam('bases', 'Bases to run on [defaults to all]')
  .setAction(async (taskArgs, env) => {
    let bases: ForkSpec[] = env.config.scenario.bases;
    if (taskArgs.bases) {
      let baseMap = Object.fromEntries(
        env.config.scenario.bases.map((base) => [base.name, base])
      );
      bases = taskArgs.bases.split(',').map((baseName) => {
        let base = baseMap[baseName];
        if (!base) {
          throw new Error(`Unknown base: ${baseName}`);
        }
        return base;
      });
    }

    await run(env.config.scenario, bases);
  });
