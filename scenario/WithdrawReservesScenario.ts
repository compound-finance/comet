import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario(
  'Comet#withdrawReserves > governor withdraw reserves',
  {
    baseToken: {
      balance: 100,
    },
  },
  async ({ comet, actors, getAssetByAddress }) => {
    const { admin, albert } = actors;

    const baseToken = getAssetByAddress(await comet.baseToken());

    expect(await baseToken.balanceOf(comet.address)).to.equal(100n);
    await admin.withdrawReserves(albert, 10);
    expect(await baseToken.balanceOf(comet.address)).to.equal(90n);
  }
);

scenario(
  'Comet#withdrawReserves > reverts if not called by governor',
  {
    baseToken: {
      balance: 100,
    },
  },
  async ({ actors }) => {
    const { albert } = actors;
    await expect(albert.withdrawReserves(albert, 10)).to.be.revertedWith('Unauthorized');
  }
);

scenario(
  'Comet#withdrawReserves > reverts if not enough reserves are owned by protocol',
  {
    baseToken: {
      balance: 100,
    },
  },
  async ({ actors }) => {
    const { admin, albert } = actors;
    await expect(admin.withdrawReserves(albert, 101)).to.be.revertedWith(
      'VM Exception while processing transaction: reverted with panic code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)'
    );
  }
);
