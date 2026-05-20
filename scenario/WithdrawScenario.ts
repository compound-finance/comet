import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';
import { expectApproximately, expectRevertCustom, hasMinBorrowGreaterThanOne, isTriviallySourceable, isValidAssetIndex, MAX_ASSETS, fundAccount, usesAssetList, isAssetDelisted, supportsExtendedPause } from './utils';
import { ContractReceipt } from 'ethers';
import { getConfigForScenario } from './utils/scenarioHelper';
import { log } from 'console';

async function testWithdrawCollateral(context: CometContext, assetNum: number): Promise<void | ContractReceipt> {
  const comet = await context.getComet();
  const { albert } = context.actors;
  const { asset: assetAddress, scale: scaleBN } = await comet.getAssetInfo(assetNum);
  const collateralAsset = context.getAssetByAddress(assetAddress);
  const scale = scaleBN.toBigInt();

  expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(0n);
  expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(BigInt(getConfigForScenario(context, assetNum).withdrawCollateral) * scale);

  // Albert withdraws 100 units of collateral from Comet
  const txn = await albert.withdrawAsset({ asset: collateralAsset.address, amount: BigInt(getConfigForScenario(context, assetNum).withdrawCollateral) * scale });

  expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(BigInt(getConfigForScenario(context, assetNum).withdrawCollateral) * scale);
  expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(0n);

  return txn; // return txn to measure gas
}

async function testWithdrawFromCollateral(context: CometContext, assetNum: number): Promise<void | ContractReceipt> {
  const comet = await context.getComet();
  const { albert, betty } = context.actors;
  const { asset: assetAddress, scale: scaleBN } = await comet.getAssetInfo(assetNum);
  const collateralAsset = context.getAssetByAddress(assetAddress);
  const scale = scaleBN.toBigInt();

  expect(await collateralAsset.balanceOf(betty.address)).to.be.equal(0n);
  expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(BigInt(getConfigForScenario(context, assetNum).withdrawCollateral) * scale);

  await albert.allow(betty, true);

  // Betty withdraws 1000 units of collateral from Albert
  const txn = await betty.withdrawAssetFrom({ src: albert.address, dst: betty.address, asset: collateralAsset.address, amount: BigInt(getConfigForScenario(context, assetNum).withdrawCollateral) * scale });

  expect(await collateralAsset.balanceOf(betty.address)).to.be.equal(BigInt(getConfigForScenario(context, assetNum).withdrawCollateral) * scale);
  expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(0n);

  return txn; // return txn to measure gas
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#withdraw > collateral asset ${i}`,
    {
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).withdrawCollateral),
      cometBalances: async (ctx) =>  (
        {
          albert: { [`$asset${i}`]: getConfigForScenario(ctx, i).withdrawCollateral }
        }
      ),
    },
    async (_properties, context) => {
      return await testWithdrawCollateral(context, i);
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#withdrawFrom > collateral asset ${i}`,
    {
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).withdrawCollateral),
      cometBalances: async (ctx) =>  (
        {
          albert: { [`$asset${i}`]: getConfigForScenario(ctx, i).withdrawCollateral }
        }
      ),
    },
    async (_properties, context) => {
      return await testWithdrawFromCollateral(context, i);
    }
  );
}

