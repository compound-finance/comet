import { scenario } from './context/CometContext';
import { expectApproximately, getExpectedBaseBalance, getInterest } from './utils';
import { defactor, expect } from '../test/helpers';

scenario(
  'Comet#constraint > collateral CometBalanceConstraint + BalanceConstraint both satisfied',
  {
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
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
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(100n * scale, baseIndexScale, baseSupplyIndex);

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(100n * scale);
    expect(await albert.getCometBaseBalance()).to.be.equal(baseSupplied);
  }
);

scenario(
  'Comet#constraint > negative comet base balance (borrow position)',
  {
    tokenBalances: {
      albert: { $base: ' == 1000' }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $base: -1000 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(1000n * scale);
    expectApproximately(
      await albert.getCometBaseBalance(),
      -1000n * scale,
      getInterest(1000n * scale, borrowRate, 1n) + 1n
    );
  }
);

scenario(
  'UtilizationConstraint > sets utilization to 25%',
  {
    utilization: 0.25,
  },
  async ({ comet }) => {
    expect(defactor(await comet.getUtilization())).to.approximately(0.25, 0.00001);
  }
);

scenario(
  'UtilizationConstraint > sets utilization to 50%',
  {
    utilization: 0.50,
  },
  async ({ comet }) => {
    expect(defactor(await comet.getUtilization())).to.approximately(0.5, 0.00001);
  }
);

scenario(
  'UtilizationConstraint > sets utilization to 75%',
  {
    utilization: 0.75,
  },
  async ({ comet }) => {
    expect(defactor(await comet.getUtilization())).to.approximately(0.75, 0.00001);
  }
);

// XXX not enough base asset exists in the Kovan protocol to borrow up to 100% utilization;
//     utilization constraint should also source tokens to the protocol if needed
scenario.skip(
  'UtilizationConstraint > sets utilization to 100%',
  {
    utilization: 1,
  },
  async ({ comet }) => {
    expect(defactor(await comet.getUtilization())).to.approximately(1, 0.00001);
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
    expect(defactor(await comet.getUtilization())).to.approximately(1, 0.00001);
  }
);