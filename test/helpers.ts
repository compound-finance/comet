import { expect } from 'chai';
import { ethers } from 'hardhat';
import { Signer } from 'ethers';
import {
  CometHarness as Comet,
  CometHarness__factory as Comet__factory,
  FaucetToken,
  FaucetToken__factory,
  MockedOracle,
  MockedOracle__factory,
} from '../build/types';

export { Comet, ethers, expect, Signer };

export type Numeric = number | bigint;

export type ProtocolOpts = {
  assets?: {
    [symbol: string]: {
      name?: string;
      initial?: Numeric;
      decimals?: Numeric;
    };
  };
  admin?: Signer;
  pauseGuardian?: Signer;
  base?: string;
  reward?: string;
  trackingIndexScale?: Numeric;
  baseMinForRewards?: Numeric;
  baseTrackingSupplySpeed?: Numeric;
  baseTrackingBorrowSpeed?: Numeric;
};

export type Protocol = {
  opts: ProtocolOpts;
  admin: Signer;
  comet: Comet;
  oracle: MockedOracle;
  tokens: {
    [symbol: string]: FaucetToken;
  };
};

export function dfn(x, dflt) {
  return x == undefined ? dflt : x;
}

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

export async function makeProtocol(opts: ProtocolOpts = {}) {
  const signers = await ethers.getSigners();
  const assets = opts.assets || {
    COMP: { initial: 1e7, decimals: 18 },
    USDC: { initial: 1e6, decimals: 6 },
    WETH: { initial: 1e4, decimals: 18 },
    WBTC: { initial: 1e3, decimals: 8 },
  };
  const admin = opts.admin || signers[0];
  const pauseGuardian = opts.pauseGuardian || signers[1];
  const base = opts.base || 'USDC';
  const reward = opts.reward || 'COMP';
  const trackingIndexScale = opts.trackingIndexScale || exp(1, 15);
  const baseMinForRewards = dfn(opts.baseMinForRewards, exp(1, assets[base].decimals));
  const baseTrackingSupplySpeed = dfn(opts.baseTrackingSupplySpeed, trackingIndexScale);
  const baseTrackingBorrowSpeed = dfn(opts.baseTrackingBorrowSpeed, trackingIndexScale);

  const tokens = {};
  for (const symbol in assets) {
    const config = assets[symbol];
    const decimals = config.decimals || 18;
    const initial = config.initial || 1e6;
    const name = config.name || symbol;
    const FaucetFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
    const token = (tokens[symbol] = await FaucetFactory.deploy(initial, name, decimals, symbol));
    await token.deployed();
  }

  const OracleFactory = (await ethers.getContractFactory('MockedOracle')) as MockedOracle__factory;
  const oracle = await OracleFactory.deploy();
  await oracle.deployed();

  const CometFactory = (await ethers.getContractFactory('CometHarness')) as Comet__factory;
  const comet = await CometFactory.deploy({
    governor: await admin.getAddress(),
    pauseGuardian: await pauseGuardian.getAddress(),
    priceOracle: oracle.address,
    baseToken: tokens[base].address,
    trackingIndexScale,
    baseMinForRewards,
    baseTrackingSupplySpeed,
    baseTrackingBorrowSpeed,
    assetInfo: [ // XXX support more assets in Comet; allow setting collateral factors (easy)
      { asset: tokens[base].address, borrowCollateralFactor: exp(1, 18), liquidateCollateralFactor: exp(1, 18) },
      { asset: tokens[reward].address, borrowCollateralFactor: exp(1, 18), liquidateCollateralFactor: exp(1, 18) },
    ]
  });
  await comet.deployed();

  return { opts, admin, comet, oracle, tokens };
}

export async function wait(tx) {
  const tx_ = await tx;
  tx_.receipt = await (tx_).wait();
  return tx_;
}
