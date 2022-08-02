import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { scaleToDecimals } from './utils';

scenario('upgrade governor', {}, async ({ comet, configurator, proxyAdmin, timelock, actors }, context) => {
  const { admin, albert } = actors;

  expect(await comet.governor()).to.equal(timelock.address);
  expect((await configurator.getConfiguration(comet.address)).governor).to.equal(timelock.address);

  await context.setNextBaseFeeToZero();
  await configurator.connect(admin.signer).setGovernor(comet.address, albert.address, { gasPrice: 0 });
  await context.setNextBaseFeeToZero();
  await admin.deployAndUpgradeTo(configurator.address, comet.address, { gasPrice: 0 });

  expect(await comet.governor()).to.equal(albert.address);
  expect((await configurator.getConfiguration(comet.address)).governor).to.be.equal(albert.address);
});

scenario('add assets', {}, async ({ comet, configurator, proxyAdmin, actors }, context) => {
  const { admin } = actors;
  let numAssets = await comet.numAssets();
  const collateralAssets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));
  const contextAssets =
    Object.values(collateralAssets)
      .map((asset) => asset.asset); // grab asset address
  expect(collateralAssets.map(a => a.asset)).to.have.members(contextAssets);

  // Add new asset and deploy + upgrade
  const newAsset = await comet.getAssetInfo(0);
  const newAssetDecimals = scaleToDecimals(newAsset.scale); // # of 0's in scale
  const newAssetConfig = {
    asset: newAsset.asset,
    priceFeed: newAsset.priceFeed,
    decimals: newAssetDecimals.toString(),
    borrowCollateralFactor: (0.9e18).toString(),
    liquidateCollateralFactor: (1e18).toString(),
    liquidationFactor: (0.95e18).toString(),
    supplyCap: (1000000e8).toString(),
  };
  await context.setNextBaseFeeToZero();
  await configurator.connect(admin.signer).addAsset(comet.address, newAssetConfig, { gasPrice: 0 });
  await context.setNextBaseFeeToZero();
  await admin.deployAndUpgradeTo(configurator.address, comet.address, { gasPrice: 0 });

  // Verify new asset is added
  numAssets = await comet.numAssets();
  const updatedCollateralAssets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));
  const updatedContextAssets =
    Object.values(updatedCollateralAssets)
      .map((asset) => asset.asset); // grab asset address
  expect(updatedCollateralAssets.length).to.equal(collateralAssets.length + 1);
  expect(updatedCollateralAssets.map(a => a.asset)).to.have.members(updatedContextAssets);
});

// XXX Hardhat currently can't parse custom errors from external contracts. We can use `upgrade: true` and
// have an option for the ModernConstraint to also re-deploy proxies.
// https://github.com/NomicFoundation/hardhat/issues/1618
scenario.skip(
  'reverts if configurator is not called by admin',
  {},
  async ({ comet, configurator, proxyAdmin, actors }) => {
    const { albert } = actors;

    await expect(configurator.connect(albert.signer).setGovernor(comet.address, albert.address)).to.be.revertedWith(
      'Unauthorized'
    );
  });

scenario.skip('reverts if proxy is not upgraded by ProxyAdmin', {}, async ({ comet, proxyAdmin, actors }) => {
  // XXX
});


scenario.skip('fallbacks to implementation if called by non-admin', {}, async ({ comet, proxyAdmin, actors }) => {
  // XXX
});

scenario.skip('transfer admin of configurator', {}, async ({ comet, proxyAdmin, actors }) => {
  // XXX
});
