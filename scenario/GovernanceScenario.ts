import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { constants, utils } from 'ethers';
import { CometModifiedFactory, CometModifiedFactory__factory } from '../build/types';

scenario('upgrade Comet implementation and initialize', {}, async ({ comet, configurator, proxyAdmin }, world, context) => {
  // For this scenario, we will be using the value of LiquidatorPoints.numAbsorbs for address ZERO to test that initialize has been called
  expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(0);

  // Deploy new version of Comet Factory
  const dm = context.deploymentManager;
  const cometModifiedFactory = await dm.deploy<CometModifiedFactory, CometModifiedFactory__factory, []>(
    'test/CometModifiedFactory.sol',
    []
  );

  // Execute a governance proposal to:
  // 1. Set the new factory address in Configurator
  // 2. Deploy and upgrade to the new implementation of Comet
  // 3. Call initialize(address) on the new version of Comet
  let setFactoryCalldata = utils.defaultAbiCoder.encode(["address"], [cometModifiedFactory.address]);
  let deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(["address", "address"], [configurator.address, comet.address]);
  let initializeCalldata = utils.defaultAbiCoder.encode(["address"], [constants.AddressZero]);
  await context.fastGovernanceExecute(
    [configurator.address, proxyAdmin.address, comet.address],
    [0, 0, 0],
    ["setFactory(address)", "deployAndUpgradeTo(address,address)", "initialize(address)"],
    [setFactoryCalldata, deployAndUpgradeToCalldata, initializeCalldata]
  );

  // LiquidatorPoints.numAbsorbs for address ZERO should now be set as UInt32.MAX
  expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(2 ** 32 - 1);
});
