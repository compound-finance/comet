import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { World } from '../plugins/scenario';

scenario('initializes governor correctly', {}, async ({ comet, actors }, world) => {
  // TODO: Make this more interesting, plus the admin here isn't right for mainnet, etc.
  expect(await comet.governor()).to.equal(actors['admin']!.address);
});

scenario(
  'Comet#allow > allows a user to authorize a manager',
  {},
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    await albert.allow(betty, true);

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;
  }
);

scenario(
  'Comet#allow > allows a user to rescind authoization',
  {},
  async ({ comet, actors }) => {
    const { albert, betty } = actors;

    await albert.allow(betty, true);

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;

    await albert.allow(betty, false);

    expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;
  }
);