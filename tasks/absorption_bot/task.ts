import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import main from "../../plugins/absorption_bot/index";

task('absorption-bot', 'Runs Absorption bot')
  .setAction(async ({}, hre: HardhatRuntimeEnvironment) => {
    await main({
      hre,
    });
  });
