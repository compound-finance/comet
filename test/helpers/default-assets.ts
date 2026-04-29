import { ethers } from 'hardhat';

function factor(value: string): bigint {
  return ethers.utils.parseUnits(value, 18).toBigInt();
}

export function defaultAssets(overrides = {}, perAssetOverrides = {}) {
  return {
    COMP: Object.assign({
      initial: 1e7,
      decimals: 18,
      initialPrice: 175,
    }, overrides, perAssetOverrides['COMP'] || {}),
    USDC: Object.assign({
      initial: 1e6,
      decimals: 6,
    }, overrides, perAssetOverrides['USDC'] || {}),
    WETH: Object.assign({
      initial: 1e4,
      decimals: 18,
      initialPrice: 3000,
    }, overrides, perAssetOverrides['WETH'] || {}),
    WBTC: Object.assign({
      initial: 1e3,
      decimals: 8,
      initialPrice: 41000,
    }, overrides, perAssetOverrides['WBTC'] || {}),
  };
}

export function default24Assets() {
  return {
    USDC: { decimals: 6, initialPrice: 1 },
    COMP: {
      decimals: 18,
      initialPrice: 100,
      borrowCF: factor('0.8'),
      liquidateCF: factor('0.85'),
      liquidationFactor: factor('0.9'),
    },
    WETH: {
      decimals: 18,
      initialPrice: 2000,
      borrowCF: factor('0.75'),
      liquidateCF: factor('0.80'),
      liquidationFactor: factor('0.9'),
    },
    USDT: {
      decimals: 6,
      initialPrice: 1,
      borrowCF: factor('0.85'),
      liquidateCF: factor('0.90'),
      liquidationFactor: factor('0.95'),
    },
    WBTC: {
      decimals: 8,
      initialPrice: 65000,
      borrowCF: factor('0.70'),
      liquidateCF: factor('0.75'),
      liquidationFactor: factor('0.90'),
    },
    DAI: {
      decimals: 18,
      initialPrice: 1,
      borrowCF: factor('0.83'),
      liquidateCF: factor('0.88'),
      liquidationFactor: factor('0.95'),
    },
    wstETH: {
      decimals: 18,
      initialPrice: 3600,
      borrowCF: factor('0.75'),
      liquidateCF: factor('0.80'),
      liquidationFactor: factor('0.93'),
    },
    rsETH: {
      decimals: 18,
      initialPrice: 3400,
      borrowCF: factor('0.72'),
      liquidateCF: factor('0.78'),
      liquidationFactor: factor('0.92'),
    },
    cbETH: {
      decimals: 18,
      initialPrice: 3300,
      borrowCF: factor('0.72'),
      liquidateCF: factor('0.78'),
      liquidationFactor: factor('0.92'),
    },
    rETH: {
      decimals: 18,
      initialPrice: 3500,
      borrowCF: factor('0.72'),
      liquidateCF: factor('0.78'),
      liquidationFactor: factor('0.92'),
    },
    weETH: {
      decimals: 18,
      initialPrice: 3400,
      borrowCF: factor('0.70'),
      liquidateCF: factor('0.76'),
      liquidationFactor: factor('0.91'),
    },
    ezETH: {
      decimals: 18,
      initialPrice: 3350,
      borrowCF: factor('0.70'),
      liquidateCF: factor('0.76'),
      liquidationFactor: factor('0.91'),
    },
    cbBTC: {
      decimals: 8,
      initialPrice: 65000,
      borrowCF: factor('0.70'),
      liquidateCF: factor('0.75'),
      liquidationFactor: factor('0.90'),
    },
    tBTC: {
      decimals: 18,
      initialPrice: 65000,
      borrowCF: factor('0.68'),
      liquidateCF: factor('0.74'),
      liquidationFactor: factor('0.90'),
    },
    LINK: {
      decimals: 18,
      initialPrice: 15,
      borrowCF: factor('0.65'),
      liquidateCF: factor('0.70'),
      liquidationFactor: factor('0.88'),
    },
    UNI: {
      decimals: 18,
      initialPrice: 8,
      borrowCF: factor('0.60'),
      liquidateCF: factor('0.65'),
      liquidationFactor: factor('0.85'),
    },
    AAVE: {
      decimals: 18,
      initialPrice: 100,
      borrowCF: factor('0.60'),
      liquidateCF: factor('0.65'),
      liquidationFactor: factor('0.85'),
    },
    LDO: {
      decimals: 18,
      initialPrice: 2,
      borrowCF: factor('0.55'),
      liquidateCF: factor('0.62'),
      liquidationFactor: factor('0.85'),
    },
    CRV: {
      decimals: 18,
      initialPrice: 1,
      borrowCF: factor('0.45'),
      liquidateCF: factor('0.55'),
      liquidationFactor: factor('0.80'),
    },
    MKR: {
      decimals: 18,
      initialPrice: 2500,
      borrowCF: factor('0.60'),
      liquidateCF: factor('0.65'),
      liquidationFactor: factor('0.85'),
    },
    ARB: {
      decimals: 18,
      initialPrice: 1,
      borrowCF: factor('0.55'),
      liquidateCF: factor('0.62'),
      liquidationFactor: factor('0.85'),
    },
    OP: {
      decimals: 18,
      initialPrice: 2,
      borrowCF: factor('0.55'),
      liquidateCF: factor('0.62'),
      liquidationFactor: factor('0.85'),
    },
    GMX: {
      decimals: 18,
      initialPrice: 40,
      borrowCF: factor('0.50'),
      liquidateCF: factor('0.58'),
      liquidationFactor: factor('0.82'),
    },
    USDe: {
      decimals: 18,
      initialPrice: 1,
      borrowCF: factor('0.75'),
      liquidateCF: factor('0.82'),
      liquidationFactor: factor('0.92'),
    },
    sUSDe: {
      decimals: 18,
      initialPrice: 1,
      borrowCF: factor('0.72'),
      liquidateCF: factor('0.80'),
      liquidationFactor: factor('0.92'),
    },
  };
}