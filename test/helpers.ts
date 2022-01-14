import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Block } from '@ethersproject/abstract-provider';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  CometHarness as Comet,
  CometHarness__factory as Comet__factory,
  FaucetToken,
  FaucetToken__factory,
  MockedOracle,
  MockedOracle__factory,
} from '../build/types';

export { Comet, ethers, expect };

export type Numeric = number | bigint;

export type ProtocolOpts = {
  start?: number;
  assets?: {
    [symbol: string]: {
      name?: string;
      initial?: Numeric;
      decimals?: Numeric;
      borrowCF?: Numeric;
      liquidateCF?: Numeric;
    };
  };
  governor?: SignerWithAddress;
  pauseGuardian?: SignerWithAddress;
  base?: string;
  reward?: string;
  kink?: Numeric;
  interestRateBase?: Numeric;
  interestRateSlopeLow?: Numeric;
  interestRateSlopeHigh?: Numeric;
  reserveRate?: Numeric;
  trackingIndexScale?: Numeric;
  baseTrackingSupplySpeed?: Numeric;
  baseTrackingBorrowSpeed?: Numeric;
  baseMinForRewards?: Numeric;
  baseBorrowMin?: Numeric;
};

export type Protocol = {
  opts: ProtocolOpts;
  governor: SignerWithAddress;
  pauseGuardian: SignerWithAddress;
  users: SignerWithAddress[],
  base: string,
  reward: string,
  comet: Comet;
  oracle: MockedOracle;
  tokens: {
    [symbol: string]: FaucetToken;
  };
  unsupportedToken: FaucetToken;
};

export function dfn<T>(x: T | undefined | null, dflt: T): T {
  return x == undefined ? dflt : x;
}

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const factorScale = exp(1, 18);
const ONE = factorScale;

export async function getBlock(n?: number): Promise<Block> {
  const blockNumber = n === undefined ? await ethers.provider.getBlockNumber() : n;
  return ethers.provider.getBlock(blockNumber);
}

export async function makeProtocol(opts: ProtocolOpts = {}): Promise<Protocol> {
  const signers = await ethers.getSigners();
  const assets = opts.assets || {
    COMP: { initial: 1e7, decimals: 18 },
    USDC: { initial: 1e6, decimals: 6 },
    WETH: { initial: 1e4, decimals: 18 },
    WBTC: { initial: 1e3, decimals: 8 },
  };
  const governor = opts.governor || signers[0];
  const pauseGuardian = opts.pauseGuardian || signers[1];
  const users = signers.slice(2) // guaranteed to not be governor or pause guardian
  const base = opts.base || 'USDC';
  const reward = opts.reward || 'COMP';
  const kink = dfn(opts.kink, exp(8, 17)); // 0.8
  const perYearInterestRateBase = dfn(opts.interestRateBase, exp(5, 15)); // 0.005
  const perYearInterestRateSlopeLow = dfn(opts.interestRateSlopeLow, exp(1, 17)); // 0.1
  const perYearInterestRateSlopeHigh = dfn(opts.interestRateSlopeHigh, exp(3, 18)); // 3.0
  const reserveRate = dfn(opts.reserveRate, exp(1, 17)); // 0.1
  const trackingIndexScale = opts.trackingIndexScale || exp(1, 15);
  const baseTrackingSupplySpeed = dfn(opts.baseTrackingSupplySpeed, trackingIndexScale);
  const baseTrackingBorrowSpeed = dfn(opts.baseTrackingBorrowSpeed, trackingIndexScale);
  const baseMinForRewards = dfn(opts.baseMinForRewards, exp(1, assets[base].decimals));
  const baseBorrowMin = dfn(opts.baseBorrowMin, exp(1, assets[base].decimals));

  const FaucetFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
  const tokens = {};
  for (const symbol in assets) {
    const config = assets[symbol];
    const decimals = config.decimals || 18;
    const initial = config.initial || 1e6;
    const name = config.name || symbol;
    const token = (tokens[symbol] = await FaucetFactory.deploy(initial, name, decimals, symbol));
    await token.deployed();
  }

  const unsupportedToken = await FaucetFactory.deploy(1e6, 'Unsupported Token', 6, 'USUP');

  const OracleFactory = (await ethers.getContractFactory('MockedOracle')) as MockedOracle__factory;
  const oracle = await OracleFactory.deploy();
  await oracle.deployed();

  if (opts.start)
    await ethers.provider.send('evm_setNextBlockTimestamp', [opts.start]);

  const CometFactory = (await ethers.getContractFactory('CometHarness')) as Comet__factory;
  const comet = await CometFactory.deploy({
    governor: governor.address,
    pauseGuardian: pauseGuardian.address,
    priceOracle: oracle.address,
    baseToken: tokens[base].address,
    kink,
    perYearInterestRateBase,
    perYearInterestRateSlopeLow,
    perYearInterestRateSlopeHigh,
    reserveRate,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    assetInfo: Object.entries(assets).reduce((acc, [symbol, config], i) => {
      if (symbol != base) {
        acc.push({
          asset: tokens[symbol].address,
          borrowCollateralFactor: config.borrowCF || ONE,
          liquidateCollateralFactor: config.liquidateCF || ONE,
        });
      }
      return acc;
    }, []),
  });
  await comet.deployed();

  return { opts, governor, pauseGuardian, users, base, reward, comet, oracle, tokens, unsupportedToken };
}

export async function portfolio({comet, base, tokens}, account) {
  const balances = {[base]: BigInt(await comet.baseBalanceOf(account))};
  for (const symbol in tokens) {
    if (symbol != base) {
      balances[symbol] = BigInt(await comet.collateralBalanceOf(account, tokens[symbol].address));
    }
  }
  return balances;
}

export async function wait(tx) {
  const tx_ = await tx;
  tx_.receipt = await tx_.wait();
  return tx_;
}
