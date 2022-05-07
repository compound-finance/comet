import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { expectApproximately, getExpectedBaseBalance } from './utils';

// XXX consider creating these tests for assets0-15
scenario(
  'Comet#transfer > collateral asset, enough balance',
  {
    upgrade: true,
    cometBalances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);

    // Albert transfers 50 units of collateral to Betty
    const toTransfer = scale.toBigInt() * 50n;
    const txn = await albert.transferAsset({ dst: betty.address, asset: collateralAsset.address, amount: toTransfer });

    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(scale.mul(50));
    expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(scale.mul(50));

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#transfer > base asset, enough balance',
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

    // Albert transfers 50 units of collateral to Betty
    const toTransfer = 50n * scale;
    const txn = await albert.transferAsset({ dst: betty.address, asset: baseAsset.address, amount: toTransfer });

    const baseIndexScale = (await comet.baseIndexScale()).toBigInt();
    const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex.toBigInt();
    const baseSupplied = getExpectedBaseBalance(100n * scale, baseIndexScale, baseSupplyIndex);
    const baseTransferred = getExpectedBaseBalance(50n * scale, baseIndexScale, baseSupplyIndex);
    const baseOfTransferrer = getExpectedBaseBalance(baseSupplied - toTransfer, baseIndexScale, baseSupplyIndex)

    expect(await comet.balanceOf(albert.address)).to.be.equal(baseOfTransferrer);
    expect(await comet.balanceOf(betty.address)).to.be.equal(baseTransferred);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#transfer > base asset, total and user balances are summed up properly',
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
    upgrade: true,
    cometBalances: {
      albert: { $base: 10, $asset0: 50 }, // in units of asset, not wei
      betty: { $base: -10 },
      charles: { $base: 1000 }, // to give the protocol enough base for others to borrow from
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 1_000_000n; // 1e-6 asset units of precision

    expectApproximately(await albert.getCometBaseBalance(), 10n * scale, precision);
    expectApproximately(await betty.getCometBaseBalance(), -10n * scale, precision);

    // Albert with positive balance transfers to Betty with negative balance
    const toTransfer = 15n * scale;
    const txn = await albert.transferAsset({ dst: betty.address, asset: baseAsset.address, amount: toTransfer });

    // Albert ends with negative balance and Betty with positive balance
    expectApproximately(await albert.getCometBaseBalance(), -5n * scale, precision);
    expectApproximately(await betty.getCometBaseBalance(), 5n * scale, precision);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#transferFrom > withdraw to repay',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 10, $asset0: 50 }, // in units of asset, not wei
      betty: { $base: -10 },
      charles: { $base: 1000 }, // to give the protocol enough base for others to borrow from
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 100_000n; // 1e-5 asset units of precision

    expectApproximately(await albert.getCometBaseBalance(), 10n * scale, precision);
    expectApproximately(await betty.getCometBaseBalance(), -10n * scale, precision);

    await albert.allow(betty, true);

    // Betty withdraws from Albert to repay her own borrows
    const toTransfer = 5n * scale;
    const txn = await betty.transferAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: toTransfer });

    expectApproximately(await albert.getCometBaseBalance(), 5n * scale, precision);
    expectApproximately(await betty.getCometBaseBalance(), -5n * scale, precision);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#transfer base reverts if undercollateralized',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 100, $asset0: 0.000001 }, // in units of asset, not wei
      betty: { $base: -100 },
      charles: { $base: 1000 }, // to give the protocol enough base for others to borrow from
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 1_000_000n; // 1e-6 asset units of precision

    expectApproximately(await albert.getCometBaseBalance(), 100n * scale, precision);
    expectApproximately(await betty.getCometBaseBalance(), -100n * scale, precision);

    // Albert with positive balance transfers to Betty with negative balance
    const toTransfer = 150n * scale;
    await expect(
      albert.transferAsset({
        dst: betty.address,
        asset: baseAsset.address,
        amount: toTransfer,
      })
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
  }
);

