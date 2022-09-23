import { scenario } from './context/CometContext';
import { expect } from 'chai';

scenario('initializes governor correctly', {}, async ({ comet, timelock }) => {
  // TODO: Make this more interesting.
  expect(await comet.governor()).to.equal(timelock.address);
});

scenario('has assets', {}, async ({ comet, assets }) => {
  let baseToken = await comet.baseToken();
  let numAssets = await comet.numAssets();
  let collateralAssets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));
  let contextAssets =
    Object.values(assets)
      .map((asset) => asset.address) // grab asset address
      .filter((address) => address.toLowerCase() !== baseToken.toLowerCase()); // filter out base token
  expect(collateralAssets.map(a => a.asset)).to.have.members(contextAssets);
});

scenario('requires upgrade', {}, async () => {
  // Nothing currently here
});