scenario(
  'Comet#withdraw > base asset',
  {
    tokenBalances: {
      albert: { $base: '== 0' },
    },
    cometBalances: {
      albert: { $base: 2 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseSupplied = (await comet.balanceOf(albert.address)).toBigInt();

    // Albert withdraws supplied units of base from Comet
    const txn = await albert.withdrawAsset({ asset: baseAsset.address, amount: baseSupplied });

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(baseSupplied);
    expect(await comet.balanceOf(albert.address)).to.be.lessThan(baseSupplied / 100n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdraw > borrow base',
  {
    tokenBalances: async (ctx) => (
      {
        albert: { $base: '== 0' },
        $comet: { $base: getConfigForScenario(ctx).withdrawBase }, // in units of asset, not wei
      }
    ),
    cometBalances: async (ctx) => (
      {
        albert: { $asset0: getConfigForScenario(ctx).withdrawAsset } // in units of asset, not wei
      }
    ),
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 1_000_000n; // 1e-6 asset units of precision

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(0n);
    expect(await comet.balanceOf(albert.address)).to.be.equal(0n);

    // Albert borrows 1000 unit of base from Comet
    const txn = await albert.withdrawAsset({ asset: baseAsset.address, amount: BigInt(getConfigForScenario(context).withdrawBase) * scale });

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(BigInt(getConfigForScenario(context).withdrawBase) * scale);
    expectApproximately(await albert.getCometBaseBalance(), -BigInt(getConfigForScenario(context).withdrawBase) * scale, precision);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawFrom > base asset',
  {
    cometBalances: {
      albert: { $base: 2 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseSupplied = (await comet.balanceOf(albert.address)).toBigInt();

    expect(await baseAsset.balanceOf(betty.address)).to.be.equal(0n);
    expect(await comet.balanceOf(albert.address)).to.be.equal(baseSupplied);

    await albert.allow(betty, true);

    // Betty withdraws supplied units of base from Albert
    const txn = await betty.withdrawAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: baseSupplied });

    expect(await baseAsset.balanceOf(betty.address)).to.be.equal(baseSupplied);
    expect(await comet.balanceOf(albert.address)).to.be.lessThan(baseSupplied / 100n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawFrom > borrow base',
  {
    tokenBalances: async (ctx) => (
      {
        albert: { $base: '== 0' },
        $comet: { $base: getConfigForScenario(ctx).withdrawBase }, // in units of asset, not wei
      }
    ),
    cometBalances: async (ctx) => (
      {
        albert: { $asset0: getConfigForScenario(ctx).withdrawAsset } // in units of asset, not wei
      }
    ),
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 1_000_000n; // 1e-6 asset units of precision

    expect(await baseAsset.balanceOf(betty.address)).to.be.equal(0n);
    expect(await comet.balanceOf(albert.address)).to.be.equal(0n);

    await albert.allow(betty, true);

    // Betty borrows 1000 unit of base using Albert's account
    const txn = await betty.withdrawAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: BigInt(getConfigForScenario(context).withdrawBase) * scale });

    expect(await baseAsset.balanceOf(betty.address)).to.be.equal(BigInt(getConfigForScenario(context).withdrawBase) * scale);
    expectApproximately(await albert.getCometBaseBalance(), -BigInt(getConfigForScenario(context).withdrawBase) * scale, precision);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawFrom reverts if operator not given permission',
  {
    tokenBalances: {
      $comet: { $base: 100 }, // in units of asset, not wei
    },
    cometBalances: {
      albert: { $asset0: 100 } // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    // Betty borrowsRevertCustom 1 unit of base using Albert's account
    await expectRevertCustom(
      betty.withdrawAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: 1n * scale,
      }),
      'Unauthorized()'
    );
  }
);

scenario(
  'Comet#withdraw reverts when withdraw is paused',
  {
    pause: {
      withdrawPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert } = actors;
    const baseToken = await comet.baseToken();

    await expectRevertCustom(
      albert.withdrawAsset({
        asset: baseToken,
        amount: 100,
      }),
      'Paused()'
    );
  }
);

scenario(
  'Comet#withdrawFrom reverts when withdraw is paused',
  {
    pause: {
      withdrawPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expectRevertCustom(
      albert.withdrawAssetFrom({
        src: betty.address,
        dst: albert.address,
        asset: baseToken,
        amount: 100,
      }),
      'Paused()'
    );
  }
);

scenario(
  'Comet#withdraw reverts when collateral withdraw is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) && 
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).withdrawCollateral) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $asset0: getConfigForScenario(ctx).withdrawCollateral }
      }
    ),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, pauseGuardian } = actors;
    const { asset, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const scale = scaleBN.toBigInt();

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause collateral withdraw
    await comet.connect(pauseGuardian.signer).pauseCollateralWithdraw(true);

    await expectRevertCustom(
      albert.withdrawAsset({
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).withdrawCollateral) * scale
      }),
      'CollateralWithdrawPaused()'
    );
  }
);

