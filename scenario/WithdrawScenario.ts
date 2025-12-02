import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';
import { expectApproximately, expectRevertCustom, hasMinBorrowGreaterThanOne, isTriviallySourceable, isValidAssetIndex, MAX_ASSETS, fundAccount, usesAssetList, isAssetDelisted, supportsExtendedPause } from './utils';
import { ContractReceipt } from 'ethers';
import { getConfigForScenario } from './utils/scenarioHelper';

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
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx).withdrawCollateral),
      cometBalances: async (ctx) =>  (
        {
          albert: { [`$asset${i}`]: getConfigForScenario(ctx).withdrawCollateral }
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
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx).withdrawCollateral),
      cometBalances: async (ctx) =>  (
        {
          albert: { [`$asset${i}`]: getConfigForScenario(ctx).withdrawCollateral }
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
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, pauseGuardian } = actors;
    const { asset, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const scale = scaleBN.toBigInt();

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause collateral withdraw
    await cometExt.connect(pauseGuardian.signer).pauseCollateralWithdraw(true);

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
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const { asset, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const scale = scaleBN.toBigInt();


    await albert.allow(betty, true);

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause collateral withdraw
    await cometExt.connect(pauseGuardian.signer).pauseCollateralWithdraw(true);

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
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause borrowers withdraw
    await cometExt.connect(pauseGuardian.signer).pauseBorrowersWithdraw(true);

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
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();


    await albert.allow(betty, true);

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause borrowers withdraw
    await cometExt.connect(pauseGuardian.signer).pauseBorrowersWithdraw(true);

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
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseSupplied = (await comet.balanceOf(albert.address)).toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause lenders withdraw
    await cometExt.connect(pauseGuardian.signer).pauseLendersWithdraw(true);

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
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseSupplied = (await comet.balanceOf(albert.address)).toBigInt();


    await albert.allow(betty, true);

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause lenders withdraw
    await cometExt.connect(pauseGuardian.signer).pauseLendersWithdraw(true);

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
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, pauseGuardian } = actors;
    const { asset, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const scale = scaleBN.toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause only asset0 withdraw
    await cometExt.connect(pauseGuardian.signer).pauseCollateralAssetWithdraw(0, true);

    // Asset0 withdraw should revert
    await expectRevertCustom(
      albert.withdrawAsset({
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).withdrawCollateral) * scale
      }),
      'CollateralAssetWithdrawPaused(0)'
    );
  }
);

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#withdrawFrom reverts when collateral asset ${i} withdraw is paused`,
    {
      filter: async (ctx: CometContext) => {
        return await isValidAssetIndex(ctx, i) &&
        await isTriviallySourceable(ctx, i, getConfigForScenario(ctx).withdrawCollateral) &&
        await usesAssetList(ctx) &&
        !(await isAssetDelisted(ctx, i)) &&
        await supportsExtendedPause(ctx);
      },
      cometBalances: async (ctx: CometContext) => (
        {
          albert: { 
            [`$asset${i}`]: getConfigForScenario(ctx).withdrawCollateral,
          }
        }
      ),
    },
    async ({ comet, actors, cometExt }, context, world) => {
      const { albert, betty, pauseGuardian } = actors;
      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();


      await albert.allow(betty, true);

      // Fund pause guardian account for gas fees
      await fundAccount(world, pauseGuardian);

      // Pause specific collateral asset withdraw at index i
      await cometExt.connect(pauseGuardian.signer).pauseCollateralAssetWithdraw(i, true);

      await expectRevertCustom(
        betty.withdrawAssetFrom({
          src: albert.address,
          dst: betty.address,
          asset: collateralAsset.address,
          amount: BigInt(getConfigForScenario(context).withdrawCollateral) * scale
        }),
        `CollateralAssetWithdrawPaused(${i})`
      );
    }
  );
}

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

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#withdraw allows withdrawing deactivated collateral asset ${i}`,
    {
      filter: async (ctx: CometContext) => {
        return await isValidAssetIndex(ctx, i) &&
          await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).withdrawCollateral) &&
          await usesAssetList(ctx) &&
          !(await isAssetDelisted(ctx, i)) &&
          await supportsExtendedPause(ctx);
      },
      tokenBalances: async (ctx: CometContext) => (
        {
          albert: { [`$asset${i}`]: getConfigForScenario(ctx, i).withdrawCollateral }
        }
      ),
    },
    async ({ comet, actors, cometExt }, context, world) => {
      const { albert, pauseGuardian } = actors;
      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();
      const amount = BigInt(getConfigForScenario(context, i).withdrawCollateral) * scale;

      // Approve the asset for supply
      await collateralAsset.approve(albert, comet.address);

      // Supply collateral first
      await albert.supplyAsset({
        asset: collateralAsset.address,
        amount: amount,
      });

      // Verify collateral is supplied
      expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(amount);

      // Fund pause guardian account for gas fees
      await fundAccount(world, pauseGuardian);

      // Deactivate collateral asset
      await cometExt.connect(pauseGuardian.signer).deactivateCollateral(i);

      // Withdraw deactivated collateral (should succeed)
      const txn = await albert.withdrawAsset({
        asset: collateralAsset.address,
        amount: amount,
      });

      // Verify withdrawal succeeded
      expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(amount);
      expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(0n);

      return txn; // return txn to measure gas
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#withdrawTo allows withdrawing deactivated collateral asset ${i}`,
    {
      filter: async (ctx: CometContext) => {
        return await isValidAssetIndex(ctx, i) &&
          await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).withdrawCollateral) &&
          await usesAssetList(ctx) &&
          !(await isAssetDelisted(ctx, i)) &&
          await supportsExtendedPause(ctx);
      },
      tokenBalances: async (ctx: CometContext) => (
        {
          albert: { [`$asset${i}`]: getConfigForScenario(ctx, i).withdrawCollateral }
        }
      ),
    },
    async ({ comet, actors, cometExt }, context, world) => {
      const { albert, betty, pauseGuardian } = actors;
      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();
      const amount = BigInt(getConfigForScenario(context, i).withdrawCollateral) * scale;

      // Approve the asset for supply
      await collateralAsset.approve(albert, comet.address);

      // Supply collateral first
      await albert.supplyAsset({
        asset: collateralAsset.address,
        amount: amount,
      });

      // Verify collateral is supplied
      expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(amount);

      // Fund pause guardian account for gas fees
      await fundAccount(world, pauseGuardian);

      // Deactivate collateral asset
      await cometExt.connect(pauseGuardian.signer).deactivateCollateral(i);

      // Withdraw deactivated collateral to betty (should succeed)
      const txn = await (await comet.connect(albert.signer).withdrawTo(
        betty.address,
        collateralAsset.address,
        amount
      )).wait();

      // Verify withdrawal succeeded
      expect(await collateralAsset.balanceOf(betty.address)).to.be.equal(amount);
      expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(0n);


      return txn; // return txn to measure gas
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#withdrawFrom allows withdrawing deactivated collateral asset ${i}`,
    {
      filter: async (ctx: CometContext) => {
        return await isValidAssetIndex(ctx, i) &&
          await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).withdrawCollateral) &&
          await usesAssetList(ctx) &&
          !(await isAssetDelisted(ctx, i)) &&
          await supportsExtendedPause(ctx);
      },
      tokenBalances: async (ctx: CometContext) => (
        {
          albert: { [`$asset${i}`]: getConfigForScenario(ctx, i).withdrawCollateral }
        }
      ),
    },
    async ({ comet, actors, cometExt }, context, world) => {
      const { albert, betty, pauseGuardian } = actors;
      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();
      const amount = BigInt(getConfigForScenario(context, i).withdrawCollateral) * scale;

      // Approve the asset for supply
      await collateralAsset.approve(albert, comet.address);

      // Supply collateral first
      await albert.supplyAsset({
        asset: collateralAsset.address,
        amount: amount,
      });

      // Verify collateral is supplied
      expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(amount);

      // Allow betty to act on behalf of albert
      await albert.allow(betty, true);

      // Fund pause guardian account for gas fees
      await fundAccount(world, pauseGuardian);

      // Deactivate collateral asset
      await cometExt.connect(pauseGuardian.signer).deactivateCollateral(i);

      // Withdraw deactivated collateral (should succeed)
      const txn = await betty.withdrawAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: collateralAsset.address,
        amount: amount,
      });

      // Verify withdrawal succeeded
      expect(await collateralAsset.balanceOf(betty.address)).to.be.equal(amount);
      expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(0n);
      
      return txn; // return txn to measure gas
    }
  );
}