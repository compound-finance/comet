import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';
import { expectApproximately, expectBase, expectRevertCustom, getInterest, hasMinBorrowGreaterThanOne, isTriviallySourceable, isValidAssetIndex, MAX_ASSETS, fundAccount, usesAssetList, isAssetDelisted, supportsExtendedPause } from './utils';
import { ContractReceipt } from 'ethers';
import { getConfigForScenario } from './utils/scenarioHelper';

async function testTransferCollateral(context: CometContext, assetNum: number): Promise<void | ContractReceipt> {
  const comet = await context.getComet();
  const { albert, betty } = context.actors;
  const { asset: assetAddress, scale } = await comet.getAssetInfo(assetNum);
  const collateralAsset = context.getAssetByAddress(assetAddress);

  // Albert transfers 50 units of collateral to Betty
  const toTransfer = scale.toBigInt() * BigInt(getConfigForScenario(context, assetNum).transferCollateral) / 2n;
  const txn = await albert.transferAsset({ dst: betty.address, asset: collateralAsset.address, amount: toTransfer });

  expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(scale.mul(BigInt(getConfigForScenario(context, assetNum).transferCollateral) / 2n));
  expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(scale.mul(BigInt(getConfigForScenario(context, assetNum).transferCollateral) / 2n));

  return txn; // return txn to measure gas
}

async function testTransferFromCollateral(context: CometContext, assetNum: number): Promise<void | ContractReceipt> {
  const comet = await context.getComet();
  const { albert, betty, charles } = context.actors;
  const { asset: assetAddress, scale } = await comet.getAssetInfo(assetNum);
  const collateralAsset = context.getAssetByAddress(assetAddress);

  await albert.allow(charles, true);

  // Charles transfers 50 units of collateral from Albert to Betty
  const toTransfer = scale.toBigInt() * BigInt(getConfigForScenario(context, assetNum).transferCollateral) / 2n;
  const txn = await charles.transferAssetFrom({ src: albert.address, dst: betty.address, asset: collateralAsset.address, amount: toTransfer });

  expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(scale.mul(BigInt(getConfigForScenario(context, assetNum).transferCollateral) / 2n));
  expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(scale.mul(BigInt(getConfigForScenario(context, assetNum).transferCollateral) / 2n));

  return txn; // return txn to measure gas
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#transfer > collateral asset ${i}, enough balance`,
    {
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).transferCollateral),
      cometBalances: async (ctx) =>  (
        {
          albert: { [`$asset${i}`]: getConfigForScenario(ctx, i).transferCollateral }
        }
      ),
    },
    async (_properties, context) => {
      return await testTransferCollateral(context, i);
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#transferFrom > collateral asset ${i}, enough balance`,
    {
      filter: async (ctx) => await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).transferCollateral),
      cometBalances: async (ctx) =>  (
        {
          albert: { [`$asset${i}`]: getConfigForScenario(ctx, i).transferCollateral }
        }
      ),
    },
    async (_properties, context) => {
      return await testTransferFromCollateral(context, i);
    }
  );
}

