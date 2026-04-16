import { CometContext, scenario } from './context/CometContext';
import { event, expect } from '../test/helpers';
import { MAX_ASSETS, expectRevertCustom, isValidAssetIndex, timeUntilUnderwater, isTriviallySourceable, usesAssetList, isAssetDelisted, supportsExtendedPause } from './utils';
import { matchesDeployment } from './utils';
import { getConfigForScenario } from './utils/scenarioHelper';

scenario(
  'Comet#liquidation > isLiquidatable=true for underwater position',
  {
    tokenBalances: async (ctx) => (
      {
        $comet: {
          $base: getConfigForScenario(ctx).liquidationBase
        }
      }),
    cometBalances: async (ctx) => ({
      albert: { $base: -getConfigForScenario(ctx).liquidationBase },
      betty: { $base: getConfigForScenario(ctx).liquidationBase }
    }),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;
    const baseToken = await comet.baseToken();
    const baseScale = await comet.baseScale();

    const timeBeforeLiquidation = await timeUntilUnderwater({
      comet,
      actor: albert,
      fudgeFactor: 6000n * 6000n // 1 hour past when position is underwater
    });

    while(!(await comet.isLiquidatable(albert.address))) {
      await comet.accrueAccount(albert.address);
      await world.increaseTime(timeBeforeLiquidation);
    }

    await betty.withdrawAsset({ asset: baseToken, amount: BigInt(getConfigForScenario(context).liquidationBase) / 100n * baseScale.toBigInt() }); // force accrue

    expect(await comet.isLiquidatable(albert.address)).to.be.true;
  }
);

scenario(
  'Comet#liquidation > allows liquidation of underwater positions with token fees',
  {
    tokenBalances: {
      $comet: { $base: 1000 },
    },
    cometBalances: {
      albert: {
        $base: -1000,
        $asset0: .001
      },
      betty: { $base: 10 }
    },
    filter: async (ctx) => matchesDeployment(ctx, [{ network: 'mainnet', deployment: 'usdt' }]),
  },
  async ({ comet, actors }, context, world) => {
    // Set fees for USDT for testing
    const USDT = await world.deploymentManager.existing('USDT', await comet.baseToken(), world.base.network);
    const USDTAdminAddress = await USDT.owner();
    await world.deploymentManager.hre.network.provider.send('hardhat_setBalance', [
      USDTAdminAddress,
      world.deploymentManager.hre.ethers.utils.hexStripZeros(world.deploymentManager.hre.ethers.utils.parseEther('100').toHexString()),
    ]);
    await world.deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [USDTAdminAddress],
    });
    // mine a block to ensure the impersonation is effective
    const USDTAdminSigner = await world.deploymentManager.hre.ethers.getSigner(USDTAdminAddress);
    // 10 basis points, and max 10 USDT
    await USDT.connect(USDTAdminSigner).setParams(10, 10);

    const { albert, betty } = actors;

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    const lp0 = await comet.liquidatorPoints(betty.address);

    await betty.absorb({ absorber: betty.address, accounts: [albert.address] });

    const lp1 = await comet.liquidatorPoints(betty.address);

    // increments absorber's numAbsorbs
    expect(lp1.numAbsorbs).to.eq(lp0.numAbsorbs + 1);
    // increases absorber's numAbsorbed
    expect(lp1.numAbsorbed.toNumber()).to.eq(lp0.numAbsorbed.toNumber() + 1);
    // XXX test approxSpend?

    const baseBalance = await albert.getCometBaseBalance();
    expect(Number(baseBalance)).to.be.greaterThanOrEqual(0);

    // clears out all of liquidated user's collateral
    const numAssets = await comet.numAssets();
    for (let i = 0; i < numAssets; i++) {
      const { asset } = await comet.getAssetInfo(i);
      expect(await comet.collateralBalanceOf(albert.address, asset)).to.eq(0);
    }

    // clears assetsIn
    expect((await comet.userBasic(albert.address)).assetsIn).to.eq(0);
  }
);