scenario(
  'Comet#withdrawFrom reverts when collateral withdraw is paused',
  {
    filter: async (ctx: CometContext) => { 
      return await isValidAssetIndex(ctx, 0) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).withdrawCollateral) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $asset0: getConfigForScenario(ctx).withdrawCollateral }
      }
    ),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const { asset, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const scale = scaleBN.toBigInt();


    await albert.allow(betty, true);

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause collateral withdraw
    await comet.connect(pauseGuardian.signer).pauseCollateralWithdraw(true);

    await expectRevertCustom(
      betty.withdrawAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).withdrawCollateral) * scale
      }),
      'CollateralWithdrawPaused()'
    );
  }
);

scenario(
  'Comet#withdraw reverts when borrowers withdraw is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
       await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).withdrawBase) &&
        await usesAssetList(ctx) &&
         !(await isAssetDelisted(ctx, 0)) &&
         await supportsExtendedPause(ctx);
    },
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $base: '== 0' },
        $comet: { $base: getConfigForScenario(ctx).withdrawBase }
      }
    ),
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $asset0: getConfigForScenario(ctx).withdrawAsset }
      }
    ),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause borrowers withdraw
    await comet.connect(pauseGuardian.signer).pauseBorrowersWithdraw(true);

    await expectRevertCustom(
      albert.withdrawAsset({
        asset: baseAsset.address,
        amount: BigInt(getConfigForScenario(context).withdrawBase) * scale
      }),
      'BorrowersWithdrawPaused()'
    );
  }
);

scenario(
  'Comet#withdrawFrom reverts when borrowers withdraw is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
       await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).withdrawBase) &&
        await usesAssetList(ctx) &&
         !(await isAssetDelisted(ctx, 0)) &&
         await supportsExtendedPause(ctx);
    },
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $base: '== 0' },
        $comet: { $base: getConfigForScenario(ctx).withdrawBase }
      }
    ),
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $asset0: getConfigForScenario(ctx).withdrawAsset }
      }
    ),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();


    await albert.allow(betty, true);

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause borrowers withdraw
    await comet.connect(pauseGuardian.signer).pauseBorrowersWithdraw(true);

    await expectRevertCustom(
      betty.withdrawAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: BigInt(getConfigForScenario(context).withdrawBase) * scale
      }),
      'BorrowersWithdrawPaused()'
    );
  }
);

scenario(
  'Comet#withdraw reverts when lenders withdraw is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
       await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).withdrawBase) &&
        await usesAssetList(ctx) &&
         !(await isAssetDelisted(ctx, 0)) &&
         await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $base: getConfigForScenario(ctx).withdrawBase }
      }
    ),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseSupplied = (await comet.balanceOf(albert.address)).toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause lenders withdraw
    await comet.connect(pauseGuardian.signer).pauseLendersWithdraw(true);

    await expectRevertCustom(
      albert.withdrawAsset({
        asset: baseAsset.address,
        amount: baseSupplied
      }),
      'LendersWithdrawPaused()'
    );
  }
);

scenario(
  'Comet#withdrawFrom reverts when lenders withdraw is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
       await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).withdrawBase) &&
        await usesAssetList(ctx) &&
         !(await isAssetDelisted(ctx, 0)) &&
         await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $base: getConfigForScenario(ctx).withdrawBase }
      }
    ),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseSupplied = (await comet.balanceOf(albert.address)).toBigInt();


    await albert.allow(betty, true);

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause lenders withdraw
    await comet.connect(pauseGuardian.signer).pauseLendersWithdraw(true);

    await expectRevertCustom(
      betty.withdrawAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: baseSupplied
      }),
      'LendersWithdrawPaused()'
    );
  }
);