scenario(
  'Comet#transfer > base asset, enough balance',
  {
    cometBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseSupplied = (await comet.balanceOf(albert.address)).toBigInt();

    // Albert transfers half supplied base to Betty
    const toTransfer = baseSupplied / 2n;
    const txn = await albert.transferAsset({ dst: betty.address, asset: baseAsset.address, amount: toTransfer });

    expectBase(await albert.getCometBaseBalance(), baseSupplied - toTransfer, baseSupplied / 100n);
    expectBase(await betty.getCometBaseBalance(), toTransfer, baseSupplied / 100n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#transfer > base asset, total and user balances are summed up properly',
  {
    cometBalances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    // Cache pre-transfer balances
    const { totalSupplyBase: oldTotalSupply, totalBorrowBase: oldTotalBorrow } = await comet.totalsBasic();
    const oldAlbertPrincipal = (await comet.userBasic(albert.address)).principal.toBigInt();
    const oldBettyPrincipal = (await comet.userBasic(betty.address)).principal.toBigInt();

    // Albert transfers 50 units of collateral to Betty
    const toTransfer = 50n * scale;
    const txn = await albert.transferAsset({ dst: betty.address, asset: baseAsset.address, amount: toTransfer });

    // Cache post-transfer balances
    const { totalSupplyBase: newTotalSupply, totalBorrowBase: newTotalBorrow } = await comet.totalsBasic();
    const newAlbertPrincipal = (await comet.userBasic(albert.address)).principal.toBigInt();
    const newBettyPrincipal = (await comet.userBasic(betty.address)).principal.toBigInt();

    // Check that global and user principals are updated by the same amount
    const changeInTotalPrincipal = newTotalSupply.toBigInt() - oldTotalSupply.toBigInt() - (newTotalBorrow.toBigInt() - oldTotalBorrow.toBigInt());
    const changeInUserPrincipal = newAlbertPrincipal - oldAlbertPrincipal + newBettyPrincipal - oldBettyPrincipal;
    expect(changeInTotalPrincipal).to.be.equal(changeInUserPrincipal).to;
    expect([0n, -1n, -2n]).to.include(changeInTotalPrincipal); // these are the only acceptable values for transfer

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#transfer > partial withdraw / borrow base to partial repay / supply',
  {
    cometBalances: async (ctx) =>  (
      {
        albert: { $base: getConfigForScenario(ctx).transferBase, $asset0: getConfigForScenario(ctx).transferAsset1 }, // in units of asset, not wei
        betty: { $base: -getConfigForScenario(ctx).transferBase },
        charles: { $base: getConfigForScenario(ctx).transferBase }, // to give the protocol enough base for others to borrow from
      }
    ),
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    // XXX 100 seconds?!
    expectApproximately(
      await albert.getCometBaseBalance(),
      BigInt(getConfigForScenario(context).transferBase) * scale,
      getInterest(BigInt(getConfigForScenario(context).transferBase) * scale, borrowRate, 100n) + 2n
    );

    expectApproximately(
      await betty.getCometBaseBalance(),
      -BigInt(getConfigForScenario(context).transferBase) * scale,
      getInterest(BigInt(getConfigForScenario(context).transferBase) * scale, borrowRate, 100n) + 2n
    );

    // Albert with positive balance transfers to Betty with negative balance
    const toTransfer = BigInt(getConfigForScenario(context).transferBase) * 25n / 10n * scale;
    const txn = await albert.transferAsset({ dst: betty.address, asset: baseAsset.address, amount: toTransfer });

    // Albert ends with negative balance and Betty with positive balance
    expectApproximately(await albert.getCometBaseBalance(), -BigInt(getConfigForScenario(context).transferBase) * 15n / 10n * scale, getInterest(BigInt(getConfigForScenario(context).transferBase) * 15n / 10n * scale, borrowRate, 100n) + 4n);
    expectApproximately(await betty.getCometBaseBalance(), BigInt(getConfigForScenario(context).transferBase) * 15n / 10n * scale, getInterest(BigInt(getConfigForScenario(context).transferBase) * 15n / 10n * scale, borrowRate, 100n) + 4n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#transferFrom > withdraw to repay',
  {
    cometBalances: {
      albert: { $base: 1000, $asset0: 50 }, // in units of asset, not wei
      betty: { $base: -1000 },
      charles: { $base: 1000 }, // to give the protocol enough base for others to borrow from
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    // XXX 70 seconds?!
    expectApproximately(await albert.getCometBaseBalance(), 1000n * scale, getInterest(1000n * scale, borrowRate, BigInt(getConfigForScenario(context).interestSeconds)) + 2n);
    expectApproximately(await betty.getCometBaseBalance(), -1000n * scale, getInterest(1000n * scale, borrowRate, BigInt(getConfigForScenario(context).interestSeconds)) + 2n);

    await albert.allow(betty, true);

    // Betty withdraws from Albert to repay her own borrows
    const toTransfer = 999n * scale; // XXX cannot withdraw 1000 (to ~0)
    const txn = await betty.transferAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: toTransfer });

    expectApproximately(await albert.getCometBaseBalance(), scale, getInterest(1000n * scale, borrowRate, BigInt(getConfigForScenario(context).interestSeconds)) + 2n);
    expectApproximately(await betty.getCometBaseBalance(), -scale, getInterest(1000n * scale, borrowRate, BigInt(getConfigForScenario(context).interestSeconds)) + 2n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#transfer base reverts if undercollateralized',
  {
    cometBalances: {
      albert: { $base: 1000, $asset0: 0.000001 }, // in units of asset, not wei
      betty: { $base: -1000 },
      charles: { $base: 1000 }, // to give the protocol enough base for others to borrow from
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    // XXX 100 seconds?!
    expectApproximately(await albert.getCometBaseBalance(), 1000n * scale, getInterest(1000n * scale, borrowRate, 100n) + 2n);
    expectApproximately(await betty.getCometBaseBalance(), -1000n * scale, getInterest(1000n * scale, borrowRate, 100n) + 2n);

    // Albert with positive balance transfers to Betty with negative balance
    const toTransfer = 2001n * scale; // XXX min borrow...
    await expectRevertCustom(
      albert.transferAsset({
        dst: betty.address,
        asset: baseAsset.address,
        amount: toTransfer,
      }),
      'NotCollateralized()'
    );
  }
);

scenario(
  'Comet#transferFrom base reverts if undercollateralized',
  {
    cometBalances: {
      albert: { $base: 1000, $asset0: 0.000001 }, // in units of asset, not wei
      betty: { $base: -1000 },
      charles: { $base: 1000 }, // to give the protocol enough base for others to borrow from
    },
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const utilization = await comet.getUtilization();
    const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();

    // XXX 70 seconds?!
    expectApproximately(await albert.getCometBaseBalance(), 1000n * scale, getInterest(1000n * scale, borrowRate, BigInt(getConfigForScenario(context).interestSeconds)) + 2n);
    expectApproximately(await betty.getCometBaseBalance(), -1000n * scale, getInterest(1000n * scale, borrowRate, BigInt(getConfigForScenario(context).interestSeconds)) + 2n);

    await albert.allow(betty, true);

    // Albert with positive balance transfers to Betty with negative balance
    const toTransfer = 2001n * scale; // XXX min borrow...
    await expectRevertCustom(
      betty.transferAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: toTransfer,
      }),
      'NotCollateralized()'
    );
  }
);

scenario(
  'Comet#transfer collateral reverts if undercollateralized',
  {
    // XXX we should probably have a price constraint?
    cometBalances: async (ctx) =>  (
      {
        albert: {
          $base: -getConfigForScenario(ctx).transferBase,
          $asset0: `== ${getConfigForScenario(ctx).transferAsset}`
        }, // in units of asset, not wei
        betty: { $asset0: 0 },
      }
    ),
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    // Albert transfers all his collateral to Betty
    await expectRevertCustom(
      albert.transferAsset({
        dst: betty.address,
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).transferAsset) * scale,
      }),
      'NotCollateralized()'
    );
  }
);

scenario(
  'Comet#transferFrom collateral reverts if undercollateralized',
  {
    // XXX we should probably have a price constraint?
    cometBalances: async (ctx) =>  (
      {
        albert: {
          $base: -getConfigForScenario(ctx).transferBase,
          $asset0: `== ${getConfigForScenario(ctx).transferAsset}`
        }, // in units of asset, not wei
        betty: { $asset0: 0 },
      }
    ),
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    await albert.allow(betty, true);

    // Betty transfers all of Albert's collateral to herself
    await expectRevertCustom(
      betty.transferAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).transferAsset) * scale,
      }),
      'NotCollateralized()'
    );
  }
);

