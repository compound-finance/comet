import { task } from 'hardhat/config';
import { run } from '../../test/scen2/worker/Parent';

task("scenario", "Runs scenario tests")
  .setAction(async (taskArgs) => {
    await run(taskArgs);
  });