scenario(
  'Comet#withdraw reverts when specific collateral asset is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).withdrawCollateral) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { 
          $asset0: getConfigForScenario(ctx).withdrawCollateral
        }
      }
    ),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, pauseGuardian } = actors;
    const { asset, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const scale = scaleBN.toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause only asset0 withdraw
    await comet.connect(pauseGuardian.signer).pauseCollateralAssetWithdraw(0, true);

    // Asset0 withdraw should revert
    await expect(
      albert.withdrawAsset({
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).withdrawCollateral) * scale
      })
    ).to.be.revertedWithCustomError(comet, 'CollateralAssetWithdrawPaused').withArgs(0);
  }
);

scenario(
  'Comet#withdraw base reverts if position is undercollateralized',
  {
    cometBalances: {
      albert: { $base: 0 }, // in units of asset, not wei
      charles: { $base: 1000 }, // to give the protocol enough base for others to borrow from
    },
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await expectRevertCustom(
      albert.withdrawAsset({
        asset: baseAsset.address,
        amount: 1000n * scale,
      }),
      'NotCollateralized()'
    );
  }
);

scenario(
  'Comet#withdraw collateral reverts if position is undercollateralized',
  {
    cometBalances: async (ctx) => (
      {
        albert: { 
          $base: -getConfigForScenario(ctx).withdrawBase1,
          $asset0: getConfigForScenario(ctx).withdrawAsset1
        }, // in units of asset, not wei
      }
    )
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    await expectRevertCustom(
      albert.withdrawAsset({
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).withdrawAsset1) * scale
      }),
      'NotCollateralized()'
    );
  }
);

scenario(
  'Comet#withdraw reverts if borrow is less than minimum borrow',
  {
    filter: async (ctx) => await hasMinBorrowGreaterThanOne(ctx),
    cometBalances: {
      albert: { $base: 0, $asset0: 100 }
    }
  },
  async ({ comet, actors }, context) => {
    const { albert } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const minBorrow = (await comet.baseBorrowMin()).toBigInt();

    await expectRevertCustom(
      albert.withdrawAsset({
        asset: baseAsset.address,
        amount: minBorrow / 2n
      }),
      'BorrowTooSmall()'
    );
  }
);

scenario.skip(
  'Comet#withdraw reverts if asset is not supported',
  {},
  async () => {
    // XXX requires deploying an unsupported asset (maybe via remote token constraint)
  }
);

scenario.skip(
  'Comet#withdraw reverts if not enough asset in protocol',
  {},
  async () => {
    // XXX fix for development base, where Faucet token doesn't give the same revert message
  }
);

/**
 * @title Withdraw Scenario - isBorrowCollateralized with borrowCollateralFactor = 0
 * @notice Test suite for isBorrowCollateralized behavior when borrowCollateralFactor is set to 0
 *
 * @dev This test suite was written after the USDM incident, when a token price feed was removed from Chainlink.
 * The incident revealed that when a price feed becomes unavailable, the protocol cannot calculate the USD value
 * of collateral (e.g., during absorption when trying to getPrice() for a delisted asset).
 *
 * @dev The solution was to set the asset's borrowCollateralFactor to 0 for delisted collateral. For isBorrowCollateralized,
 * when borrowCollateralFactor = 0, the contract skips that asset in the liquidity calculation (see CometWithExtendedAssetList.sol
 * lines 402-405), effectively excluding it from contributing to the user's collateralization. This prevents the protocol
 * from calling getPrice() on unavailable price feeds.
 *
 * @dev This scenario tests isBorrowCollateralized behavior in two phases:
 * 1. Normal operation: Verifies that positions with positive borrowCF are properly collateralized and can borrow
 * 2. Delisted asset: Sets borrowCF to 0 and verifies that the collateral is excluded from liquidity calculations,
 *    causing positions to become undercollateralized and preventing further borrowing when their only collateral asset is delisted
 *
 * @dev Unlike isLiquidatable which uses liquidateCollateralFactor, this function determines whether a user can initiate
 * new borrows, making it critical for preventing new positions from being opened with unpriceable collateral.
 *
 * @dev The scenario runs for all valid assets (up to MAX_ASSETS) and only on Comet deployments that use
 * the extended asset list feature (CometExtAssetList), as the borrowCollateralFactor = 0 behavior is specific
 * to that implementation. The base Comet contract does not have this check and will attempt to call getPrice()
 * even when borrowCF=0, which would cause a revert if the price feed is unavailable. The test filters deployments
 * using the usesAssetList() utility function to ensure compatibility, and excludes assets that are already delisted.
 */
