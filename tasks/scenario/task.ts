import { task } from 'hardhat/config';
import { run } from '../../plugins/scenario/worker/Parent';
import "../../plugins/scenario/type-extensions";

task("scenario", "Runs scenario tests")
  .setAction(async (_taskArgs, env) => {
    await run(env.config.scenario);
  });