scenario(
  'Comet#transfer disallows self-transfer of base',
  {},
  async ({ comet, actors }) => {
    const { albert } = actors;

    const baseToken = await comet.baseToken();

    await expectRevertCustom(
      albert.transferAsset({
        dst: albert.address,
        asset: baseToken,
        amount: 100,
      }),
      'NoSelfTransfer()'
    );
  }
);

scenario(
  'Comet#transfer disallows self-transfer of collateral',
  {},
  async ({ comet, actors }) => {
    const { albert } = actors;

    const collateralAsset = await comet.getAssetInfo(0);

    await expectRevertCustom(
      albert.transferAsset({
        dst: albert.address,
        asset: collateralAsset.asset,
        amount: 100,
      }),
      'NoSelfTransfer()'
    );
  }
);

scenario(
  'Comet#transferFrom disallows self-transfer of base',
  {},
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expectRevertCustom(
      albert.transferAssetFrom({
        src: betty.address,
        dst: betty.address,
        asset: baseToken,
        amount: 100,
      }),
      'NoSelfTransfer()'
    );
  }
);

scenario(
  'Comet#transferFrom disallows self-transfer of collateral',
  {},
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const collateralAsset = await comet.getAssetInfo(0);

    await betty.allow(albert, true);

    await expectRevertCustom(
      albert.transferAssetFrom({
        src: betty.address,
        dst: betty.address,
        asset: collateralAsset.asset,
        amount: 100,
      }),
      'NoSelfTransfer()'
    );
  }
);