for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#isBorrowCollateralized > skips liquidity of asset ${i} with borrowCF=0`,
    {
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).supplyCollateral) && await usesAssetList(ctx) && !(await isAssetDelisted(ctx, i)) && await supportsExtendedPause(ctx),
      tokenBalances: async (ctx: CometContext) => (
        {
          albert: { $base: '== 0' },
          $comet: { $base: getConfigForScenario(ctx, i).withdrawBase },
        }
      ),
    },
    async ({ comet, configurator, proxyAdmin, actors }, context) => {
      const { albert, admin } = actors;
      const { asset, borrowCollateralFactor, priceFeed, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const collateralScale = scaleBN.toBigInt();
      
      // Get price feeds and scales
      const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
      const collateralPrice = (await comet.getPrice(priceFeed)).toBigInt();
      const baseScale = (await comet.baseScale()).toBigInt();
      const factorScale = (await comet.factorScale()).toBigInt();
      
      // Target borrow amount (in base units, not wei)
      const targetBorrowBase = BigInt(getConfigForScenario(context, i).withdrawBase);
      const targetBorrowBaseWei = targetBorrowBase * baseScale;
      
      // Calculate required collateral amount
      // Formula from CometBalanceConstraint.ts:
      const collateralWeiPerUnitBase = (collateralScale * basePrice) / collateralPrice;
      let collateralNeeded = (collateralWeiPerUnitBase * targetBorrowBaseWei) / baseScale;
      collateralNeeded = (collateralNeeded * factorScale) / borrowCollateralFactor.toBigInt();
      collateralNeeded = (collateralNeeded * 11n) / 10n; // add fudge factor to ensure collateralization
      
      // Set up balances dynamically
      // 1. Source collateral tokens for albert
      await context.sourceTokens(collateralNeeded, collateralAsset, albert);
      
      // 2. Approve and supply collateral
      await collateralAsset.approve(albert, comet.address);
      await albert.safeSupplyAsset({ asset: collateralAsset.address, amount: collateralNeeded });
      
      // 3. Borrow base (this will make albert have negative base balance)
      const baseTokenAddress = await comet.baseToken();
      await albert.withdrawAsset({ asset: baseTokenAddress, amount: targetBorrowBaseWei });
      
      // Verify initial state: position should be collateralized
      expect(await comet.isBorrowCollateralized(albert.address)).to.be.true;

      // Zero borrowCF for target asset via governance
      await context.setNextBaseFeeToZero();
      await configurator.connect(admin.signer).updateAssetBorrowCollateralFactor(comet.address, asset, 0n, { gasPrice: 0 });
      await context.setNextBaseFeeToZero();
      await proxyAdmin.connect(admin.signer).deployAndUpgradeTo(configurator.address, comet.address, { gasPrice: 0 });

      // Verify borrowCF is 0
      const assetInfo = await comet.getAssetInfoByAddress(asset);
      expect(assetInfo.borrowCollateralFactor).to.equal(0);

      // After zeroing the only supplied asset's borrowCF, position should be undercollateralized
      expect(await comet.isBorrowCollateralized(albert.address)).to.equal(false);
    }
  );
}

