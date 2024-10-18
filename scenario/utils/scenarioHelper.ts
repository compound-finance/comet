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
  liquidationDenominator: 90,
  rewardsAsset: 10000,
  rewardsBase: 1000,
  transferBase: 1000,
  transferAsset: 5000,
  interestSeconds: 110
};

export function getConfigForScenario(ctx: CometContext) {
  if (ctx.world.base.network === 'mainnet' && ctx.world.base.deployment === 'wsteth') {
    config.liquidationBase = 10000;
    config.liquidationBase1 = 1000;
    config.liquidationAsset = 100;
    config.liquidationDenominator = 84;
    config.interestSeconds = 70;
  }
  if (ctx.world.base.network === 'mainnet' && ctx.world.base.deployment === 'usds') {
    config.liquidationAsset = 100;
  }

  return config;
}