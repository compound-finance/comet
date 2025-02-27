import { CometContext } from '../context/CometContext';

const config = {
  bulkerBase: 1000000,
  bulkerAsset: 5000,
  bulkerAsset1: 5000,
  bulkerComet: 5000,
  bulkerBorrowBase: 1000,
  bulkerTransferBase: 500,
  bulkerBorrowAsset: 500,
  liquidationBase: 100000,
  liquidationBase1: 1000,
  liquidationAsset: 200,
  liquidationDenominator: 90,
  liquidationNumerator: 90,
  rewardsAsset: 10000,
  transferBase: 1000,
  transferAsset: 5000,
  interestSeconds: 110,
  rewardsBase: 1000,
  minAccrue: 1000,
};

export function getConfigForScenario(ctx: CometContext) {
  if (ctx.world.base.network === 'mainnet' && ctx.world.base.deployment === 'wbtc') {
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
    config.interestSeconds = 70;
  }
  
  if (ctx.world.base.network === 'mainnet' && ctx.world.base.deployment === 'wsteth') {
    config.liquidationBase = 10000;
    config.liquidationBase1 = 1000;
    config.liquidationAsset = 100;
    config.liquidationDenominator = 84;
    config.interestSeconds = 70;
  }

  if (ctx.world.base.network === 'mainnet' && ctx.world.base.deployment === 'weth') {
    config.liquidationNumerator = 60;
  }

  if (ctx.world.base.network === 'mainnet' && ctx.world.base.deployment === 'usds') {
    config.liquidationAsset = 100;
  }
  
  if (ctx.world.base.network === 'base' && ctx.world.base.deployment === 'aero') {
    config.interestSeconds = 110;
  }

  if (ctx.world.base.network === 'sepolia' && ctx.world.base.deployment === 'usdc') {
    config.rewardsBase = 100000;
  }

  if (ctx.world.base.network === 'polygon' && ctx.world.base.deployment === 'usdc') {
    config.bulkerAsset1 = 500;
  }


  return config;
}