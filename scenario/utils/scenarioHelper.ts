import { CometContext } from '../context/CometContext';

const config = {
  bulkerBase: 1000000,
  bulkerAsset: 5000,
  bulkerComet: 5000,
  bulkerBorrowBase: 1000,
  bulkerBorrowAsset: 500,
  liquidationBase: 100000,
  liquidationBase1: 1000,
  liquidationAsset: 200,
  rewardsAsset: 10000,
  rewardsBase: 1000,
  transferBase: 1000,
  transferAsset: 5000,
};

export function getConfigForScenario(ctx: CometContext) {
  if(ctx.world.base.network === 'mainnet' && ctx.world.base.deployment === 'wbtc') {
    config.bulkerBase = 5000;
    config.bulkerAsset = 200;
    config.bulkerComet = 200;
    config.bulkerBorrowBase = 100;
    config.bulkerBorrowAsset = 50;
    config.liquidationBase = 1000;
    config.liquidationBase1 = 500;
    config.liquidationAsset = 100;
    config.rewardsAsset = 1000;
    config.rewardsBase = 100;
    config.transferBase = 100;
    config.transferAsset = 500;
  }
  return config;
}
