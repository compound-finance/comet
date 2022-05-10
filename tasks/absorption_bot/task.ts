import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import main from '../../plugins/absorption_bot/index';
import { types } from 'hardhat/config';

task('absorption-bot', 'Runs Absorption bot')
  .addOptionalParam('delay', 'milliseconds to wait between loops', 1000, types.int)
  .addFlag('quiet', 'silence logging')
  .setAction(async ({ delay, quiet }, hre: HardhatRuntimeEnvironment) => {
    await main({
      hre,
      loopDelay: delay,
      log: !quiet
    });
  });
