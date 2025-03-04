import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario('Comet#allow > allows a user to authorize a manager', {}, async ({ comet, actors }, context) => {
  const { albert, betty } = actors;

  await context.world.deploymentManager.hre.network.provider.send('evm_mine', []);

  const txn = await albert.allow(betty, true);

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;

  return txn; // return txn to measure gas
});

scenario('Comet#allow > allows a user to rescind authorization', {}, async ({ comet, actors }) => {
  const { albert, betty } = actors;

  await albert.allow(betty, true);

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.true;

  await albert.allow(betty, false);

  expect(await comet.isAllowed(albert.address, betty.address)).to.be.false;
});