scenario(
  'Comet#withdraw reverts when collateral asset withdraw is paused and allows to withdraw when unpaused',
  {
    filter: async (ctx: CometContext) => {
      return await usesAssetList(ctx) && await supportsExtendedPause(ctx);
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, pauseGuardian } = actors;

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    for (let i = 0; i < MAX_ASSETS; i++) {
      if (!await isValidAssetIndex(context, i)) continue;
      if (!await isTriviallySourceable(context, i, getConfigForScenario(context).withdrawCollateral)) continue;
      if (await isAssetDelisted(context, i)) continue;

      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();
      const withdrawCollateral = BigInt(getConfigForScenario(context).withdrawCollateral) * scale;

      log(`Withdrawing reverts when collateral asset ${i} withdraw is paused`);

      // Source collateral asset
      await context.sourceTokens(withdrawCollateral, collateralAsset.address, albert.address);

      // Approve collateral asset
      await collateralAsset.approve(albert, comet.address);

      // Supply collateral asset
      await albert.safeSupplyAsset({
        asset: collateralAsset.address,
        amount: withdrawCollateral,
      });

      // Pause specific collateral asset withdraw at index i
      await comet.connect(pauseGuardian.signer).pauseCollateralAssetWithdraw(i, true);

      await expect(
        albert.withdrawAsset({
          asset: collateralAsset.address,
          amount: withdrawCollateral,
        })
      ).to.be.revertedWithCustomError(comet, 'CollateralAssetWithdrawPaused').withArgs(i);

      log(`Withdrawing is allowed when collateral asset ${i} withdraw is unpaused`);

      // Unpause specific collateral asset withdraw at index i
      await comet.connect(pauseGuardian.signer).pauseCollateralAssetWithdraw(i, false);

      // Save balance
      const albertBalanceBefore = await comet.collateralBalanceOf(albert.address, collateralAsset.address);

      // Withdraw asset from albert
      await albert.withdrawAsset({
        asset: collateralAsset.address,
        amount: withdrawCollateral,
      });

      // Get balance after withdraw
      const albertBalanceAfter = await comet.collateralBalanceOf(albert.address, collateralAsset.address);

      // Assert balance after withdraw
      expect(albertBalanceAfter).to.be.equal(albertBalanceBefore.toBigInt() - withdrawCollateral);
    }
  }
);

scenario(
  'Comet#withdrawFrom reverts when collateral asset withdraw is paused and allows to withdraw when unpaused',
  {
    filter: async (ctx: CometContext) => {
      return await usesAssetList(ctx) && await supportsExtendedPause(ctx);
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Allow betty to withdraw asset from albert
    await albert.allow(betty, true);

    for (let i = 0; i < MAX_ASSETS; i++) {
      if (!await isValidAssetIndex(context, i)) continue;
      if (!await isTriviallySourceable(context, i, getConfigForScenario(context).withdrawCollateral)) continue;
      if (await isAssetDelisted(context, i)) continue;

      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();
      const withdrawCollateral = BigInt(getConfigForScenario(context).withdrawCollateral) * scale;

      log(`Withdrawing reverts when collateral asset ${i} withdraw is paused`);

      // Source collateral asset
      await context.sourceTokens(withdrawCollateral, collateralAsset.address, albert.address);

      // Approve collateral asset
      await collateralAsset.approve(albert, comet.address);

      // Supply collateral asset
      await albert.safeSupplyAsset({
        asset: collateralAsset.address,
        amount: withdrawCollateral,
      });

      // Pause specific collateral asset withdraw at index i
      await comet.connect(pauseGuardian.signer).pauseCollateralAssetWithdraw(i, true);

      await expect(
        betty.withdrawAssetFrom({
          src: albert.address,
          dst: betty.address,
          asset: collateralAsset.address,
          amount: withdrawCollateral,
        })
      ).to.be.revertedWithCustomError(comet, 'CollateralAssetWithdrawPaused').withArgs(i);

      log(`Withdrawing is allowed when collateral asset ${i} withdraw is unpaused`);

      // Unpause specific collateral asset withdraw at index i
      await comet.connect(pauseGuardian.signer).pauseCollateralAssetWithdraw(i, false);

      // Save balances
      const albertBalanceBefore = await comet.collateralBalanceOf(albert.address, collateralAsset.address);
      const bettyBalanceBefore = await comet.collateralBalanceOf(betty.address, collateralAsset.address);
      const albertTokenBalanceBefore = await collateralAsset.balanceOf(albert.address);
      const bettyTokenBalanceBefore = await collateralAsset.balanceOf(betty.address);

      // Withdraw asset from albert to betty
      await betty.withdrawAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: collateralAsset.address,
        amount: withdrawCollateral,
      });

      // Get balances after withdraw
      const albertBalanceAfter = await comet.collateralBalanceOf(albert.address, collateralAsset.address);
      const bettyBalanceAfter = await comet.collateralBalanceOf(betty.address, collateralAsset.address);
      const albertTokenBalanceAfter = await collateralAsset.balanceOf(albert.address);
      const bettyTokenBalanceAfter = await collateralAsset.balanceOf(betty.address);

      // Assert balances after withdraw
      expect(albertBalanceAfter).to.be.equal(albertBalanceBefore.toBigInt() - withdrawCollateral);
      expect(bettyBalanceAfter).to.be.equal(bettyBalanceBefore);

      expect(albertTokenBalanceBefore).to.be.equal(albertTokenBalanceAfter);
      expect(bettyTokenBalanceAfter).to.be.equal(bettyTokenBalanceBefore + withdrawCollateral);
    }
  }
);

