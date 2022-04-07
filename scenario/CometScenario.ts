import { CometProperties, scenario } from './context/CometContext';
import { expect } from 'chai';

scenario('initializes governor correctly', {}, async ({ comet, timelock, actors }, world) => {
  // TODO: Make this more interesting.
  expect(await comet.governor()).to.equal(timelock.address);
});

scenario('Comet#allow > allows a user to authorize a manager', { upgrade: true }, async ({ comet, actors }) => {
  const { albert, betty } = actors;

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

scenario('has assets', {}, async ({ comet, actors, assets }: CometProperties, world) => {
  let baseToken = await comet.baseToken();
  let numAssets = await comet.numAssets();
  let collateralAssets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));
  let contextAssets =
    Object.values(assets)
      .map((asset) => asset.address) // grab asset address
      .filter((address) => address.toLowerCase() !== baseToken.toLowerCase()); // filter out base token
  expect(collateralAssets.map(a => a.asset)).to.have.members(contextAssets);
});

scenario('requires upgrade', { upgrade: true }, async ({ comet }, world) => {
  // Nothing currently here
});
