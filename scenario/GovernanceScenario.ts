import { CometProperties, scenario } from './context/CometContext';
import { expect } from 'chai';
import { constants, utils } from 'ethers';
import { scaleToDecimals } from './utils';
import { CometModified__factory, CometModifiedFactory, CometModifiedFactory__factory } from '../build/types';
import { ConfigurationStruct } from '../build/types/CometModified';

scenario.only('upgrade Comet implementation', {}, async ({ comet, configurator, proxyAdmin, timelock, actors }, world, context) => {
  const { admin, albert } = actors;

  expect(await comet.governor()).to.equal(timelock.address);
  const configuration = await configurator.getConfiguration();

  // Deploy updated version of Comet Factory
  // XXX CHANGE THIS TO COMET FACTORY
  const dm = context.deploymentManager;
  // const cometModified = await dm.deploy<CometModified, CometModified__factory, [ConfigurationStruct]>(
  //   'test/CometModified.sol',
  //   [configuration]
  // );
  // let updatedRoots = await dm.getRoots();
  // updatedRoots.set('comet', cometModified.address);
  // await dm.putRoots(updatedRoots);
  // await dm.spider();

  const cometModifiedFactory = await dm.deploy<CometModifiedFactory, CometModifiedFactory__factory, []>(
    'test/CometModifiedFactory.sol',
    []
  );
  console.log('factory address is ', await cometModifiedFactory.address)

  console.log('old factory ', await configurator.factory())
  console.log('old comet ', await comet.address)

  let setFactoryCalldata = utils.defaultAbiCoder.encode(["address"], [cometModifiedFactory.address]);
  let deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(["address", "address"], [configurator.address, comet.address]);
  const txn = await context.fastGovernanceExecute(
    [configurator.address, proxyAdmin.address],
    [0, 0],
    ["setFactory(address)", "deployAndUpgradeTo(address,address)"],
    [setFactoryCalldata, deployAndUpgradeToCalldata]
  );

  await context.fastGovernanceExecute(
    [proxyAdmin.address],
    [0],
    ["deployAndUpgradeTo(address,address)"],
    [deployAndUpgradeToCalldata]
  );
  console.log('new factory ', await configurator.factory())
  // await dm.spider();

  const CometModified = await dm.hre.ethers.getContractFactory('CometModified');
  const modifiedComet = CometModified.attach(comet.address).connect(comet.signer);
  console.log('xxxx', modifiedComet.initialize)
  console.log('new comet ', await modifiedComet.address)

  console.log('before lp ', await modifiedComet.liquidatorPoints(constants.AddressZero))
  console.log(' comet stuff ', await modifiedComet.extensionDelegate())
  // await modifiedComet["initialize(address)"](constants.AddressZero);
  await modifiedComet.initialize(constants.AddressZero);
  console.log('after lp ', await modifiedComet.liquidatorPoints(constants.AddressZero))

  console.log('new function ', await modifiedComet.newFunction());
  // expect(await comet.governor()).to.equal(albert.address);
  // expect((await configurator.getConfiguration()).governor).to.be.equal(albert.address);
});
