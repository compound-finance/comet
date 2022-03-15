import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario(
  'Comet#transfer > collateral asset, enough balance',
  {
    upgrade: true,
    balances: {
      albert: { asset$0: 100 }, // in units of asset, not wei
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
  'Comet#transfer > partial withdraw / borrow base to partial repay / supply',
  {
    upgrade: true,
    balances: {
      // albert: { USDC: exp(50, 6) },
      // betty: { USDC: exp(-50, 6) }
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;
    // XXX
    //await albert.transferAsset(betty, USDC, exp(100, 6));
  }
);

scenario(
  'Comet#transferFrom > withdraw to repay',
  {
    upgrade: true,
    balances: {
      // albert: { USDC: exp(100, 6) },
      // betty: { USDC: exp(-100, 6) },
    },
  },
  async ({ comet, actors }) => {
    const { albert, betty, charles } = actors;
    // XXX
    //await albert.allow(charles, true);
    //await charles.transferAssetFrom(albert, better, USDC, exp(100, 6));
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