scenario(
  'Comet#transferFrom reverts if operator not given permission',
  {},
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await expectRevertCustom(
      betty.transferAssetFrom({
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
  'Comet#transfer reverts when transfer is paused',
  {
    pause: {
      transferPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expectRevertCustom(
      albert.transferAsset({
        dst: betty.address,
        asset: baseToken,
        amount: 100,
      }),
      'Paused()'
    );
  }
);


scenario(
  'Comet#transferFrom reverts when transfer is paused',
  {
    pause: {
      transferPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expectRevertCustom(
      albert.transferAssetFrom({
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
  'Comet#transfer reverts when collateral transfer is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).transferCollateral) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $asset0: getConfigForScenario(ctx).transferCollateral }
      }
    ),
  },
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const { asset, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const scale = scaleBN.toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause collateral transfer
    await cometExt.connect(pauseGuardian.signer).pauseCollateralTransfer(true);

    await expectRevertCustom(
      albert.transferAsset({
        dst: betty.address,
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).transferCollateral) * scale
      }),
      'CollateralTransferPaused()'
    );
  }
);

scenario(
  'Comet#transferFrom reverts when collateral transfer is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).transferCollateral) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $asset0: getConfigForScenario(ctx).transferCollateral }
      }
    ),
  },
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, betty, charles, pauseGuardian } = actors;
    const { asset, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const scale = scaleBN.toBigInt();


    await albert.allow(betty, true);

    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause collateral transfer
    await cometExt.connect(pauseGuardian.signer).pauseCollateralTransfer(true);

    await expectRevertCustom(
      betty.transferAssetFrom({
        src: albert.address,
        dst: charles.address,
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).transferCollateral) * scale
      }),
      'CollateralTransferPaused()'
    );
  }
);

scenario(
  'Comet#transfer reverts when borrowers transfer is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).transferBase) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $base: '== 0' },
        betty: { $base: getConfigForScenario(ctx).transferBase }
      }
    ),
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $base: -getConfigForScenario(ctx).transferBase, $asset0: getConfigForScenario(ctx).transferAsset },
        charles: { $base: getConfigForScenario(ctx).transferBase } // to give the protocol enough base for others to borrow from
      }
    ),
  },
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause borrowers transfer
    await cometExt.connect(pauseGuardian.signer).pauseBorrowersTransfer(true);

    await expectRevertCustom(
      albert.transferAsset({
        dst: betty.address,
        asset: baseAsset.address,
        amount: BigInt(getConfigForScenario(context).transferBase) * scale
      }),
      'BorrowersTransferPaused()'
    );
  }
);

scenario(
  'Comet#transferFrom reverts when borrowers transfer is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).transferBase) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    tokenBalances: async (ctx: CometContext) => (
      {
        albert: { $base: '== 0' },
        $comet: { $base: getConfigForScenario(ctx).transferBase }
      }
    ),
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $asset0: getConfigForScenario(ctx).transferAsset }
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

    // Pause borrowers transfer
    await cometExt.connect(pauseGuardian.signer).pauseBorrowersTransfer(true);

    await expectRevertCustom(
      betty.transferAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: BigInt(getConfigForScenario(context).transferBase) * scale
      }),
      'BorrowersTransferPaused()'
    );
  }
);

scenario(
  'Comet#transfer reverts when lenders transfer is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).transferBase) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $base: getConfigForScenario(ctx).transferBase }
      }
    ),
  },
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const baseSupplied = (await comet.balanceOf(albert.address)).toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause lenders transfer
    await cometExt.connect(pauseGuardian.signer).pauseLendersTransfer(true);

    await expectRevertCustom(
      albert.transferAsset({
        dst: betty.address,
        asset: baseAsset.address,
        amount: baseSupplied
      }),
      'LendersTransferPaused()'
    );
  }
);

