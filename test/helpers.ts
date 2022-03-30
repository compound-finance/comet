import hre from 'hardhat';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Block } from '@ethersproject/abstract-provider';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import {
  CometExt,
  CometExt__factory,
  CometHarness,
  CometHarness__factory,
  CometHarnessInterface as Comet,
  EvilToken,
  EvilToken__factory,
  FaucetToken,
  FaucetToken__factory,
  SimplePriceFeed,
  SimplePriceFeed__factory,
  TransparentUpgradeableProxy,
  TransparentUpgradeableProxy__factory,
  TransparentUpgradeableConfiguratorProxy,
  TransparentUpgradeableConfiguratorProxy__factory,
  CometProxyAdmin,
  CometProxyAdmin__factory,
  CometFactory,
  CometFactory__factory,
  Configurator,
  Configurator__factory,
} from '../build/types';
import { BigNumber } from 'ethers';
import { TransactionReceipt, TransactionResponse } from '@ethersproject/abstract-provider';

export { Comet, ethers, expect };

export type Numeric = number | bigint;

export enum ReentryAttack {
  TransferFrom = 0,
  WithdrawFrom = 1
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
      factory?: FaucetToken__factory | EvilToken__factory;
    };
  };
  symbol?: string,
  governor?: SignerWithAddress;
  pauseGuardian?: SignerWithAddress;
  extensionDelegate?: CometExt;
  base?: string;
  reward?: string;
  kink?: Numeric;
  interestRateBase?: Numeric;
  interestRateSlopeLow?: Numeric;
  interestRateSlopeHigh?: Numeric;
  reserveRate?: Numeric;
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
    [symbol: string]: FaucetToken;
  };
  unsupportedToken: FaucetToken;
  priceFeeds: {
    [symbol: string]: SimplePriceFeed;
  };
};

export type ConfiguratorAndProtocol = {
  governor: SignerWithAddress,
  configurator: Configurator,
  configuratorProxy: TransparentUpgradeableConfiguratorProxy,
  proxyAdmin: CometProxyAdmin,
  cometFactory: CometFactory,
  comet: Comet,
  cometProxy: TransparentUpgradeableProxy,
  tokens: {
    [symbol: string]: FaucetToken;
  },
  users: SignerWithAddress[]
}

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

export function defaultAssets(overrides = {}) {
  return {
    COMP: Object.assign({
      initial: 1e7,
      decimals: 18,
      initialPrice: 175,
    }, overrides),
    USDC: Object.assign({
      initial: 1e6,
      decimals: 6,
    }, overrides),
    WETH: Object.assign({
      initial: 1e4,
      decimals: 18,
      initialPrice: 3000,
    }, overrides),
    WBTC: Object.assign({
      initial: 1e3,
      decimals: 8,
      initialPrice: 41000,
    }, overrides),
  };
}

export const factorDecimals = 18;
export const factorScale = factor(1);
export const ONE = factorScale;
export const ZERO = factor(0);