scenario(
  'Comet#liquidation > prevents liquidation when absorb is paused',
  {
    tokenBalances: async (ctx) => (
      {
        $comet: {
          $base: getConfigForScenario(ctx).liquidationBase
        }
      }),
    cometBalances: async (ctx) => ({
      albert: { $base: -getConfigForScenario(ctx).liquidationBase },
      betty: { $base: getConfigForScenario(ctx).liquidationBase }
    }),
    pause: {
      absorbPaused: true,
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;
    const baseToken = await comet.baseToken();
    const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    await betty.withdrawAsset({ asset: baseToken, amount: baseBorrowMin }); // force accrue

    await expectRevertCustom(
      betty.absorb({ absorber: betty.address, accounts: [albert.address] }),
      'Paused()'
    );
  }
);

scenario(
  'Comet#liquidation > allows liquidation of underwater positions',
  {
    tokenBalances: async (ctx) => (
      {
        $comet: {
          $base: getConfigForScenario(ctx).liquidationBase
        }
      }),
    cometBalances: async (ctx) => ({
      albert: {
        $base: -getConfigForScenario(ctx).liquidationBase,
        $asset0: getConfigForScenario(ctx).liquidationAsset
      },
      betty: { $base: getConfigForScenario(ctx).liquidationBase }
    }),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    
    const timeBeforeLiquidation = await timeUntilUnderwater({
      comet,
      actor: albert,
      fudgeFactor: 6000n * 6000n // 1 hour past when position is underwater
    });

    while(!(await comet.isLiquidatable(albert.address))) {
      await comet.accrueAccount(albert.address);
      await world.increaseTime(timeBeforeLiquidation);
    }

    const lp0 = await comet.liquidatorPoints(betty.address);

    await betty.absorb({ absorber: betty.address, accounts: [albert.address] });

    const lp1 = await comet.liquidatorPoints(betty.address);

    // increments absorber's numAbsorbs
    expect(lp1.numAbsorbs).to.eq(lp0.numAbsorbs + 1);
    // increases absorber's numAbsorbed
    expect(lp1.numAbsorbed.toNumber()).to.eq(lp0.numAbsorbed.toNumber() + 1);
    // XXX test approxSpend?

    const baseBalance = await albert.getCometBaseBalance();
    expect(Number(baseBalance)).to.be.greaterThanOrEqual(0);

    // clears out all of liquidated user's collateral
    const numAssets = await comet.numAssets();
    for (let i = 0; i < numAssets; i++) {
      const { asset } = await comet.getAssetInfo(i);
      expect(await comet.collateralBalanceOf(albert.address, asset)).to.eq(0);
    }

    // clears assetsIn
    expect((await comet.userBasic(albert.address)).assetsIn).to.eq(0);
  }
);

scenario(
  'Comet#liquidation > user can end up with a minted supply',
  {
    filter: async (ctx) => !matchesDeployment(ctx, [
      { network: 'base', deployment: 'usds' },
      { network: 'ronin' },
    ]),
    tokenBalances: async (ctx) => (
      {
        $comet: {
          $base: getConfigForScenario(ctx).liquidationBase
        }
      }),
    cometBalances: async (ctx) => ({
      albert: {
        $base: -getConfigForScenario(ctx).liquidationBase,
        $asset0: getConfigForScenario(ctx).liquidationAsset
      }
    }),
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty } = actors;

    await world.increaseTime(
      Math.round(await timeUntilUnderwater({
        comet,
        actor: albert,
      }) * 1.001) // XXX why is this off? better to use a price constraint?
    );

    const ab0 = await betty.absorb({ absorber: betty.address, accounts: [albert.address] });
    expect(ab0.events?.[2]?.event).to.be.equal('Transfer');

    const baseBalance = await albert.getCometBaseBalance();
    expect(Number(baseBalance)).to.be.greaterThan(0);
  }
);

