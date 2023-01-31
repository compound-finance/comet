import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario('initializes governor correctly', {}, async ({ comet, timelock }) => {
  // TODO: Make this more interesting.
  expect(await comet.governor()).to.equal(timelock.address);
});

scenario('has assets', {}, async ({ comet, assets }) => {
  const numAssets = await comet.numAssets();
  const collateralAssets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));
  const contextAssets = Object.values(assets);
  expect(contextAssets.map(a => a.address)).to.include.members(collateralAssets.map(a => a.asset));
});

scenario('requires upgrade', {}, async () => {
  // Nothing currently here
});