export async function getBlock(n?: number): Promise<Block> {
  const blockNumber = n === undefined ? await ethers.provider.getBlockNumber() : n;
  return ethers.provider.getBlock(blockNumber);
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

  const symbol32 = ethers.utils.formatBytes32String((opts.symbol || '📈BASE'));
  const governor = opts.governor || signers[0];
  const pauseGuardian = opts.pauseGuardian || signers[1];
  const users = signers.slice(2); // guaranteed to not be governor or pause guardian
  const base = opts.base || 'USDC';
  const reward = opts.reward || 'COMP';
  const kink = dfn(opts.kink, exp(0.8, 18));
  const perYearInterestRateBase = dfn(opts.interestRateBase, exp(0.005, 18));
  const perYearInterestRateSlopeLow = dfn(opts.interestRateSlopeLow, exp(0.1, 18));
  const perYearInterestRateSlopeHigh = dfn(opts.interestRateSlopeHigh, exp(3, 18));
  const reserveRate = dfn(opts.reserveRate, exp(0.1, 18));
  const storeFrontPriceFactor = dfn(opts.storeFrontPriceFactor, exp(0.97, 18));
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
    extensionDelegate = await CometExtFactory.deploy({ symbol32 });
    await extensionDelegate.deployed();
  }

  const CometFactory = (await ethers.getContractFactory('CometHarness')) as CometHarness__factory;
  const comet = await CometFactory.deploy({
    governor: governor.address,
    pauseGuardian: pauseGuardian.address,
    extensionDelegate: extensionDelegate.address,
    baseToken: tokens[base].address,
    baseTokenPriceFeed: priceFeeds[base].address,
    kink,
    perYearInterestRateBase,
    perYearInterestRateSlopeLow,
    perYearInterestRateSlopeHigh,
    reserveRate,
    storeFrontPriceFactor,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs: Object.entries(assets).reduce((acc, [symbol, config], i) => {
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
  const signers = await ethers.getSigners();

  const assets = opts.assets || defaultAssets();
  let priceFeeds = {};
  for (const asset in assets) {
    const PriceFeedFactory = (await ethers.getContractFactory(
      'SimplePriceFeed'
    )) as SimplePriceFeed__factory;
    const initialPrice = exp(assets[asset].initialPrice || 1, 8);
    const priceFeedDecimals = assets[asset].priceFeedDecimals || 8;
    const priceFeed = await PriceFeedFactory.deploy(initialPrice, priceFeedDecimals);
    await priceFeed.deployed();
    priceFeeds[asset] = priceFeed;
  }

  const governor = opts.governor || signers[0];
  const pauseGuardian = opts.pauseGuardian || signers[1];
  const users = signers.slice(2); // guaranteed to not be governor or pause guardian
  const base = opts.base || 'USDC';
  const reward = opts.reward || 'COMP';
  const kink = dfn(opts.kink, exp(0.8, 18));
  const perYearInterestRateBase = dfn(opts.interestRateBase, exp(0.005, 18));
  const perYearInterestRateSlopeLow = dfn(opts.interestRateSlopeLow, exp(0.1, 18));
  const perYearInterestRateSlopeHigh = dfn(opts.interestRateSlopeHigh, exp(3, 18));
  const reserveRate = dfn(opts.reserveRate, exp(0.1, 18));
  const storeFrontPriceFactor = dfn(opts.storeFrontPriceFactor, exp(0.97, 18));
  const trackingIndexScale = opts.trackingIndexScale || exp(1, 15);
  const baseTrackingSupplySpeed = dfn(opts.baseTrackingSupplySpeed, trackingIndexScale);
  const baseTrackingBorrowSpeed = dfn(opts.baseTrackingBorrowSpeed, trackingIndexScale);
  const baseMinForRewards = dfn(opts.baseMinForRewards, exp(1, assets[base].decimals));
  const baseBorrowMin = dfn(opts.baseBorrowMin, exp(1, assets[base].decimals));
  const targetReserves = dfn(opts.targetReserves, 0);

  const { tokens, comet, extensionDelegate } = await makeProtocol(opts);

  if (opts.start) await ethers.provider.send('evm_setNextBlockTimestamp', [opts.start]);

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
    kink,
    perYearInterestRateBase,
    perYearInterestRateSlopeLow,
    perYearInterestRateSlopeHigh,
    reserveRate,
    storeFrontPriceFactor,
    trackingIndexScale,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    baseMinForRewards,
    baseBorrowMin,
    targetReserves,
    assetConfigs: Object.entries(assets).reduce((acc, [symbol, config], i) => {
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

  // Deploy ProxyAdmin
  const ProxyAdmin = (await ethers.getContractFactory('CometProxyAdmin')) as CometProxyAdmin__factory;
  const proxyAdmin = await ProxyAdmin.connect(governor).deploy();
  await proxyAdmin.deployed();

  // Deploy Configurator proxy
  const ConfiguratorProxy = (await ethers.getContractFactory('TransparentUpgradeableConfiguratorProxy')) as TransparentUpgradeableConfiguratorProxy__factory;
  const configuratorProxy = await ConfiguratorProxy.deploy(
    configurator.address,
    proxyAdmin.address,
    (await configurator.populateTransaction.initialize(governor.address, cometFactory.address, configuration)).data,
  );
  await configuratorProxy.deployed();

  // Deploy Comet proxy
  const CometProxy = (await ethers.getContractFactory('TransparentUpgradeableProxy')) as TransparentUpgradeableProxy__factory;
  const cometProxy = await CometProxy.deploy(
    comet.address,
    proxyAdmin.address,
    (await comet.populateTransaction.initializeStorage()).data,
  );
  await configuratorProxy.deployed();

  return {
    governor,
    proxyAdmin,
    comet,
    cometProxy,
    configurator,
    configuratorProxy,
    cometFactory,
    tokens,
    users
  };
}

export async function portfolio({ comet, base, tokens }, account) {
  const internal = { [base]: BigInt(await comet.baseBalanceOf(account)) };
  const external = { [base]: BigInt(await tokens[base].balanceOf(account)) };
  for (const symbol in tokens) {
    if (symbol != base) {
      internal[symbol] = BigInt(await comet.collateralBalanceOf(account, tokens[symbol].address));
      external[symbol] = BigInt(await tokens[symbol].balanceOf(account));
    }
  }
  return { internal, external };
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
      args[k] = v._isBigNumber ? BigInt(v) : v;
    }
  }
  return { [ev.event]: args };
}

export function inCoverage() {
  return hre['__SOLIDITY_COVERAGE_RUNNING'];
}