// XXX Skipping temporarily because testnet is in a weird state where an EOA ('admin') still
// has permission to withdraw Comet's collateral, while Timelock does not. This is because the
// permission was set up in the initialize() function. There is currently no way to update this
// permission in Comet, so a new function (e.g. `approveCometPermission`) needs to be created
// to allow governance to modify which addresses can withdraw assets from Comet's Comet balance.
scenario.skip(
  'Comet#liquidation > governor can withdraw collateral after successful liquidation',
  {
    cometBalances: {
      albert: {
        $base: -10,
        $asset0: .001
      },
    },
  },
  async ({ comet, actors }, context, world) => {
    const { albert, betty, charles } = actors;
    const { asset: asset0Address, scale } = await comet.getAssetInfo(0);

    const collateralBalance = scale.toBigInt() / 1000n; // .001

    await world.increaseTime(
      await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 60n * 10n // 10 minutes past when position is underwater
      })
    );

    await betty.absorb({ absorber: betty.address, accounts: [albert.address] });

    const txReceipt = await charles.withdrawAssetFrom({
      src: comet.address,
      dst: charles.address,
      asset: asset0Address,
      amount: collateralBalance
    });

    expect(event({ receipt: txReceipt }, 0)).to.deep.equal({
      Transfer: {
        from: comet.address,
        to: charles.address,
        amount: collateralBalance
      }
    });

    expect(event({ receipt: txReceipt }, 1)).to.deep.equal({
      WithdrawCollateral: {
        src: comet.address,
        to: charles.address,
        asset: asset0Address,
        amount: collateralBalance
      }
    });
  }
);

/**
 * @title Liquidation Scenario - isLiquidatable with liquidateCollateralFactor = 0
 * @notice Test suite for isLiquidatable behavior when liquidateCollateralFactor is set to 0
 *
 * @dev This test suite was written after the USDM incident, when a token price feed was removed from Chainlink.
 * The incident revealed that when a price feed becomes unavailable, the protocol cannot calculate the USD value
 * of collateral (e.g., during absorption when trying to getPrice() for a delisted asset).
 *
 * @dev The solution was to set the asset's liquidateCollateralFactor to 0 for delisted collateral. For isLiquidatable,
 * when liquidateCollateralFactor = 0, the contract skips that asset in the liquidity calculation, effectively
 * excluding it from contributing to the user's collateralization. This prevents the protocol from calling
 * getPrice() on unavailable price feeds.
 *
 * @dev This scenario tests isLiquidatable behavior in two phases:
 * 1. Normal operation: Verifies that positions with positive liquidateCF are properly collateralized and not liquidatable
 * 2. Delisted asset: Sets liquidateCF to 0 and verifies that the collateral is excluded from liquidity calculations,
 *    causing positions to become liquidatable when their only collateral asset is delisted
 *
 * @dev The scenario runs for all valid assets (up to MAX_ASSETS) and only on Comet deployments that use
 * the extended asset list feature (CometExtAssetList), as the liquidateCollateralFactor = 0 behavior is specific
 * to that implementation. The test filters deployments using the usesAssetList() utility function to ensure
 * compatibility, and excludes assets that are already delisted.
 */
