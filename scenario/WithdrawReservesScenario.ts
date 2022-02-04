import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { World } from '../plugins/scenario';

scenario(
  'Comet#withdrawReserves > governor withdraw reserves',
  {
    baseToken: {
      balance: 100,
    },
    upgrade: true,
  },
  async ({ comet, actors, getAssetByAddress }, world: World) => {
    const { admin, albert } = actors;

    const baseToken = getAssetByAddress(await comet.baseToken());

    expect(await baseToken.balanceOf(comet.address)).to.equal(100n);

    await admin.withdrawReserves(albert, 10);

    expect(await baseToken.balanceOf(comet.address)).to.equal(90n);
    expect(await baseToken.balanceOf(albert.address)).to.equal(10n);
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
    await expect(albert.withdrawReserves(albert, 10)).to.be.revertedWith('Unauthorized');
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

    // XXX specify the desired revert message (differs across deployments, currently)
    await expect(admin.withdrawReserves(albert, 101)).to.be.reverted;
  }
);
