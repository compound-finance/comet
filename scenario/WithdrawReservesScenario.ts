import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario(
  'Comet#withdrawReserves > governor withdraw reserves',
  {
    baseToken: {
      balance: 100,
    },
    upgrade: true,
  },
  async ({ comet, actors }, world, context) => {
    const { admin, albert } = actors;

    const baseToken = context.getAssetByAddress(await comet.baseToken());

    expect(await baseToken.balanceOf(comet.address)).to.equal(100n);

    const txn = await admin.withdrawReserves(albert, 10);

    expect(await baseToken.balanceOf(comet.address)).to.equal(90n);
    expect(await baseToken.balanceOf(albert.address)).to.equal(10n);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawReserves > reverts if not called by governor',
  {
    baseToken: {
      balance: 100,
    },
    upgrade: true,
  },
  async ({ actors }) => {
    const { albert } = actors;
    await expect(albert.withdrawReserves(albert, 10)).to.be.revertedWith(
      "custom error 'Unauthorized()'"
    );
  }
);

scenario(
  'Comet#withdrawReserves > reverts if not enough reserves are owned by protocol',
  {
    baseToken: {
      balance: 100,
    },
    upgrade: true,
  },
  async ({ actors }) => {
    const { admin, albert } = actors;

    await expect(admin.withdrawReserves(albert, 101)).to.be.revertedWith("custom error 'InsufficientReserves()'");
  }
);

// XXX add scenario that tests for a revert when reserves are reduced by
// totalSupplyBase
