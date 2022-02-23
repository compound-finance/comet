import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';
import { AssetInfoStruct } from '../build/types/CometHarness';
import { AssetConfigStruct } from '../build/types/CometFactory';

scenario.only('upgrade governor', {}, async ({ comet, proxyAdmin, actors }, world) => {
  const { admin, albert } = actors;

  expect(await comet.governor()).to.equal(admin.address);

  await proxyAdmin.setGovernor(comet.address, albert.address);
  await proxyAdmin.deployAndUpgradeTo(comet.address);

  expect(await comet.governor()).to.equal(albert.address);
});

scenario.only('add assets', {}, async ({ comet, proxyAdmin, actors, assets }: CometContext, world) => {
  let numAssets = await comet.numAssets();
  let collateralAssets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));
  let contextAssets =
    Object.values(collateralAssets)
      .map((asset) => asset.asset); // grab asset address
  expect(collateralAssets.map(a => a.asset)).to.have.members(contextAssets);

  // Add new asset and deploy + upgrade
  let newAsset = await comet.getAssetInfo(0);
  let newAssetConfig = {
    asset: newAsset.asset,
    priceFeed: newAsset.priceFeed,
    decimals: (8).toString(),
    borrowCollateralFactor: (0.9e18).toString(),
    liquidateCollateralFactor: (1e18).toString(),
    liquidationFactor: (0.95e18).toString(),
    supplyCap: (1000000e8).toString(),
  };
  await proxyAdmin.addAsset(comet.address, newAssetConfig);
  await proxyAdmin.deployAndUpgradeTo(comet.address);

  // Verify new asset is added
  numAssets = await comet.numAssets();
  let updatedCollateralAssets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));
  let updatedContextAssets =
    Object.values(updatedCollateralAssets)
      .map((asset) => asset.asset); // grab asset address
  expect(updatedCollateralAssets.length).to.equal(collateralAssets.length + 1);
  expect(updatedCollateralAssets.map(a => a.asset)).to.have.members(updatedContextAssets);
});

// XXX need to have an instance of the proxy contract
scenario('reverts if not called by ProxyAdmin', {}, async ({ comet, proxyAdmin, actors }, world) => {
});

scenario('fallbacks to implementation if called by non-admin', {}, async ({ comet, proxyAdmin, actors }, world) => {
});