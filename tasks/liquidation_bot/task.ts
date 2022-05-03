import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import main from "../../plugins/liquidation_bot/index";

task('liquidation-bot', 'Runs liquidation bot')
  .setAction(async ({}, hre: HardhatRuntimeEnvironment) => {
    console.log(`liquidation bot running`);
    await main({
      hre,
    });
  });