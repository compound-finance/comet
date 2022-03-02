import { CometContext, scenario } from './context/CometContext';
import { expect } from 'chai';
import { filterEvent, wait } from '../test/helpers';
import { utils } from 'ethers';

function getNewCometAddress(tx): string {
  let event = filterEvent(tx, 'CometDeployed');
  let [newCometAddr] = event.args;
  return newCometAddr;
}

scenario.only('upgrade governor', {}, async ({ comet, configurator, proxyAdmin, proxyAdminAdmin, timelock, actors }, world) => {
  const { admin, albert } = actors;

  expect(await comet.governor()).to.equal(admin.address);
  expect((await configurator.getConfiguration()).governor).to.equal(admin.address);

  let setGovernorCalldata = utils.defaultAbiCoder.encode(["address"], [albert.address]);
  let deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(["address", "address", "address"], [proxyAdmin.address, configurator.address, comet.address]);
  await timelock.execute(
    [configurator.address, proxyAdminAdmin.address],
    [0, 0],
    ["setGovernor(address)", "deployAndUpgradeTo(address,address,address)"],
    [setGovernorCalldata, deployAndUpgradeToCalldata]
  );

  expect(await comet.governor()).to.equal(albert.address);
  expect((await configurator.getConfiguration()).governor).to.be.equal(albert.address);
});

// XXX Get this working
scenario.skip('add assets', {}, async ({ comet, configurator, proxyAdmin, actors, assets }: CometContext, world) => {
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
  await configurator.addAsset(newAssetConfig);
  let tx = await wait(await configurator.deploy());
  let newCometAddr = getNewCometAddress(tx);
  await proxyAdmin.upgrade(comet.address, newCometAddr)

  // Verify new asset is added
  numAssets = await comet.numAssets();
  let updatedCollateralAssets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));
  let updatedContextAssets =
    Object.values(updatedCollateralAssets)
      .map((asset) => asset.asset); // grab asset address
  expect(updatedCollateralAssets.length).to.equal(collateralAssets.length + 1);
  expect(updatedCollateralAssets.map(a => a.asset)).to.have.members(updatedContextAssets);
});

scenario.only('reverts if configurator is not called by admin', {}, async ({ comet, configurator, proxyAdmin, actors }, world) => {
  const { albert } = actors;

  await expect(configurator.connect(albert.signer).setGovernor(albert.address)).to.be.revertedWith(
    'Unauthorized'
  );
});

scenario('reverts if proxy is not upgraded by ProxyAdmin', {}, async ({ comet, proxyAdmin, actors }, world) => {
});


scenario('fallbacks to implementation if called by non-admin', {}, async ({ comet, proxyAdmin, actors }, world) => {
});

scenario('transfer admin of configurator', {}, async ({ comet, proxyAdmin, actors }, world) => {
});