scenario(
  'Comet#transferFrom base reverts if undercollateralized',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 100, $asset0: 0.000001 }, // in units of asset, not wei
      betty: { $base: -100 },
      charles: { $base: 1000 }, // to give the protocol enough base for others to borrow from
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();
    const precision = scale / 1_000_000n; // 1e-6 asset units of precision

    expectApproximately(await albert.getCometBaseBalance(), 100n * scale, precision);
    expectApproximately(await betty.getCometBaseBalance(), -100n * scale, precision);

    await albert.allow(betty, true);

    // Albert with positive balance transfers to Betty with negative balance
    const toTransfer = 150n * scale;
    await expect(
      betty.transferAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: toTransfer,
      })
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
  }
);

scenario(
  'Comet#transfer collateral reverts if undercollateralized',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: -100, $asset0: 100 }, // in units of asset, not wei
      betty: { $asset0: 0 },
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    // Albert transfers all his collateral to Betty
    await expect(
      albert.transferAsset({
        dst: betty.address,
        asset: collateralAsset.address,
        amount: 100n * scale,
      })
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
  }
);

scenario(
  'Comet#transferFrom collateral reverts if undercollateralized',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: -100, $asset0: 100 }, // in units of asset, not wei
      betty: { $asset0: 0 },
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale: scaleBN } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);
    const scale = scaleBN.toBigInt();

    await albert.allow(betty, true);

    // Betty transfers all of Albert's collateral to herself
    await expect(
      betty.transferAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: collateralAsset.address,
        amount: 100n * scale,
      })
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
  }
);

scenario(
  'Comet#transfer disallows self-transfer of base',
  {
    upgrade: true,
  },
  async ({ comet, actors }) => {
    const { albert } = actors;

    const baseToken = await comet.baseToken();

    await expect(
      albert.transferAsset({
        dst: albert.address,
        asset: baseToken,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
  }
);

scenario(
  'Comet#transfer disallows self-transfer of collateral',
  {
    upgrade: true,
  },
  async ({ comet, actors }) => {
    const { albert } = actors;

    const collateralAsset = await comet.getAssetInfo(0);

    await expect(
      albert.transferAsset({
        dst: albert.address,
        asset: collateralAsset.asset,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
  }
);

scenario(
  'Comet#transferFrom disallows self-transfer of base',
  {
    upgrade: true,
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expect(
      albert.transferAssetFrom({
        src: betty.address,
        dst: betty.address,
        asset: baseToken,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
  }
);

scenario(
  'Comet#transferFrom disallows self-transfer of collateral',
  {
    upgrade: true,
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const collateralAsset = await comet.getAssetInfo(0);

    await betty.allow(albert, true);

    await expect(
      albert.transferAssetFrom({
        src: betty.address,
        dst: betty.address,
        asset: collateralAsset.asset,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
  }
);

scenario(
  'Comet#transferFrom reverts if operator not given permission',
  {
    upgrade: true,
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = (await comet.baseScale()).toBigInt();

    await expect(
      betty.transferAssetFrom({
        src: albert.address,
        dst: betty.address,
        asset: baseAsset.address,
        amount: 1n * scale,
      })
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  }
);

scenario(
  'Comet#transfer reverts when transfer is paused',
  {
    upgrade: true,
    pause: {
      transferPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expect(
      albert.transferAsset({
        dst: betty.address,
        asset: baseToken,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'Paused()'");
  }
);

scenario(
  'Comet#transferFrom reverts when transfer is paused',
  {
    upgrade: true,
    pause: {
      transferPaused: true,
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    const baseToken = await comet.baseToken();

    await betty.allow(albert, true);

    await expect(
      albert.transferAssetFrom({
        src: betty.address,
        dst: albert.address,
        asset: baseToken,
        amount: 100,
      })
    ).to.be.revertedWith("custom error 'Paused()'");
  }
);

scenario(
  'Comet#transfer reverts if borrow is less than minimum borrow',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 0, $asset0: 100 }
    }
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const minBorrow = (await comet.baseBorrowMin()).toBigInt();

    await expect(
      albert.transferAsset({
        dst: betty.address,
        asset: baseAsset.address,
        amount: minBorrow / 2n
      })
    ).to.be.revertedWith("custom error 'BorrowTooSmall()'");
  }
);