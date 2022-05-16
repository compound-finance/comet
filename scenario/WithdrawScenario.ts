import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { expectApproximately, getExpectedBaseBalance } from './utils';

// XXX consider creating these tests for assets0-15
scenario(
  'Comet#withdraw > base asset',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(100n * scale, baseIndexScale, baseSupplyIndex);

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.balanceOf(albert.address)).to.be.equal(baseSupplied);

    // Albert withdraws 100 units of base from Comet
    const txn = await albert.withdrawAsset({ asset: baseAsset.address, amount: baseSupplied })

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(baseSupplied);
    expect(await comet.balanceOf(albert.address)).to.be.equal(0n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdraw > collateral asset',
  {
    upgrade: true,
    cometBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(100n * scale);

    // Albert withdraws 100 units of collateral from Comet
    const txn = await albert.withdrawAsset({ asset: collateralAsset.address, amount: 100n * scale })

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(100n * scale);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(0n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdraw > borrow base',
  {
    upgrade: true,
    tokenBalances: {
      $comet: { $base: 1000 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $asset0: 3000 } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 1_000_000n; // 1e-6 asset units of precision

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.balanceOf(albert.address)).to.be.equal(0n);

    // Albert borrows 1 unit of base from Comet
    const txn = await albert.withdrawAsset({ asset: baseAsset.address, amount: 1000n * scale });

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(1000n * scale);
    expectApproximately(await albert.getCometBaseBalance(), -1000n * scale, precision);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawFrom > base asset',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(100n * scale, baseIndexScale, baseSupplyIndex);

    expect(await baseAsset.balanceOf(betty.address)).to.be.equal(0n);
    expect(await comet.balanceOf(albert.address)).to.be.equal(baseSupplied);

    await albert.allow(betty, true);

    // Betty withdraws 100 units of base from Albert
    const txn = await betty.withdrawAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: baseSupplied })

    expect(await baseAsset.balanceOf(betty.address)).to.be.equal(baseSupplied);
    expect(await comet.balanceOf(albert.address)).to.be.equal(0n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawFrom > collateral asset',
  {
    upgrade: true,
    cometBalances: {
      albert: { $asset0: 1000 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    expect(await collateralAsset.balanceOf(betty.address)).to.be.equal(0n);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(1000n * scale);

    await albert.allow(betty, true);

    // Betty withdraws 1000 units of collateral from Albert
    const txn = await betty.withdrawAssetFrom({ src: albert.address, dst: betty.address, asset: collateralAsset.address, amount: 1000n * scale })

    expect(await collateralAsset.balanceOf(betty.address)).to.be.equal(1000n * scale);
    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(0n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawFrom > borrow base',
  {
    upgrade: true,
    tokenBalances: {
      $comet: { $base: 1000 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $asset0: 3000 } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 1_000_000n; // 1e-6 asset units of precision

    expect(await baseAsset.balanceOf(betty.address)).to.be.equal(0n);
    expect(await comet.balanceOf(albert.address)).to.be.equal(0n);

    await albert.allow(betty, true);

    // Betty borrows 1 unit of base using Albert's account
    const txn = await betty.withdrawAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: 1000n * scale });

    expect(await baseAsset.balanceOf(betty.address)).to.be.equal(1000n * scale);
    expectApproximately(await albert.getCometBaseBalance(), -1000n * scale, precision);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawFrom reverts if operator not given permission',
  {
    upgrade: true,
    tokenBalances: {
      $comet: { $base: 100 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $asset0: 100 } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    // Betty borrows 1 unit of base using Albert's account
    await expect(
      betty.withdrawAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: 1n * scale,
      })
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  }
);

scenario(
  'Comet#withdraw reverts when withdraw is paused',
  {
    upgrade: true,
    pause: {
      withdrawPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expect(
      albert.withdrawAsset({
        asset: baseToken,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'Paused()'");
  }
);

scenario(
  'Comet#withdrawFrom reverts when withdraw is paused',
  {
    upgrade: true,
    pause: {
        withdrawPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expect(
      albert.withdrawAssetFrom({
        src: betty.address,
        dst: albert.address,
        asset: baseToken,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'Paused()'");
  }
);

scenario(
  'Comet#withdraw base reverts if position is undercollateralized',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 0 }, // in units of asset, not wei
      charles: { $base: 1000 }, // to give the protocol enough base for others to borrow from
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await expect(
      albert.withdrawAsset({
        asset: baseAsset.address,
        amount: 1000n * scale,
      })
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
  }
);

scenario(
  'Comet#withdraw collateral reverts if position is undercollateralized',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: -1000, $asset0: 1000 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    await expect(
      albert.withdrawAsset({
        asset: collateralAsset.address,
        amount: 1000n * scale
      })
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
  }
);

scenario(
  'Comet#withdraw reverts if borrow is less than minimum borrow',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 0, $asset0: 100 }
    }
  },
  async ({ comet, actors }, world, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const minBorrow = (await comet.baseBorrowMin()).toBigInt();

    await expect(
      albert.withdrawAsset({
        asset: baseAsset.address,
        amount: minBorrow / 2n
      })
    ).to.be.revertedWith("custom error 'BorrowTooSmall()'");
  }
);

scenario.skip(
  'Comet#withdraw reverts if asset is not supported',
  {
    upgrade: true,
  },
  async ({ comet, actors }, world, context) => {
    // XXX requires deploying an unsupported asset (maybe via remote token constraint)
  }
);

scenario.skip(
  'Comet#withdraw reverts if not enough asset in protocol',
  {
    upgrade: true,
  },
  async ({ comet, actors }, world, context) => {
    // XXX fix for development base, where Faucet token doesn't give the same revert message
  }
);