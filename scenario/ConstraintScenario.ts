import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario.only(
  'Comet#constraint > collateral CometBalanceConstraint + BalanceConstraint both satisfied',
  {
    upgrade: true,
    balances: {
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

scenario.only(
  'Comet#constraint > base CometBalanceConstraint + BalanceConstraint both satisfied',
  {
    upgrade: true,
    balances: {
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
    const scale = await comet.baseScale();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(scale.toBigInt() * 100n);
    expect(await comet.baseBalanceOf(albert.address)).to.be.equal(scale.mul(100));
  }
);


// Expect this fail since collateral balance cannot be negative
scenario(
  'Comet#constraint > negative comet collateral balance (borrow position)',
  {
    upgrade: true,    
    balances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $asset0: -100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const { asset: asset0Address, scale } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(scale.toBigInt() * 100n);
    expect(await comet.baseBalanceOf(albert.address)).to.be.closeTo(scale.mul(-100), 1);
  }
);

scenario.only(
  'Comet#constraint > negative comet base balance (borrow position)',
  {
    upgrade: true,    
    balances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $base: -100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = await comet.baseScale();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(scale.toBigInt() * 100n);
    expect(await comet.baseBalanceOf(albert.address)).to.be.closeTo(scale.mul(-100), 1);
  }
);