scenario(
  'Comet#transferFrom reverts when lenders transfer is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).transferBase) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { $base: getConfigForScenario(ctx).transferBase }
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

    // Pause lenders transfer
    await cometExt.connect(pauseGuardian.signer).pauseLendersTransfer(true);

    await expectRevertCustom(
      betty.transferAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: baseSupplied
      }),
      'LendersTransferPaused()'
    );
  }
);

scenario(
  'Comet#transfer reverts when specific collateral asset is paused',
  {
    filter: async (ctx: CometContext) => {
      return await isValidAssetIndex(ctx, 0) &&
      await isTriviallySourceable(ctx, 0, getConfigForScenario(ctx).transferCollateral) &&
      await usesAssetList(ctx) &&
      !(await isAssetDelisted(ctx, 0)) &&
      await supportsExtendedPause(ctx);
    },
    cometBalances: async (ctx: CometContext) => (
      {
        albert: { 
          $asset0: getConfigForScenario(ctx).transferCollateral
        }
      }
    ),
  },
  async ({ comet, actors, cometExt }, context, world) => {
    const { albert, betty, pauseGuardian } = actors;
    const { asset, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset);
    const scale = scaleBN.toBigInt();


    // Fund pause guardian account for gas fees
    await fundAccount(world, pauseGuardian);

    // Pause only asset0 transfer
    await cometExt.connect(pauseGuardian.signer).pauseCollateralAssetTransfer(0, true);

    // Asset0 transfer should revert
    await expectRevertCustom(
      albert.transferAsset({
        dst: betty.address,
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).transferCollateral) * scale
      }),
      'CollateralAssetTransferPaused(0)'
    );
  }
);

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#transfer reverts when collateral asset ${i} transfer is paused and allows to transfer when unpaused`,
    {
      filter: async (ctx: CometContext) => {
        return await isValidAssetIndex(ctx, i) &&
        await isTriviallySourceable(ctx, i, getConfigForScenario(ctx).transferCollateral) &&
        await usesAssetList(ctx) &&
        !(await isAssetDelisted(ctx, i)) &&
        await supportsExtendedPause(ctx);
      },
      cometBalances: async (ctx: CometContext) => (
        {
          albert: { 
            [`$asset${i}`]: getConfigForScenario(ctx).transferCollateral
          }
        }
      ),
    },
    async ({ comet, actors, cometExt }, context, world) => {
      const { albert, betty, pauseGuardian } = actors;
      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();

      // Fund pause guardian account for gas fees
      await fundAccount(world, pauseGuardian);

      // Pause specific collateral asset transfer at index i
      await cometExt.connect(pauseGuardian.signer).pauseCollateralAssetTransfer(i, true);

      await expectRevertCustom(
        albert.transferAsset({
          dst: betty.address,
          asset: collateralAsset.address,
          amount: BigInt(getConfigForScenario(context).transferCollateral) * scale
        }),
        `CollateralAssetTransferPaused(${i})`
      );

      // Unpause specific collateral asset transfer at index i
      await cometExt.connect(pauseGuardian.signer).pauseCollateralAssetTransfer(i, false);

      // Save balances 
      const albertBalanceBefore = await comet.collateralBalanceOf(albert.address, collateralAsset.address);
      const bettyBalanceBefore = await comet.collateralBalanceOf(betty.address, collateralAsset.address);

      // Transfer asset from albert to betty
      await albert.transferAsset({
        dst: betty.address,
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).transferCollateral) * scale,
      });

      // Get balances after transfer
      const albertBalanceAfter = await comet.collateralBalanceOf(albert.address, collateralAsset.address);
      const bettyBalanceAfter = await comet.collateralBalanceOf(betty.address, collateralAsset.address);

      // Assert balances after transfer
      expect(albertBalanceAfter).to.be.equal(albertBalanceBefore.toBigInt() - BigInt(getConfigForScenario(context).transferCollateral) * scale);
      expect(bettyBalanceAfter).to.be.equal(bettyBalanceBefore.toBigInt() + BigInt(getConfigForScenario(context).transferCollateral) * scale);
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#transferFrom reverts when collateral asset ${i} transfer is paused`,
    {
      filter: async (ctx: CometContext) => {
        return await isValidAssetIndex(ctx, i) &&
        await isTriviallySourceable(ctx, i, getConfigForScenario(ctx).transferCollateral) &&
        await usesAssetList(ctx) &&
        !(await isAssetDelisted(ctx, i)) &&
        await supportsExtendedPause(ctx);
      },
      cometBalances: async (ctx: CometContext) => (
        {
          albert: { 
            [`$asset${i}`]: getConfigForScenario(ctx).transferCollateral
          }
        }
      ),
    },
    async ({ comet, actors, cometExt }, context, world) => {
      const { albert, betty, pauseGuardian } = actors;
      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();

      // Fund pause guardian account for gas fees
      await fundAccount(world, pauseGuardian);

      // Pause specific collateral asset transfer at index i
      await cometExt.connect(pauseGuardian.signer).pauseCollateralAssetTransfer(i, true);

      // Allow betty to transfer asset from albert
      await albert.allow(betty, true);

      await expectRevertCustom(
        betty.transferAssetFrom({
          src: albert.address,
          dst: betty.address,
          asset: collateralAsset.address,
          amount: BigInt(getConfigForScenario(context).transferCollateral) * scale
        }),
        `CollateralAssetTransferPaused(${i})`
      );

      // Unpause specific collateral asset transfer at index i
      await cometExt.connect(pauseGuardian.signer).pauseCollateralAssetTransfer(i, false);

      // Save balances 
      const albertBalanceBefore = await comet.collateralBalanceOf(albert.address, collateralAsset.address);
      const bettyBalanceBefore = await comet.collateralBalanceOf(betty.address, collateralAsset.address);

      // Transfer asset from albert to betty
      await betty.transferAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: collateralAsset.address,
        amount: BigInt(getConfigForScenario(context).transferCollateral) * scale,
      });

      // Get balances after transfer
      const albertBalanceAfter = await comet.collateralBalanceOf(albert.address, collateralAsset.address);
      const bettyBalanceAfter = await comet.collateralBalanceOf(betty.address, collateralAsset.address);

      // Assert balances after transfer
      expect(albertBalanceAfter).to.be.equal(albertBalanceBefore.toBigInt() - BigInt(getConfigForScenario(context).transferCollateral) * scale);
      expect(bettyBalanceAfter).to.be.equal(bettyBalanceBefore.toBigInt() + BigInt(getConfigForScenario(context).transferCollateral) * scale);
    }
  );
}

