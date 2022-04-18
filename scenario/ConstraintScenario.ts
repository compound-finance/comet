import { scenario } from './context/CometContext';
import { expectApproximately } from './utils';
import { defactor, expect } from '../test/helpers';

scenario(
  'Comet#constraint > collateral CometBalanceConstraint + BalanceConstraint both satisfied',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const { asset: asset0Address, scale } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(scale.toBigInt() * 100n);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(scale.mul(100));
  }
);

scenario(
  'Comet#constraint > base CometBalanceConstraint + BalanceConstraint both satisfied',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(100n * scale);
    expect(await albert.getCometBaseBalance()).to.be.equal(100n * scale);
  }
);

scenario(
  'Comet#constraint > negative comet base balance (borrow position)',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $base: -100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, _world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(100n * scale);
    expectApproximately(
      await albert.getCometBaseBalance(),
      -100n * scale,
      (scale / 1000n) // .001 units of asset
    );
  }
);

scenario(
  'UtilizationConstraint > sets utilization to 25%',
  { utilization: 0.25 },
  async ({ comet }) => {
    expect(defactor(await comet.getUtilization())).to.approximately(0.25, 0.000001);
  }
);

scenario(
  'UtilizationConstraint > sets utilization to 50%',
  { utilization: 0.50 },
  async ({ comet }) => {
    expect(defactor(await comet.getUtilization())).to.approximately(0.5, 0.000001);
  }
);

scenario(
  'UtilizationConstraint > sets utilization to 75%',
  { utilization: 0.75 },
  async ({ comet }) => {
    expect(defactor(await comet.getUtilization())).to.approximately(0.75, 0.000001);
  }
);

scenario(
  'UtilizationConstraint > sets utilization to 100%',
  { utilization: 1 },
  async ({ comet }) => {
    expect(defactor(await comet.getUtilization())).to.approximately(1, 0.000001);
  }
);

// XXX enable scenario; fails on test nets currently
scenario.skip(
  'UtilizationConstraint > works in combination with other constraints',
  {
    cometBalances: {
      albert: { $base: -100 },
    },
    utilization: 1
  },
  async ({ comet }) => {
    expect(defactor(await comet.getUtilization())).to.approximately(1, 0.000001);
  }
);