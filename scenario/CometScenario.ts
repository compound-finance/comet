import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { World } from '../plugins/scenario';

scenario('initializes governor correctly', {}, async ({ comet, actors }, world) => {
  // TODO: Make this more interesting, plus the admin here isn't right for mainnet, etc.
  expect(await comet.governor()).to.equal(actors['admin']!.address);
  expect(await comet.baseMinForRewards()).to.equal(1); // XXX
});

scenario('Comet#allow > allows a user to authorize a manager', {}, async ({ comet, actors }) => {
  const { albert, betty } = actors;

  await albert.allow(betty, true);

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;
});

scenario('Comet#allow > allows a user to rescind authoization', {}, async ({ comet, actors }) => {
  const { albert, betty } = actors;

  await albert.allow(betty, true);

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;

  await albert.allow(betty, false);

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;
});

scenario('has assets', {}, async ({ comet, actors, assets }, world) => {
  expect(await comet.assetAddresses()).to.have.members(Object.values(assets).map((asset) => asset.address));
});

scenario('requires upgrade', { upgrade: true }, async ({ comet }, world) => {
  // Nothing currently here
});