for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#liquidation > skips liquidation value of asset ${i} with liquidateCF=0`,
    {
      filter: async (ctx: CometContext) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).supplyCollateral) && await usesAssetList(ctx) && !(await isAssetDelisted(ctx, i)) && await supportsExtendedPause(ctx),
      tokenBalances: async (ctx: CometContext) => (
        {
          albert: { $base: '== 0' },
          $comet: { $base: getConfigForScenario(ctx, i).withdrawBase },
        }
      ),
    },
    async ({ comet, configurator, proxyAdmin, actors }, context) => {
      const { albert, admin } = actors;
      const { asset, borrowCollateralFactor, priceFeed, scale } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const collateralScale = scale.toBigInt();
      
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
      
      // Verify initial state: position should be collateralized and not liquidatable
      expect(await comet.isLiquidatable(albert.address)).to.be.false;
      
      // Set liquidateCF to 0 (CometWithExtendedAssetList allows this even if borrowCF > 0)
      await context.setNextBaseFeeToZero();
      await configurator.connect(admin.signer).updateAssetLiquidateCollateralFactor(comet.address, asset, 0n, { gasPrice: 0 });
      await context.setNextBaseFeeToZero();
      await proxyAdmin.connect(admin.signer).deployAndUpgradeTo(configurator.address, comet.address, { gasPrice: 0 });

      // Verify liquidateCF is 0
      const assetInfo = await comet.getAssetInfoByAddress(asset);
      expect(assetInfo.liquidateCollateralFactor).to.equal(0);

      // After zeroing the only supplied asset's liquidateCF, position should be liquidatable
      expect(await comet.isLiquidatable(albert.address)).to.equal(true);
    }
  );
}

/**
 * @title Liquidation Scenario - Absorption with liquidationFactor = 0
 * @notice Test suite for absorption behavior when liquidationFactor is set to 0
 *
 * @dev This test suite was written after the USDM incident, when a token price feed was removed from Chainlink.
 * The incident revealed that during absorption, the protocol would not be able to calculate the USD value
 * of collateral seized when trying to getPrice() for a delisted asset.
 *
 * @dev The solution was to set the asset's liquidationFactor to 0 for delisted collateral. For absorption,
 * when liquidationFactor = 0, the protocol skips seizing that collateral during absorption, but still
 * proceeds with debt absorption. This allows the protocol to continue functioning even when a price feed
 * becomes unavailable, by setting the asset's liquidation factor to 0 to prevent attempts to calculate its USD value.
 *
 * @dev This scenario tests absorption behavior in two phases:
 * 1. Normal operation: Verifies that when collateral has a non-zero liquidation factor, the protocol can
 *    successfully liquidate/seize the collateral during absorption, calculate its USD value, and update all state correctly
 * 2. Delisted asset: Sets liquidationFactor to 0 and verifies that the protocol skips seizing that collateral
 *    during absorption, but still proceeds with debt absorption
 *
 * @dev The scenario runs for all valid assets (up to MAX_ASSETS) and only on Comet deployments that use
 * the extended asset list feature (CometExtAssetList), as the liquidationFactor = 0 behavior is specific
 * to that implementation. The test filters deployments using the usesAssetList() utility function to ensure
 * compatibility, and excludes assets that are already delisted.
 */
