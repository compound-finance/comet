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

scenario.only('upgrade Comet implementation 2', {}, async ({ comet, configurator, proxyAdmin, timelock, actors }, world, context) => {
  console.log('start scenario')
  const { admin, albert } = actors;

  expect(await comet.governor()).to.equal(timelock.address);
  const configuration = await configurator.getConfiguration();

  // Deploy new version of Comet Factory
  const dm = context.deploymentManager;

  console.log('txns before factory: ', await (await dm.getSigner()).getTransactionCount());
  const cometModifiedFactory = await dm.deploy<CometModifiedFactory, CometModifiedFactory__factory, []>(
    'test/CometModifiedFactory.sol',
    []
  );
  console.log('txns after factory: ', await (await dm.getSigner()).getTransactionCount());

  // await dm.spider() // should be fine to spider here (just testing that it works) WORKS
  // console.log('old factory ', await configurator.factory())
  // console.log('old comet ', await comet.address)

  let setFactoryCalldata = utils.defaultAbiCoder.encode(["address"], [cometModifiedFactory.address]);
  let deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(["address", "address"], [configurator.address, comet.address]);
  await context.fastGovernanceExecute(
    [configurator.address, proxyAdmin.address],
    [0, 0],
    ["setFactory(address)", "deployAndUpgradeTo(address,address)"],
    [setFactoryCalldata, deployAndUpgradeToCalldata]
  );
  console.log('txns after gov execute: ', await (await dm.getSigner()).getTransactionCount());

  // const cometImplAddrRaw = await dm.hre.ethers.provider.getStorageAt(comet.address, '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc');
  // const cometImplAddr = utils.getAddress('0x' + cometImplAddrRaw.substring(26));

  // console.log('comet impl addr ', cometImplAddr)
  // await dm.putBuild('test/CometModified.sol', cometImplAddr) // THIS NEEDS TO BE THE IMPLEMENTATION ADDRESS

  // console.log('new factory ', await configurator.factory())
  // await dm.spider(); // XXX SPIDER DOESN'T WORK BECAUSE IT TRIES TO GET ABI FOR COMET IMPL FROM ETHERSCAN. I NEED TO INSERT THE BUILDFILE FOR THIS CONTRACT
  // XXX we need a way to update both contract and build cache with CometModified in dm
  // await dm.updateContractInterface(comet.)

  // const modifiedComet = await dm.contract('comet');
  // const modifiedComet = await context.getContract<CometModified>('comet')
  const CometModified = await dm.hre.ethers.getContractFactory('CometModified');
  const modifiedComet = CometModified.attach(comet.address).connect(await dm.getSigner());
  // const modifiedComet = CometModified.attach(comet.address).connect(await dm.getSigner());
  console.log('xxxx', await modifiedComet.initialize)
  console.log('new comet ', await modifiedComet.address)

  // expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(0);

  // console.log('before lp ', await modifiedComet.liquidatorPoints(constants.AddressZero))
  // await modifiedComet["initialize(address)"](constants.AddressZero);
  console.log('pending txns: ', await (await dm.getSigner()).getTransactionCount('pending'));
  // let tx = await modifiedComet.populateTransaction.initialize(constants.AddressZero);
  const txn2 = await modifiedComet.initialize(constants.AddressZero);
  // console.log('tbd nonce is: ', tx.nonce)
  // console.log('after lp ', await modifiedComet.liquidatorPoints(constants.AddressZero))

  // expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(2 ** 32 - 1);

  // console.log('new function ', await modifiedComet.newFunction());
  // expect(await comet.governor()).to.equal(albert.address);
  // expect((await configurator.getConfiguration()).governor).to.be.equal(albert.address);
});
