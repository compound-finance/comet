import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario(
  'Comet#withdrawReserves > governor withdraw reserves',
  {
    tokenBalances: {
      $comet: { $base: 100 },
    },
    upgrade: true,
  },
  async ({ comet, actors }, world, context) => {
    const { admin, albert } = actors;

    const baseToken = context.getAssetByAddress(await comet.baseToken());
    const scale = (await comet.baseScale()).toBigInt();

    expect(await baseToken.balanceOf(comet.address)).to.equal(100n * scale);

    const txn = await admin.withdrawReserves(albert, 10n * scale);

    expect(await baseToken.balanceOf(comet.address)).to.equal(90n * scale);
    expect(await baseToken.balanceOf(albert.address)).to.equal(10n * scale);

    return txn; // return txn to measure gas
  }
);

scenario(
  'Comet#withdrawReserves > reverts if not called by governor',
  {
    tokenBalances: {
      $comet: { $base: 100 },
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
    tokenBalances: {
      $comet: { $base: 100 },
    },
    upgrade: true,
  },
  async ({ comet, actors }) => {
    const { admin, albert } = actors;

    const scale = (await comet.baseScale()).toBigInt();

    await expect(admin.withdrawReserves(albert, 101n * scale)).to.be.revertedWith("custom error 'InsufficientReserves()'");
  }
);

// XXX add scenario that tests for a revert when reserves are reduced by
// totalSupplyBase