scenario(
  'Comet#transfer reverts if borrow is less than minimum borrow',
  {
    filter: async (ctx) => await hasMinBorrowGreaterThanOne(ctx),
    cometBalances: {
      albert: { $base: 0, $asset0: 100 }
    }
  },
  async ({ comet, actors }, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const minBorrow = (await comet.baseBorrowMin()).toBigInt();

    await expectRevertCustom(
      albert.transferAsset({
        dst: betty.address,
        asset: baseAsset.address,
        amount: minBorrow / 2n
      }),
      'BorrowTooSmall()'
    );
  }
);

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#transferFrom reverts when collateral asset ${i} is deactivated`,
    {
      filter: async (ctx: CometContext) => {
        return await isValidAssetIndex(ctx, i) &&
          await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).transferCollateral) &&
          await usesAssetList(ctx) &&
          !(await isAssetDelisted(ctx, i)) &&
          await supportsExtendedPause(ctx);
      },
      cometBalances: async (ctx: CometContext) => (
        {
          albert: {
            [`$asset${i}`]: getConfigForScenario(ctx, i).transferCollateral
          }
        }
      ),
    },
    async ({ comet, actors, cometExt }, context, world) => {
      const { albert, betty, charles, pauseGuardian } = actors;
      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();

      // Fund pause guardian account for gas fees
      await fundAccount(world, pauseGuardian);

      // Deactivate collateral asset
      await cometExt.connect(pauseGuardian.signer).deactivateCollateral(i);

      // Allow betty to act on behalf of albert
      await albert.allow(betty, true);

      await expectRevertCustom(
        betty.transferAssetFrom({
          src: albert.address,
          dst: charles.address,
          asset: collateralAsset.address,
          amount: BigInt(getConfigForScenario(context, i).transferCollateral) * scale,
        }),
        `CollateralAssetTransferPaused(${i})`
      );
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#transfer reverts when collateral asset ${i} is deactivated`,
    {
      filter: async (ctx: CometContext) => {
        return await isValidAssetIndex(ctx, i) &&
          await isTriviallySourceable(ctx, i, getConfigForScenario(ctx).transferCollateral) &&
          await usesAssetList(ctx) &&
          !(await isAssetDelisted(ctx, i)) &&
          await supportsExtendedPause(ctx);
      },
      cometBalances: async (ctx: CometContext) => (
        {
          albert: {
            [`$asset${i}`]: getConfigForScenario(ctx).transferCollateral
          }
        }
      ),
    },
    async ({ comet, actors, cometExt }, context, world) => {
      const { albert, betty, pauseGuardian } = actors;
      const { asset, scale: scaleBN } = await comet.getAssetInfo(i);
      const collateralAsset = context.getAssetByAddress(asset);
      const scale = scaleBN.toBigInt();

      // Fund pause guardian account for gas fees
      await fundAccount(world, pauseGuardian);

      // Deactivate collateral asset
      await cometExt.connect(pauseGuardian.signer).deactivateCollateral(i);

      await expectRevertCustom(
        albert.transferAsset({
          dst: betty.address,
          asset: collateralAsset.address,
          amount: BigInt(getConfigForScenario(context).transferCollateral) * scale,
        }),
        `CollateralAssetTransferPaused(${i})`
      );
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#transfer base reverts after collateral supply and borrow for asset ${i}`,
    {
      filter: async (ctx) => 
        await isValidAssetIndex(ctx, i) && await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).supplyCollateral) && await usesAssetList(ctx) && !(await isAssetDelisted(ctx, i)) && await supportsExtendedPause(ctx),
      tokenBalances: async (ctx: CometContext) => ({
        albert: { $base: '== 0' },
        $comet: {
          $base: getConfigForScenario(ctx).withdrawBase
        }
      }),
    },
    async ({ comet, actors }, context) => {
      const { albert, betty } = actors;
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

      await expectRevertCustom(
        albert.transferAsset({
          dst: betty.address,
          asset: baseToken,
          amount: targetBorrowBaseWei,
        }),
        'NotCollateralized()'
      );
    }
  );
}

