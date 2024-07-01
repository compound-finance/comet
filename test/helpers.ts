import hre from 'hardhat';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Block } from '@ethersproject/abstract-provider';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  BaseBulker,
  BaseBulker__factory,
  CometExt,
  CometExt__factory,
  CometHarness__factory,
  CometHarnessInterface as Comet,
  CometRewards,
  CometRewards__factory,
  EvilToken__factory,
  FaucetToken,
  FaucetToken__factory,
  FaucetWETH__factory,
  SimplePriceFeed,
  SimplePriceFeed__factory,
  TransparentUpgradeableProxy,
  TransparentUpgradeableProxy__factory,
  ConfiguratorProxy,
  ConfiguratorProxy__factory,
  CometProxyAdmin,
  CometProxyAdmin__factory,
  CometFactory,
  CometFactory__factory,
  Configurator,
  Configurator__factory,
  CometHarnessInterface,
  CometInterface,
  NonStandardFaucetFeeToken,
  NonStandardFaucetFeeToken__factory,
} from '../build/types';
import { BigNumber } from 'ethers';
import { TransactionReceipt, TransactionResponse } from '@ethersproject/abstract-provider';
import { TotalsBasicStructOutput, TotalsCollateralStructOutput } from '../build/types/CometHarness';

export { Comet, ethers, expect, hre };

export type Numeric = number | bigint;

export enum ReentryAttack {
  TransferFrom = 0,
  WithdrawFrom = 1,
  SupplyFrom = 2,
  BuyCollateral = 3,
}

export type ProtocolOpts = {
  start?: number;
  assets?: {
    [symbol: string]: {
      name?: string;
      initial?: Numeric;
      decimals?: Numeric;
      borrowCF?: Numeric;
      liquidateCF?: Numeric;
      liquidationFactor?: Numeric;
      supplyCap?: Numeric;
      initialPrice?: number;
      priceFeedDecimals?: number;
      factory?: FaucetToken__factory | EvilToken__factory | FaucetWETH__factory | NonStandardFaucetFeeToken__factory;
    };
  };
  name?: string;
  symbol?: string;
  governor?: SignerWithAddress;
  pauseGuardian?: SignerWithAddress;
  extensionDelegate?: CometExt;
  base?: string;
  reward?: string;
  supplyKink?: Numeric;
  supplyInterestRateBase?: Numeric;
  supplyInterestRateSlopeLow?: Numeric;
  supplyInterestRateSlopeHigh?: Numeric;
  borrowKink?: Numeric;
  borrowInterestRateBase?: Numeric;
  borrowInterestRateSlopeLow?: Numeric;
  borrowInterestRateSlopeHigh?: Numeric;
  storeFrontPriceFactor?: Numeric;
  trackingIndexScale?: Numeric;
  baseTrackingSupplySpeed?: Numeric;
  baseTrackingBorrowSpeed?: Numeric;
  baseMinForRewards?: Numeric;
  baseBorrowMin?: Numeric;
  targetReserves?: Numeric;
  baseTokenBalance?: Numeric;
};

export type Protocol = {
  opts: ProtocolOpts;
  governor: SignerWithAddress;
  pauseGuardian: SignerWithAddress;
  extensionDelegate: CometExt;
  users: SignerWithAddress[];
  base: string;
  reward: string;
  comet: Comet;
  tokens: {
    [symbol: string]: FaucetToken | NonStandardFaucetFeeToken;
  };
  unsupportedToken: FaucetToken;
  priceFeeds: {
    [symbol: string]: SimplePriceFeed;
  };
};

export type ConfiguratorAndProtocol = {
  configurator: Configurator;
  configuratorProxy: ConfiguratorProxy;
  proxyAdmin: CometProxyAdmin;
  cometFactory: CometFactory;
  cometProxy: TransparentUpgradeableProxy;
} & Protocol;

export type RewardsOpts = {
  governor?: SignerWithAddress;
  configs?: [Comet, FaucetToken | NonStandardFaucetFeeToken, Numeric?][];
};

export type Rewards = {
  opts: RewardsOpts;
  governor: SignerWithAddress;
  rewards: CometRewards;
};

export type BulkerOpts = {
  admin?: SignerWithAddress;
  weth?: string;
};

export type BulkerInfo = {
  opts: BulkerOpts;
  bulker: BaseBulker;
};

export function dfn<T>(x: T | undefined | null, dflt: T): T {
  return x == undefined ? dflt : x;
}

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

