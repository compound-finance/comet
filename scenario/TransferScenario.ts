import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { expectApproximately } from './utils';

// XXX consider creating these tests for assets0-15
scenario(
  'Comet#transfer > collateral asset, enough balance',
  {
    upgrade: true,
    balances: {
      albert: { $asset0: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const { asset: asset0Address, scale } = await comet.getAssetInfo(0);
    const collateralAsset = context.getAssetByAddress(asset0Address);

    expect(await collateralAsset.balanceOf(albert.address)).to.be.equal(scale.toBigInt() * 100n);

    // Albert supplies 100 units of collateral to Comet
    await collateralAsset.approve(albert, comet.address);
    await albert.supplyAsset({asset: collateralAsset.address, amount: scale.toBigInt() * 100n})

    // Albert transfers 50 units of collateral to Betty
    const toTransfer = scale.toBigInt() * 50n;
    const txn = await albert.transferAsset({dst: betty.address, asset: collateralAsset.address, amount: toTransfer});

    expect(await comet.collateralBalanceOf(albert.address, collateralAsset.address)).to.be.equal(scale.mul(50));
    expect(await comet.collateralBalanceOf(betty.address, collateralAsset.address)).to.be.equal(scale.mul(50));

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#transfer > base asset, enough balance',
  {
    upgrade: true,
    balances: {
      albert: { $base: 100 }, // in units of asset, not wei
    },
  },
  async ({ comet, actors }, world, context) => {
    const { albert, betty } = actors;
    const baseAssetAddress = await comet.baseToken();
    const baseAsset = context.getAssetByAddress(baseAssetAddress);
    const scale = await comet.baseScale();

    console.log('base asset is ', await baseAsset.token.symbol())

    expect(await baseAsset.balanceOf(albert.address)).to.be.equal(scale.toBigInt() * 100n);

    // Albert supplies 100 units of collateral to Comet
    await baseAsset.approve(albert, comet.address);
    await albert.supplyAsset({asset: baseAsset.address, amount: scale.toBigInt() * 100n})

    // Albert transfers 50 units of collateral to Betty
    const toTransfer = scale.toBigInt() * 50n;
    const txn = await albert.transferAsset({dst: betty.address, asset: baseAsset.address, amount: toTransfer});

    expect(await comet.balanceOf(albert.address)).to.be.equal(scale.mul(50));
    expect(await comet.balanceOf(betty.address)).to.be.equal(scale.mul(50));

    return txn; // return txn to measure gas
  }
);

scenario.only(
  'Comet#transfer > partial withdraw / borrow base to partial repay / supply',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 100, $asset0: 1_000 }, // in units of asset, not wei
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
    await albert.transferAsset({ dst: betty.address, asset: baseAsset.address, amount: toTransfer })

    // Albert ends with negative balance and Betty with positive balance
    expectApproximately(await albert.getCometBaseBalance(), -50n * scale, precision);
    expectApproximately(await betty.getCometBaseBalance(), 50n * scale, precision);
  }
);

scenario.only(
  'Comet#transferFrom > withdraw to repay',
  {
    upgrade: true,
    cometBalances: {
      albert: { $base: 100, $asset0: 1_000 }, // in units of asset, not wei
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

    // Betty withdraws from Albert to repay her own borrows
    const toTransfer = 50n * scale;
    await betty.transferAssetFrom({ src: albert.address, dst: betty.address, asset: baseAsset.address, amount: toTransfer })

    expectApproximately(await albert.getCometBaseBalance(), 50n * scale, precision);
    expectApproximately(await betty.getCometBaseBalance(), -50n * scale, precision);
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