for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#liquidation > skips absorption of asset ${i} with liquidation factor = 0`,
    {
      filter: async (ctx) => 
        await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).supplyCollateral) && await usesAssetList(ctx) && !(await isAssetDelisted(ctx, i)) && await supportsExtendedPause(ctx),
      tokenBalances: async (ctx) => ({
        albert: { $base: '== 0' },
        $comet: {
          $base: getConfigForScenario(ctx).withdrawBase
        }
      }),
    },
    async ({ comet, configurator, proxyAdmin, actors }, context, world) => {
      const { albert, betty, admin } = actors;
      const { asset, borrowCollateralFactor, priceFeed, scale } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const collateralScale = scale.toBigInt();
      const baseToken = await comet.baseToken();
      const baseScale = (await comet.baseScale()).toBigInt();
      
      // Get price feeds and scales
      const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
      const collateralPrice = (await comet.getPrice(priceFeed)).toBigInt();
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
      await albert.withdrawAsset({ asset: baseToken, amount: targetBorrowBaseWei });

      // Set up betty's base token supply for forcing accrue
      // Betty needs base tokens supplied to Comet to be able to withdraw them
      const bettyBaseAmount = BigInt(getConfigForScenario(context).withdrawBase) * baseScale;
      const baseAsset = context.getAssetByAddress(baseToken);
      await context.sourceTokens(bettyBaseAmount, baseAsset, betty);
      await baseAsset.approve(betty, comet.address);
      await betty.supplyAsset({ asset: baseToken, amount: bettyBaseAmount });

      // Ensure account is liquidatable by waiting for time to pass and accruing interest
      const timeBeforeLiquidation = await timeUntilUnderwater({
        comet,
        actor: albert,
        fudgeFactor: 6000n * 6000n // 1 hour past when position is underwater
      });

      while(!(await comet.isLiquidatable(albert.address))) {
        await comet.accrueAccount(albert.address);
        await world.increaseTime(timeBeforeLiquidation);
      }

      // Force accrue to ensure state is up to date
      await betty.withdrawAsset({ asset: baseToken, amount: BigInt(getConfigForScenario(context).withdrawBase) / 100n * baseScale });

      // Verify account is liquidatable
      expect(await comet.isLiquidatable(albert.address)).to.be.true;
      
      await context.setNextBaseFeeToZero();
      await configurator.connect(admin.signer).updateAssetLiquidationFactor(comet.address, asset, 0n, { gasPrice: 0 });
      await context.setNextBaseFeeToZero();
      await proxyAdmin.connect(admin.signer).deployAndUpgradeTo(configurator.address, comet.address, { gasPrice: 0 });

      // Verify liquidationFactor is 0
      expect((await comet.getAssetInfoByAddress(asset)).liquidationFactor).to.equal(0);

      expect(await comet.isLiquidatable(albert.address)).to.be.true;

      // Save balances before absorb
      const userCollateralBefore = (await comet.userCollateral(albert.address, asset)).balance;
      const totalsBefore = (await comet.totalsCollateral(asset)).totalSupplyAsset;

      await betty.absorb({ absorber: betty.address, accounts: [albert.address] });

      expect((await comet.userCollateral(albert.address, asset)).balance).to.equal(userCollateralBefore);
      expect((await comet.totalsCollateral(asset)).totalSupplyAsset).to.equal(totalsBefore);
    }
  );
}

/**
 * @title Liquidation Scenario - Two collaterals, one with liquidationFactor = 0
 * @notice Tests that absorption correctly skips a non-liquidatable collateral while seizing the other
 *
 * @dev This scenario verifies the selective seizure behavior during absorption when an account
 * holds two different collateral assets (asset0 and asset1) and one of them has its
 * liquidationFactor set to 0 (simulating a de-listed asset whose price feed may be unavailable).
 *
 * @dev The test proceeds through the following phases:
 * 1. Setup: Supply two collateral assets (asset0 and asset1) and borrow base tokens
 * 2. Wait until the position becomes liquidatable through interest accrual
 * 3. De-list asset0 by setting its liquidationFactor to 0 via governance (configurator + upgrade)
 * 4. Absorb (liquidate) the account
 * 5. Verify that:
 *    - Asset0 (liquidationFactor = 0) remains on the user's balance — it was NOT seized
 *    - Asset1 (normal liquidationFactor) was fully seized — its balance is now 0
 *
 * @dev This proves that absorbInternal correctly skips non-liquidatable collateral (avoiding
 * a getPrice() call on a potentially broken oracle) while still proceeding with seizure of
 * all other liquidatable assets. The account's debt is absorbed regardless.
 */