for (let i = 0; i < MAX_ASSETS; i++) {
  scenario(
    `Comet#transferFrom base reverts after collateral supply and borrow for asset ${i}`,
    {
      filter: async (ctx) =>
        await isValidAssetIndex(ctx, i) &&
        await isTriviallySourceable(ctx, i, getConfigForScenario(ctx, i).supplyCollateral) &&
        await usesAssetList(ctx) &&
        !(await isAssetDelisted(ctx, i)) &&
        await supportsExtendedPause(ctx),
      tokenBalances: async (ctx: CometContext) => ({
        albert: { $base: '== 0' },
        $comet: {
          $base: getConfigForScenario(ctx).withdrawBase,
        },
      }),
    },
    async ({ comet, actors }, context) => {
      const { albert, betty } = actors;
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

      // Calculate required collateral amount (same formula as transfer case)
      const collateralWeiPerUnitBase = (collateralScale * basePrice) / collateralPrice;
      let collateralNeeded = (collateralWeiPerUnitBase * targetBorrowBaseWei) / baseScale;
      collateralNeeded = (collateralNeeded * factorScale) / borrowCollateralFactor.toBigInt();
      collateralNeeded = (collateralNeeded * 11n) / 10n; // add fudge factor to ensure collateralization

      // 1. Source collateral tokens for albert
      await context.sourceTokens(collateralNeeded, collateralAsset, albert);

      // 2. Approve and supply collateral
      await collateralAsset.approve(albert, comet.address);
      await albert.safeSupplyAsset({ asset: collateralAsset.address, amount: collateralNeeded });

      // 3. Borrow base (albert becomes a borrower)
      await albert.withdrawAsset({ asset: baseToken, amount: targetBorrowBaseWei });

      // 4. Allow betty to act on behalf of albert
      await albert.allow(betty, true);

      // 5. transferFrom should now revert as undercollateralized
      await expectRevertCustom(
        betty.transferAssetFrom({
          src: albert.address,
          dst: betty.address,
          asset: baseToken,
          amount: targetBorrowBaseWei,
        }),
        'NotCollateralized()'
      );
    }
  );
}