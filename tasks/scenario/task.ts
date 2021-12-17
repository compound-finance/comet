import { task } from 'hardhat/config';
import { run } from '../../plugins/scenario/worker/Parent';

task("scenario", "Runs scenario tests")
  .setAction(async (taskArgs) => {
    await run(taskArgs);
  });