export function factor(f: number): bigint {
  return exp(f, factorDecimals);
}

export function defactor(f: bigint | BigNumber): number {
  return Number(toBigInt(f)) / 1e18;
}

// Truncates a factor to a certain number of decimals
export function truncateDecimals(factor: bigint | BigNumber, decimals = 4) {
  const descaleFactor = factorScale / exp(1, decimals);
  return toBigInt(factor) / descaleFactor * descaleFactor;
}

export function mulPrice(n: bigint, price: bigint | BigNumber, fromScale: bigint | BigNumber): bigint {
  return n * toBigInt(price) / toBigInt(fromScale);
}

function toBigInt(f: bigint | BigNumber): bigint {
  if (typeof f === 'bigint') {
    return f;
  } else {
    return f.toBigInt();
  }
}

export function annualize(n: bigint | BigNumber, secondsPerYear = 31536000n): number {
  return defactor(toBigInt(n) * secondsPerYear);
}

export function toYears(seconds: number, secondsPerYear = 31536000): number {
  return seconds / secondsPerYear;
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

export const factorDecimals = 18;
export const factorScale = factor(1);
export const ONE = factorScale;
export const ZERO = factor(0);

export async function getBlock(n?: number, ethers_ = ethers): Promise<Block> {
  const blockNumber = n == undefined ? await ethers_.provider.getBlockNumber() : n;
  return ethers_.provider.getBlock(blockNumber);
}

export async function fastForward(seconds: number, ethers_ = ethers): Promise<Block> {
  const block = await getBlock();
  await ethers_.provider.send('evm_setNextBlockTimestamp', [block.timestamp + seconds]);
  return block;
}

export async function makeProtocol(opts: ProtocolOpts = {}): Promise<Protocol> {
  const signers = await ethers.getSigners();

  const assets = opts.assets || defaultAssets();
  let priceFeeds = {};
  const PriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
  for (const asset in assets) {
    const initialPrice = exp(assets[asset].initialPrice || 1, 8);
    const priceFeedDecimals = assets[asset].priceFeedDecimals || 8;
    const priceFeed = await PriceFeedFactory.deploy(initialPrice, priceFeedDecimals);
    await priceFeed.deployed();
    priceFeeds[asset] = priceFeed;
  }

  const name32 = ethers.utils.formatBytes32String((opts.name || 'Compound Comet'));
  const symbol32 = ethers.utils.formatBytes32String((opts.symbol || '📈BASE'));
  const governor = opts.governor || signers[0];
  const pauseGuardian = opts.pauseGuardian || signers[1];
  const users = signers.slice(2); // guaranteed to not be governor or pause guardian
  const base = opts.base || 'USDC';
  const reward = opts.reward || 'COMP';
  const supplyKink = dfn(opts.supplyKink, exp(0.8, 18));
  const supplyPerYearInterestRateBase = dfn(opts.supplyInterestRateBase, exp(0.0, 18));
  const supplyPerYearInterestRateSlopeLow = dfn(opts.supplyInterestRateSlopeLow, exp(0.05, 18));
  const supplyPerYearInterestRateSlopeHigh = dfn(opts.supplyInterestRateSlopeHigh, exp(2, 18));
  const borrowKink = dfn(opts.borrowKink, exp(0.8, 18));
  const borrowPerYearInterestRateBase = dfn(opts.borrowInterestRateBase, exp(0.005, 18));
  const borrowPerYearInterestRateSlopeLow = dfn(opts.borrowInterestRateSlopeLow, exp(0.1, 18));
  const borrowPerYearInterestRateSlopeHigh = dfn(opts.borrowInterestRateSlopeHigh, exp(3, 18));
  const storeFrontPriceFactor = dfn(opts.storeFrontPriceFactor, ONE);
  const trackingIndexScale = opts.trackingIndexScale || exp(1, 15);
  const baseTrackingSupplySpeed = dfn(opts.baseTrackingSupplySpeed, trackingIndexScale);
  const baseTrackingBorrowSpeed = dfn(opts.baseTrackingBorrowSpeed, trackingIndexScale);
  const baseMinForRewards = dfn(opts.baseMinForRewards, exp(1, assets[base].decimals));
  const baseBorrowMin = dfn(opts.baseBorrowMin, exp(1, assets[base].decimals));
  const targetReserves = dfn(opts.targetReserves, 0);

  const FaucetFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
  const tokens = {};
  for (const symbol in assets) {
    const config = assets[symbol];
    const decimals = config.decimals || 18;
    const initial = config.initial || 1e6;
    const name = config.name || symbol;
    const factory = config.factory || FaucetFactory;
    let token;
    token = (tokens[symbol] = await factory.deploy(initial, name, decimals, symbol));
    await token.deployed();
  }

  const unsupportedToken = await FaucetFactory.deploy(1e6, 'Unsupported Token', 6, 'USUP');

  let extensionDelegate = opts.extensionDelegate;
  if (extensionDelegate === undefined) {
    const CometExtFactory = (await ethers.getContractFactory('CometExt')) as CometExt__factory;
    extensionDelegate = await CometExtFactory.deploy({ name32, symbol32 });
    await extensionDelegate.deployed();
  }

  const CometFactory = (await ethers.getContractFactory('CometHarness')) as CometHarness__factory;
  const comet = await CometFactory.deploy({
    governor: governor.address,
    pauseGuardian: pauseGuardian.address,
    extensionDelegate: extensionDelegate.address,
    baseToken: tokens[base].address,
    baseTokenPriceFeed: priceFeeds[base].address,
    supplyKink,
    supplyPerYearInterestRateBase,
    supplyPerYearInterestRateSlopeLow,
    supplyPerYearInterestRateSlopeHigh,
    borrowKink,
    borrowPerYearInterestRateBase,
    borrowPerYearInterestRateSlopeLow,
    borrowPerYearInterestRateSlopeHigh,
    storeFrontPriceFactor,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs: Object.entries(assets).reduce((acc, [symbol, config], _i) => {
      if (symbol != base) {
        acc.push({
          asset: tokens[symbol].address,
          priceFeed: priceFeeds[symbol].address,
          decimals: dfn(assets[symbol].decimals, 18),
          borrowCollateralFactor: dfn(config.borrowCF, ONE - 1n),
          liquidateCollateralFactor: dfn(config.liquidateCF, ONE),
          liquidationFactor: dfn(config.liquidationFactor, ONE),
          supplyCap: dfn(config.supplyCap, exp(100, dfn(config.decimals, 18))),
        });
      }
      return acc;
    }, []),
  });
  await comet.deployed();

  if (opts.start) await ethers.provider.send('evm_setNextBlockTimestamp', [opts.start]);
  await comet.initializeStorage();

  const baseTokenBalance = opts.baseTokenBalance;
  if (baseTokenBalance) {
    const baseToken = tokens[base];
    await wait(baseToken.allocateTo(comet.address, baseTokenBalance));
  }

  return {
    opts,
    governor,
    pauseGuardian,
    extensionDelegate,
    users,
    base,
    reward,
    comet: await ethers.getContractAt('CometHarnessInterface', comet.address) as Comet,
    tokens,
    unsupportedToken,
    priceFeeds,
  };
}

// Only for testing configurator. Non-configurator tests need to deploy the CometHarness instead.
export async function makeConfigurator(opts: ProtocolOpts = {}): Promise<ConfiguratorAndProtocol> {
  const assets = opts.assets || defaultAssets();

  const {
    governor,
    pauseGuardian,
    extensionDelegate,
    users,
    base,
    reward,
    comet,
    tokens,
    unsupportedToken,
    priceFeeds,
  } = await makeProtocol(opts);

  // Deploy ProxyAdmin
  const ProxyAdmin = (await ethers.getContractFactory('CometProxyAdmin')) as CometProxyAdmin__factory;
  const proxyAdmin = await ProxyAdmin.connect(governor).deploy();
  await proxyAdmin.deployed();

  // Deploy Comet proxy
  const CometProxy = (await ethers.getContractFactory('TransparentUpgradeableProxy')) as TransparentUpgradeableProxy__factory;
  const cometProxy = await CometProxy.deploy(
    comet.address,
    proxyAdmin.address,
    (await comet.populateTransaction.initializeStorage()).data,
  );
  await cometProxy.deployed();

  // Derive the rest of the Configurator configuration values
  const supplyKink = dfn(opts.supplyKink, exp(0.8, 18));
  const supplyPerYearInterestRateBase = dfn(opts.supplyInterestRateBase, exp(0.0, 18));
  const supplyPerYearInterestRateSlopeLow = dfn(opts.supplyInterestRateSlopeLow, exp(0.05, 18));
  const supplyPerYearInterestRateSlopeHigh = dfn(opts.supplyInterestRateSlopeHigh, exp(2, 18));
  const borrowKink = dfn(opts.borrowKink, exp(0.8, 18));
  const borrowPerYearInterestRateBase = dfn(opts.borrowInterestRateBase, exp(0.005, 18));
  const borrowPerYearInterestRateSlopeLow = dfn(opts.borrowInterestRateSlopeLow, exp(0.1, 18));
  const borrowPerYearInterestRateSlopeHigh = dfn(opts.borrowInterestRateSlopeHigh, exp(3, 18));
  const storeFrontPriceFactor = await comet.storeFrontPriceFactor();
  const trackingIndexScale = await comet.trackingIndexScale();
  const baseTrackingSupplySpeed = await comet.baseTrackingSupplySpeed();
  const baseTrackingBorrowSpeed = await comet.baseTrackingBorrowSpeed();
  const baseMinForRewards = await comet.baseMinForRewards();
  const baseBorrowMin = await comet.baseBorrowMin();
  const targetReserves = await comet.targetReserves();

  // Deploy CometFactory
  const CometFactoryFactory = (await ethers.getContractFactory('CometFactory')) as CometFactory__factory;
  const cometFactory = await CometFactoryFactory.deploy();
  await cometFactory.deployed();

  // Deploy Configurator
  const ConfiguratorFactory = (await ethers.getContractFactory('Configurator')) as Configurator__factory;
  const configurator = await ConfiguratorFactory.deploy();
  await configurator.deployed();
  const configuration = {
    governor: governor.address,
    pauseGuardian: pauseGuardian.address,
    extensionDelegate: extensionDelegate.address,
    baseToken: tokens[base].address,
    baseTokenPriceFeed: priceFeeds[base].address,
    supplyKink,
    supplyPerYearInterestRateBase,
    supplyPerYearInterestRateSlopeLow,
    supplyPerYearInterestRateSlopeHigh,
    borrowKink,
    borrowPerYearInterestRateBase,
    borrowPerYearInterestRateSlopeLow,
    borrowPerYearInterestRateSlopeHigh,
    storeFrontPriceFactor,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs: Object.entries(assets).reduce((acc, [symbol, config], _i) => {
      if (symbol != base) {
        acc.push({
          asset: tokens[symbol].address,
          priceFeed: priceFeeds[symbol].address,
          decimals: dfn(assets[symbol].decimals, 18),
          borrowCollateralFactor: dfn(config.borrowCF, ONE - 1n),
          liquidateCollateralFactor: dfn(config.liquidateCF, ONE),
          liquidationFactor: dfn(config.liquidationFactor, ONE),
          supplyCap: dfn(config.supplyCap, exp(100, dfn(config.decimals, 18))),
        });
      }
      return acc;
    }, []),
  };

  // Deploy Configurator proxy
  const initializeCalldata = (await configurator.populateTransaction.initialize(governor.address)).data;
  const ConfiguratorProxy = (await ethers.getContractFactory('ConfiguratorProxy')) as ConfiguratorProxy__factory;
  const configuratorProxy = await ConfiguratorProxy.deploy(
    configurator.address,
    proxyAdmin.address,
    initializeCalldata,
  );
  await configuratorProxy.deployed();

  // Set the initial factory and configuration for Comet in Configurator
  const configuratorAsProxy = configurator.attach(configuratorProxy.address);
  await configuratorAsProxy.setConfiguration(cometProxy.address, configuration);
  await configuratorAsProxy.setFactory(cometProxy.address, cometFactory.address);

  return {
    opts,
    governor,
    pauseGuardian,
    extensionDelegate,
    users,
    base,
    reward,
    proxyAdmin,
    comet,
    cometProxy,
    configurator,
    configuratorProxy,
    cometFactory,
    tokens,
    unsupportedToken,
    priceFeeds,
  };
}

export async function makeRewards(opts: RewardsOpts = {}): Promise<Rewards> {
  const signers = await ethers.getSigners();

  const governor = opts.governor || signers[0];
  const configs = opts.configs || [];

  const RewardsFactory = (await ethers.getContractFactory('CometRewards')) as CometRewards__factory;
  const rewards = await RewardsFactory.deploy(governor.address);
  await rewards.deployed();

  for (const [comet, token, multiplier] of configs) {
    if (multiplier === undefined) await wait(rewards.setRewardConfig(comet.address, token.address));
    else await wait(rewards.setRewardConfigWithMultiplier(comet.address, token.address, multiplier));
  }

  return {
    opts,
    governor,
    rewards
  };
}

export async function makeBulker(opts: BulkerOpts): Promise<BulkerInfo> {
  const signers = await ethers.getSigners();

  const admin = opts.admin || signers[0];
  const weth = opts.weth;

  const BulkerFactory = (await ethers.getContractFactory('BaseBulker')) as BaseBulker__factory;
  const bulker = await BulkerFactory.deploy(admin.address, weth);
  await bulker.deployed();

  return {
    opts,
    bulker
  };
}
export async function bumpTotalsCollateral(comet: CometHarnessInterface, token: FaucetToken | NonStandardFaucetFeeToken, delta: bigint): Promise<TotalsCollateralStructOutput> {
  const t0 = await comet.totalsCollateral(token.address);
  const t1 = Object.assign({}, t0, { totalSupplyAsset: t0.totalSupplyAsset.toBigInt() + delta });
  await token.allocateTo(comet.address, delta);
  await wait(comet.setTotalsCollateral(token.address, t1));
  return t1;
}

export async function setTotalsBasic(comet: CometHarnessInterface, overrides = {}): Promise<TotalsBasicStructOutput> {
  const t0 = await comet.totalsBasic();
  const t1 = Object.assign({}, t0, overrides);
  await wait(comet.setTotalsBasic(t1));
  return t1;
}

export function objectify(arrayObject) {
  const obj = {};
  for (const key in arrayObject) {
    if (isNaN(Number(key))) {
      const value = arrayObject[key];
      if (value._isBigNumber) {
        obj[key] = BigInt(value);
      } else {
        obj[key] = value;
      }
    }
  }
  return obj;
}

export async function baseBalanceOf(comet: CometInterface, account: string): Promise<bigint> {
  const balanceOf = await comet.balanceOf(account);
  const borrowBalanceOf = await comet.borrowBalanceOf(account);
  return balanceOf.sub(borrowBalanceOf).toBigInt();
}

type Portfolio = {
  internal: {
    [symbol: string]: bigint;
  };
  external: {
    [symbol: string]: bigint;
  };
}

type TotalsAndReserves = {
  totals: {
    [symbol: string]: bigint;
  };
  reserves: {
    [symbol: string]: bigint;
  };
}

export async function portfolio({ comet, base, tokens }, account): Promise<Portfolio> {
  const internal = { [base]: await baseBalanceOf(comet, account) };
  const external = { [base]: BigInt(await tokens[base].balanceOf(account)) };
  for (const symbol in tokens) {
    if (symbol != base) {
      internal[symbol] = BigInt(await comet.collateralBalanceOf(account, tokens[symbol].address));
      external[symbol] = BigInt(await tokens[symbol].balanceOf(account));
    }
  }
  return { internal, external };
}

export async function totalsAndReserves({ comet, base, tokens }): Promise<TotalsAndReserves> {
  const totals = { [base]: BigInt((await comet.totalsBasic()).totalSupplyBase) };
  const reserves = { [base]: BigInt(await comet.getReserves()) };
  for (const symbol in tokens) {
    if (symbol != base) {
      totals[symbol] = BigInt((await comet.totalsCollateral(tokens[symbol].address)).totalSupplyAsset);
      reserves[symbol] = BigInt(await comet.getCollateralReserves(tokens[symbol].address));
    }
  }
  return { totals, reserves };
}

export interface TransactionResponseExt extends TransactionResponse {
  receipt: TransactionReceipt;
}

export async function wait(
  tx: TransactionResponse | Promise<TransactionResponse>
): Promise<TransactionResponseExt> {
  const tx_ = await tx;
  let receipt = await tx_.wait();
  return {
    ...tx_,
    receipt,
  };
}

export function event(tx, index) {
  const ev = tx.receipt.events[index], args = {};
  for (const k in ev.args) {
    const v = ev.args[k];
    if (isNaN(Number(k))) {
      if (v._isBigNumber) {
        args[k] = BigInt(v);
      } else if (Array.isArray(v)) {
        args[k] = convertToBigInt(v);
      } else {
        args[k] = v;
      }
    }
  }
  return { [ev.event]: args };
}

// Convert all BigNumbers in an array into BigInts
function convertToBigInt(arr) {
  const newArr = [];
  for (const v of arr) {
    if (Array.isArray(v)) {
      newArr.push(convertToBigInt(v));
    } else {
      newArr.push(v._isBigNumber ? BigInt(v) : v);
    }
  }
  return newArr;
}

export function getGasUsed(tx: TransactionResponseExt): bigint {
  return tx.receipt.gasUsed.mul(tx.receipt.effectiveGasPrice).toBigInt();
}