scenario(
  'Comet#liquidation > two collaterals: asset0 (liqFactor=0) retained, asset1 absorbed',
  {
    filter: async (ctx) =>
      await isValidAssetIndex(ctx, 0) &&
      await isValidAssetIndex(ctx, 1) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx, 0).supplyCollateral) &&
      await isTriviallySourceable(ctx, 1, getConfigForScenario(ctx, 1).supplyCollateral) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      !(await isAssetDelisted(ctx, 1)) &&
      await supportsExtendedPause(ctx),
    tokenBalances: async (ctx) => ({
      albert: { $base: '== 0' },
      $comet: {
        $base: getConfigForScenario(ctx).withdrawBase
      }
    }),
  },
  async ({ comet, configurator, proxyAdmin, actors }, context, world) => {
    const { albert, betty, admin } = actors;
    const baseToken = await comet.baseToken();
    const baseScale = (await comet.baseScale()).toBigInt();
    const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
    const factorScale = (await comet.factorScale()).toBigInt();

    // ── Step 1: Supply two different collateral assets ──
    // Asset0 — this one will later be de-listed (liquidationFactor set to 0)
    const assetInfo0 = await comet.getAssetInfo(0);
    const collateralAsset0 = context.getAssetByAddress(assetInfo0.asset);
    const collateralPrice0 = (await comet.getPrice(assetInfo0.priceFeed)).toBigInt();

    // Asset1 — this one keeps normal parameters and should be seized during absorption
    const assetInfo1 = await comet.getAssetInfo(1);
    const collateralAsset1 = context.getAssetByAddress(assetInfo1.asset);
    const collateralPrice1 = (await comet.getPrice(assetInfo1.priceFeed)).toBigInt();

    // Calculate how much of each collateral to supply so that combined they cover the borrow.
    // We split the borrow coverage roughly 50/50 between the two assets.
    const targetBorrowBase = BigInt(getConfigForScenario(context).withdrawBase);
    const targetBorrowBaseWei = targetBorrowBase * baseScale;
    const halfBorrowWei = targetBorrowBaseWei / 2n;

    // Collateral needed for asset0 (covers ~half the borrow)
    const collateralWeiPerUnitBase0 = (assetInfo0.scale.toBigInt() * basePrice) / collateralPrice0;
    let collateralNeeded0 = (collateralWeiPerUnitBase0 * halfBorrowWei) / baseScale;
    collateralNeeded0 = (collateralNeeded0 * factorScale) / assetInfo0.borrowCollateralFactor.toBigInt();
    collateralNeeded0 = (collateralNeeded0 * 12n) / 10n; // 20% buffer

    // Collateral needed for asset1 (covers ~half the borrow)
    const collateralWeiPerUnitBase1 = (assetInfo1.scale.toBigInt() * basePrice) / collateralPrice1;
    let collateralNeeded1 = (collateralWeiPerUnitBase1 * halfBorrowWei) / baseScale;
    collateralNeeded1 = (collateralNeeded1 * factorScale) / assetInfo1.borrowCollateralFactor.toBigInt();
    collateralNeeded1 = (collateralNeeded1 * 12n) / 10n; // 20% buffer

    // Source, approve, and supply collateral asset0
    await context.sourceTokens(collateralNeeded0, collateralAsset0, albert);
    await collateralAsset0.approve(albert, comet.address);
    await albert.safeSupplyAsset({ asset: collateralAsset0.address, amount: collateralNeeded0 });

    // Source, approve, and supply collateral asset1
    await context.sourceTokens(collateralNeeded1, collateralAsset1, albert);
    await collateralAsset1.approve(albert, comet.address);
    await albert.safeSupplyAsset({ asset: collateralAsset1.address, amount: collateralNeeded1 });

    // ── Step 2: Borrow base tokens ──
    // This creates a negative base balance, making the account a borrower
    await albert.withdrawAsset({ asset: baseToken, amount: targetBorrowBaseWei });

    // Verify initial state: position should be collateralized and not liquidatable
    expect(await comet.isBorrowCollateralized(albert.address)).to.be.true;
    expect(await comet.isLiquidatable(albert.address)).to.be.false;

    // Set up betty with base tokens so she can force accrue later
    const bettyBaseAmount = BigInt(getConfigForScenario(context).withdrawBase) * baseScale;
    const baseAsset = context.getAssetByAddress(baseToken);
    await context.sourceTokens(bettyBaseAmount, baseAsset, betty);
    await baseAsset.approve(betty, comet.address);
    await betty.supplyAsset({ asset: baseToken, amount: bettyBaseAmount });

    // ── Step 3: Wait until the position becomes liquidatable via interest accrual ──
    const timeBeforeLiquidation = await timeUntilUnderwater({
      comet,
      actor: albert,
      fudgeFactor: 6000n * 6000n // ~1 hour past underwater
    });

    while (!(await comet.isLiquidatable(albert.address))) {
      await comet.accrueAccount(albert.address);
      await world.increaseTime(timeBeforeLiquidation);
    }

    // Force accrue to ensure state is up to date
    await betty.withdrawAsset({ asset: baseToken, amount: BigInt(getConfigForScenario(context).withdrawBase) / 100n * baseScale });

    expect(await comet.isLiquidatable(albert.address)).to.be.true;

    // ── Step 4: De-list asset0 by setting its liquidationFactor to 0 ──
    // This simulates a governance action to de-list an asset whose price feed
    // has become unavailable. After this, absorbInternal should skip asset0
    // entirely — not seize it, not call getPrice() on it.
    await context.setNextBaseFeeToZero();
    await configurator.connect(admin.signer).updateAssetLiquidationFactor(
      comet.address, assetInfo0.asset, 0n, { gasPrice: 0 }
    );
    await context.setNextBaseFeeToZero();
    await proxyAdmin.connect(admin.signer).deployAndUpgradeTo(
      configurator.address, comet.address, { gasPrice: 0 }
    );

    // Verify liquidationFactor for asset0 is now 0
    const updatedAssetInfo0 = await comet.getAssetInfoByAddress(assetInfo0.asset);
    expect(updatedAssetInfo0.liquidationFactor).to.equal(0);

    // Account should still be liquidatable (asset1 alone may not cover the debt,
    // and asset0 no longer contributes to the liquidation threshold)
    expect(await comet.isLiquidatable(albert.address)).to.be.true;

    // Record balances before absorption (we expect asset0 unchanged, asset1 fully seized)
    const collateralBalance0_before = (await comet.userCollateral(albert.address, assetInfo0.asset)).balance;
    const totalSupply0_before = (await comet.totalsCollateral(assetInfo0.asset)).totalSupplyAsset;
    const collateralBalance1_before = (await comet.userCollateral(albert.address, assetInfo1.asset)).balance;
    const totalSupply1_before = (await comet.totalsCollateral(assetInfo1.asset)).totalSupplyAsset;

    // ── Step 5: Absorb (liquidate) the account ──
    await betty.absorb({ absorber: betty.address, accounts: [albert.address] });

    // ── Step 6: Verify selective seizure ──
    // Asset0 (liquidationFactor = 0): NOT seized — balance and totals unchanged.
    // The collateral remains with the user because the protocol intentionally
    // skips non-liquidatable assets during absorption.
    expect((await comet.userCollateral(albert.address, assetInfo0.asset)).balance)
      .to.equal(collateralBalance0_before);
    expect((await comet.totalsCollateral(assetInfo0.asset)).totalSupplyAsset)
      .to.equal(totalSupply0_before);

    // Asset1 (normal liquidationFactor): fully seized — balance is now 0
    // and totals decreased by the seized amount. This asset participated in
    // the liquidation normally.
    expect((await comet.userCollateral(albert.address, assetInfo1.asset)).balance)
      .to.equal(0);
    expect((await comet.totalsCollateral(assetInfo1.asset)).totalSupplyAsset)
      .to.equal(totalSupply1_before.sub(collateralBalance1_before));

    // Debt was absorbed: albert's base balance should be >= 0
    const baseBalance = await albert.getCometBaseBalance();
    expect(Number(baseBalance)).to.be.greaterThanOrEqual(0);
  }
);

