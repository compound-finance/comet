import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { expectApproximately, getExpectedBaseBalance, getInterest } from './utils';

// XXX consider creating these tests for assets0-15
scenario(
  'Comet#supply > base asset',
  {
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(100n * scale);

    // Albert supplies 100 units of base to Comet
    await baseAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: baseAsset.address, amount: 100n * scale })

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(100n * scale, baseIndexScale, baseSupplyIndex);

    expect(await comet.balanceOf(albert.address)).to.be.equal(baseSupplied);

    return txn; // return txn to measure gas
  }
);

// XXX introduce a SupplyCapConstraint to separately test the happy path and revert path instead
// of testing them conditionally
scenario(
  'Comet#supply > collateral asset',
  {
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const { asset: asset0Address, scale: scaleBN, supplyCap } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();
    const toSupply = 100n * scale;

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(toSupply);

    await collateralAsset.approve(albert, comet.address);

    const totalCollateralSupply = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset.toBigInt();
    if (totalCollateralSupply + toSupply > supplyCap.toBigInt()) {
      await expect(
        albert.supplyAsset({
          asset: collateralAsset.address,
          amount: 100n * scale,
        })
      ).to.be.revertedWith("custom error 'SupplyCapExceeded()'");
    } else {
      // Albert supplies 100 units of collateral to Comet
      const txn = await albert.supplyAsset({ asset: collateralAsset.address, amount: toSupply })

      expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(toSupply);

      return txn; // return txn to measure gas
    }
  }
);

scenario(
  'Comet#supply > repay borrow',
  {
    tokenBalances: {
      albert: { $base: 1000 }
    },
    cometBalances: {
      albert: { $base: -1000 } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    expectApproximately(await albert.getCometBaseBalance(), -1000n * scale, getInterest(1000n * scale, borrowRate, 1n) + 1n);

    // Albert repays 100 units of base borrow
    await baseAsset.approve(albert, comet.address);
    const txn = await albert.supplyAsset({ asset: baseAsset.address, amount: 1000n * scale });

    // XXX all these timings are crazy
    expectApproximately(await albert.getCometBaseBalance(), 0n, getInterest(1000n * scale, borrowRate, 4n) + 2n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supplyFrom > base asset',
  {
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
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

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(100n * scale, baseIndexScale, baseSupplyIndex);

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.balanceOf(betty.address)).to.be.equal(baseSupplied);

    return txn; // return txn to measure gas
  }
);

// XXX introduce a SupplyCapConstraint to separately test the happy path and revert path instead
// of testing them conditionally
scenario(
  'Comet#supplyFrom > collateral asset',
  {
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale: scaleBN, supplyCap } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();
    const toSupply = 100n * scale;

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(toSupply);
    expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(0n);

    await collateralAsset.approve(albert, comet.address);
    await albert.allow(betty, true);

    const totalCollateralSupply = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset.toBigInt();
    if (totalCollateralSupply + toSupply > supplyCap.toBigInt()) {
      await expect(
        betty.supplyAssetFrom({
          src: albert.address,
          dst: betty.address,
          asset: collateralAsset.address,
          amount: toSupply,
        })
      ).to.be.revertedWith("custom error 'SupplyCapExceeded()'");
    } else {
      // Betty supplies 100 units of collateral from Albert
      const txn = await betty.supplyAssetFrom({ src: albert.address, dst: betty.address, asset: collateralAsset.address, amount: toSupply });

      expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(0n);
      expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(toSupply);

      return txn; // return txn to measure gas
    }
  }
);

scenario(
  'Comet#supplyFrom > repay borrow',
  {
    tokenBalances: {
      albert: { $base: 1000 }
    },
    cometBalances: {
      betty: { $base: -1000 } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(1000n * scale);
    expectApproximately(await betty.getCometBaseBalance(), -1000n * scale, getInterest(1000n * scale, borrowRate, 1n) + 1n);

    await baseAsset.approve(albert, comet.address);
    await albert.allow(betty, true);

    // Betty supplies 100 units of base from Albert to repay borrows
    const txn = await betty.supplyAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: 1000n * scale });

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    // XXX all these timings are crazy
    expectApproximately(await betty.getCometBaseBalance(), 0n, getInterest(1000n * scale, borrowRate, 8n) + 2n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#supply reverts if not enough ERC20 approval',
  {
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
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

scenario(
  'Comet#supplyFrom reverts if not enough ERC20 approval',
  {
    tokenBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await albert.allow(betty, true);
    await baseAsset.approve(albert, betty, 10n * scale);

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
    tokenBalances: {
      albert: { $base: 10 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
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

scenario(
  'Comet#supplyFrom reverts if not enough ERC20 balance',
  {
    tokenBalances: {
      albert: { $base: 10 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
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
    tokenBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
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
  {},
  async ({ comet, actors }) => {
    // XXX requires deploying an unsupported asset (maybe via remote token constraint)
  }
);

// XXX enforce supply cap