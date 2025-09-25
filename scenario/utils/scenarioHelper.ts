import { CometContext } from '../context/CometContext';

const config = {
  bulkerBase: 1000000,
  bulkerBase1: 10,
  bulkerAsset: 5000,
  bulkerAsset1: 5000,
  bulkerAsset2: 10,
  bulkerComet: 5000,
  bulkerBorrowBase: 1000,
  bulkerBorrowAsset: 500,
  liquidationBase: 100000,
  liquidationBase1: 1000,
  liquidationBase2: 1000,
  liquidationAsset: 200,
  liquidationAsset1: 1000,
  liquidationDenominator: 90,
  liquidationDenominator1: 100,
  liquidationNumerator: 90,
  rewardsAsset: 10000,
  rewardsBase: 1000,
  transferBase: 1000,
  transferAsset: 5000,
  transferAsset1: 5000,
  interestSeconds: 110,
  withdrawBase: 1000,
  withdrawAsset: 3000,
  withdrawBase1: 1000,
  withdrawAsset1: 3000,
  withdrawCollateral: 100,
  transferCollateral: 100,
  supplyCollateral: 100
};

export function getConfigForScenario(ctx: CometContext) {
  if (ctx.world.base.network === 'mainnet' && ctx.world.base.deployment === 'wbtc') {
    config.bulkerBase = 200;
    config.bulkerAsset = 400;
    config.bulkerAsset1 = 400;
    config.bulkerComet = 200;
    config.bulkerBorrowBase = 100;
    config.withdrawBase = 100;
    config.withdrawAsset = 200;
    config.bulkerBorrowAsset = 50;
    config.liquidationBase = 1000;
    config.liquidationBase1 = 500;
    config.liquidationAsset = 100;
    config.rewardsAsset = 100;
    config.rewardsBase = 10;
    config.transferBase = 100;
    config.transferAsset = 500;
    config.transferAsset1 = 500;
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
    config.liquidationBase = 10000;
  }

  if (ctx.world.base.network === 'mainnet' && ctx.world.base.deployment === 'usds') {
    config.liquidationAsset = 100;
  }

  if (ctx.world.base.network === 'base' && ctx.world.base.deployment === 'aero') {
    config.interestSeconds = 110;
  }

  if (ctx.world.base.network === 'base' && ctx.world.base.deployment === 'usds') {
    config.liquidationBase2 = 100;
    config.liquidationAsset1 = 99;
  }

  if (ctx.world.base.network === 'base' && ctx.world.base.deployment === 'weth') {
    config.liquidationBase = 1000;
  }

  if (ctx.world.base.network === 'optimism' && ctx.world.base.deployment === 'weth') {
    config.liquidationBase = 1000;
  }

  if (ctx.world.base.network === 'arbitrum' && ctx.world.base.deployment === 'usdc') {
    config.withdrawAsset = 3500;
  }

  if (ctx.world.base.network === 'arbitrum' && ctx.world.base.deployment === 'usdt') {
    config.withdrawAsset = 3500;
  }

  if (ctx.world.base.network === 'arbitrum' && ctx.world.base.deployment === 'usdc.e') {
    config.withdrawAsset = 7000;
    config.bulkerAsset = 10000;
    config.bulkerAsset1 = 10000;
    config.transferAsset = 10000;
    config.transferAsset1 = 10000;
    config.liquidationDenominator = 84;
    config.liquidationBase = 100000;
    config.liquidationBase1 = 50000;
    config.liquidationAsset = 10000;
  }

  if (ctx.world.base.network === 'arbitrum' && ctx.world.base.deployment === 'weth') {
    config.liquidationBase = 1000;
  }

  if (ctx.world.base.network === 'ronin' && ctx.world.base.deployment === 'weth') {
    config.transferBase = 10;
    config.transferAsset = 200000;
    config.transferAsset1 = 200000;
    config.rewardsAsset = 1000000;
    config.rewardsBase = 200;
    config.withdrawBase = 10;
    config.withdrawBase1 = 10;
    config.withdrawAsset = 100000;
    config.withdrawAsset1 = 10000;
    config.liquidationBase = 150;
    config.liquidationBase1 = 50;
    config.liquidationAsset = 5;
    config.bulkerAsset = 100000;
    config.bulkerAsset1 = 100000;
    config.bulkerComet = 100;
    config.bulkerBorrowBase = 10;
    config.bulkerBorrowAsset = 10;
    config.bulkerBase = 100;
  }

  if (ctx.world.base.network === 'polygon' && ctx.world.base.deployment === 'usdc') {
    config.bulkerAsset = 200;
    config.bulkerAsset1 = 200;
  }

  if (ctx.world.base.network === 'polygon' && ctx.world.base.deployment === 'usdt') {
    config.withdrawAsset = 10000;
    config.transferAsset = 500000;
    config.transferBase = 100;
  }

  if (ctx.world.base.network === 'scroll' && ctx.world.base.deployment === 'usdc') {
    config.bulkerAsset = 200;
    config.bulkerAsset1 = 200;
  }

  if (ctx.world.base.network === 'sepolia' && ctx.world.base.deployment === 'usdc') {
    config.bulkerAsset1 = 10;
  }

  if (ctx.world.base.network === 'linea' && ctx.world.base.deployment === 'usdc') {
    config.bulkerAsset = 500;
    config.bulkerAsset1 = 500;
    config.supplyCollateral = 10;
    config.transferCollateral = 10;
    config.withdrawCollateral = 10;    
  }

  if (ctx.world.base.network === 'linea' && ctx.world.base.deployment === 'usdt') {
    config.bulkerBase = 10000;
    config.bulkerAsset = 500;
    config.bulkerAsset1 = 100;
    config.supplyCollateral = 10;
    config.transferCollateral = 10;
    config.withdrawCollateral = 10;
  }

  if (ctx.world.base.network === 'unichain' && ctx.world.base.deployment === 'weth') {
    config.liquidationBase = 1000;
    config.liquidationBase1 = 350;
    config.liquidationAsset = 100;
    config.bulkerAsset = 500;
    config.bulkerComet = 500;
    config.bulkerBorrowBase = 100;
    config.bulkerBorrowAsset = 50;
    config.rewardsBase = 100;
    config.rewardsAsset = 1000;
    config.transferBase = 100;
    config.transferAsset = 500;
    config.transferAsset1 = 500;
  }

  if (ctx.world.base.network === 'fuji' && ctx.world.base.deployment === 'usdc') {
    config.liquidationAsset = 100;
  }

  return config;
}
