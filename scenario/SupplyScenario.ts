import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { expectApproximately } from './utils';

// XXX consider creating these tests for assets0-15
scenario(
  'Comet#supply > base asset',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(100n * scale);

    // Albert supplies 100 units of base to Comet
    await baseAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: baseAsset.address, amount: 100n * scale })

    expect(await comet.balanceOf(albert.address)).to.be.equal(100n * scale);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supply > collateral asset',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(100n * scale);

    // Albert supplies 100 units of collateral to Comet
    await collateralAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: collateralAsset.address, amount: 100n * scale })

    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(100n * scale);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supply > repay borrow',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 100 }
    },
    cometBalances: {
      albert: { $base: -100 } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 1_000_000n; // 1e-6 asset units of precision

    expectApproximately(await albert.getCometBaseBalance(), -100n * scale, precision);

    // Albert repays 100 units of base borrow
    await baseAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: baseAsset.address, amount: 100n * scale });

    expectApproximately(await albert.getCometBaseBalance(), 0n, precision);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supplyFrom > base asset',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(100n * scale);
    expect(await comet.balanceOf(betty.address)).to.be.equal(0n);

    await baseAsset.approve(albert, comet.address);
    await albert.allow(betty, true);

    // Betty supplies 100 units of base from Albert
    const txn = await betty.supplyAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: 100n * scale });

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.balanceOf(betty.address)).to.be.equal(100n * scale);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supplyFrom > collateral asset',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(100n * scale);
    expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(0n);

    await collateralAsset.approve(albert, comet.address);
    await albert.allow(betty, true);

    // Betty supplies 100 units of collateral from Albert
    const txn = await betty.supplyAssetFrom({ src: albert.address, dst: betty.address, asset: collateralAsset.address, amount: 100n * scale });

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(100n * scale);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supplyFrom > repay borrow',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 100 }
    },
    cometBalances: {
      betty: { $base: -100 } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 1_000_000n; // 1e-6 asset units of precision

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(100n * scale);
    expectApproximately(await betty.getCometBaseBalance(), -100n * scale, precision);

    await baseAsset.approve(albert, comet.address);
    await albert.allow(betty, true);

    // Betty supplies 100 units of base from Albert to repay borrows
    const txn = await betty.supplyAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: 100n * scale });

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expectApproximately(await betty.getCometBaseBalance(), 0n, precision);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supply reverts if not enough ERC20 approval',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await expect(
      albert.supplyAsset({
        asset: baseAsset.address,
        amount: 100n * scale,
      })
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
  }
);

// XXX fix for development base, where Faucet token doesn't give the same revert message
scenario.skip(
  'Comet#supplyFrom reverts if not enough ERC20 approval',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await expect(
      betty.supplyAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: 100n * scale,
      })
    ).to.be.revertedWith("ERC20: transfer amount exceeds allowance");
  }
);

scenario(
  'Comet#supply reverts if not enough ERC20 balance',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 10 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await baseAsset.approve(albert, comet.address);
    await expect(
      albert.supplyAsset({
        asset: baseAsset.address,
        amount: 100n * scale,
      })
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
  }
);

// XXX fix for development base, where Faucet token doesn't give the same revert message
scenario.skip(
  'Comet#supplyFrom reverts if not enough ERC20 balance',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $base: 10 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await baseAsset.approve(albert, comet.address);
    await albert.allow(betty, true);
    await expect(
      betty.supplyAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: 100n * scale,
      })
    ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
  }
);

scenario(
  'Comet#supplyFrom reverts if operator not given permission',
  {
    upgrade: true,
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await baseAsset.approve(albert, comet.address);
    await expect(
      betty.supplyAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: 100n * scale,
      })
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  }
);

scenario(
  'Comet#supply reverts when supply is paused',
  {
    upgrade: true,
    pause: {
      supplyPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expect(
      albert.supplyAsset({
        asset: baseToken,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'Paused()'");
  }
);

scenario(
  'Comet#supplyFrom reverts when supply is paused',
  {
    upgrade: true,
    pause: {
        supplyPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expect(
      albert.supplyAssetFrom({
        src: betty.address,
        dst: albert.address,
        asset: baseToken,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'Paused()'");
  }
);

scenario(
  'Comet#supply reverts if asset is not supported',
  {
    upgrade: true,
  },
  async ({ comet, actors }, world, context) => {
    // XXX requires deploying an unsupported asset (maybe via remote token constraint)
  }
);

// XXX enforce supply cap