scenario(
  'Comet#withdrawTo reverts when collateral asset withdraw is paused and allows to withdraw when unpaused',
  {
    filter: async (ctx: CometContext) => {
      return await usesAssetList(ctx) && await supportsExtendedPause(ctx);
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    for (let i = 0; i < MAX_ASSETS; i++) {
      if (!await isValidAssetIndex(context, i)) continue;
      if (!await isTriviallySourceable(context, i, getConfigForScenario(context).withdrawCollateral)) continue;
      if (await isAssetDelisted(context, i)) continue;

      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();
      const withdrawCollateral = BigInt(getConfigForScenario(context).withdrawCollateral) * scale;

      log(`Withdrawing reverts when collateral asset ${i} withdraw is paused`);

      // Source collateral asset
      await context.sourceTokens(withdrawCollateral, collateralAsset.address, albert.address);

      // Approve collateral asset
      await collateralAsset.approve(albert, comet.address);

      // Supply collateral asset
      await albert.safeSupplyAsset({
        asset: collateralAsset.address,
        amount: withdrawCollateral,
      });

      // Pause specific collateral asset withdraw at index i
      await comet.connect(pauseGuardian.signer).pauseCollateralAssetWithdraw(i, true);

      await expect(
        albert.withdrawAssetTo({
          dst: betty.address,
          asset: collateralAsset.address,
          amount: withdrawCollateral,
        }),
      ).to.be.revertedWithCustomError(comet, 'CollateralAssetWithdrawPaused').withArgs(i);

      log(`Withdrawing is allowed when collateral asset ${i} withdraw is unpaused`);

      // Unpause specific collateral asset withdraw at index i
      await comet.connect(pauseGuardian.signer).pauseCollateralAssetWithdraw(i, false);

      // Save balance
      const albertBalanceBefore = await comet.collateralBalanceOf(albert.address, collateralAsset.address);
      const bettyBalanceBefore = await comet.collateralBalanceOf(betty.address, collateralAsset.address);
      const albertTokenBalanceBefore = await collateralAsset.balanceOf(albert.address);
      const bettyTokenBalanceBefore = await collateralAsset.balanceOf(betty.address);

      // Withdraw asset to betty
      await albert.withdrawAssetTo({
        dst: betty.address,
        asset: collateralAsset.address,
        amount: withdrawCollateral,
      });

      // Get balances after withdraw
      const albertBalanceAfter = await comet.collateralBalanceOf(albert.address, collateralAsset.address);
      const bettyBalanceAfter = await comet.collateralBalanceOf(betty.address, collateralAsset.address);
      const albertTokenBalanceAfter = await collateralAsset.balanceOf(albert.address);
      const bettyTokenBalanceAfter = await collateralAsset.balanceOf(betty.address);

      // Assert balances after withdraw
      expect(albertBalanceAfter).to.be.equal(albertBalanceBefore.toBigInt() - withdrawCollateral);
      expect(bettyBalanceAfter).to.be.equal(bettyBalanceBefore);

      expect(albertTokenBalanceBefore).to.be.equal(albertTokenBalanceAfter);
      expect(bettyTokenBalanceAfter).to.be.equal(bettyTokenBalanceBefore + withdrawCollateral);
    }
  }
);
