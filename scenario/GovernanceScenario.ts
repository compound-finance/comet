import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { constants, utils } from 'ethers';
import hreForBase from '../plugins/scenario/utils/hreForBase';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { COMP_WHALES } from "../src/deploy";

/*
make l2-only

*/

const FX_ROOT_GOERLI = '0x3d1d3E34f7fB6D26245E6640E1c50710eFFf15bA';

scenario.only('L2 Governance scenario', {}, async ({ comet }, context) => {
  // construct l1 deployment manager
  const l1Base = {
    name: 'goerli',
    network: 'goerli',
    deployment: 'usdc'
  };
  const l1Hre = hreForBase(l1Base)
  const l1DeploymentManager = new DeploymentManager("goerli", "usdc", l1Hre);

  // construct l1Governor and l1Proposer
  const l1Governor = await l1DeploymentManager.contract('governor');
  const compWhaleAddress = COMP_WHALES[0];
  await l1Hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [compWhaleAddress],
  });
  const l1Proposer = await l1DeploymentManager.getSigner(compWhaleAddress);

  const l2Timelock = await context.deploymentManager.contract('timelock');
  const polygonBridgeReceiver = await context.deploymentManager.contract('polygonBridgeReceiver');
  console.log(`polygonBridgeReceiver.address: ${polygonBridgeReceiver?.address}`);

  // construct l2 proposal
  const setDelayCalldata = utils.defaultAbiCoder.encode(['uint'], [5 * 24 * 60 * 60]);
  const encodedL2Data = utils.defaultAbiCoder.encode(
    ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
    [
      [l2Timelock?.address],
      [0],
      ["setDelay(uint)"],
      [setDelayCalldata]
    ]
  );

  const sendMessageToChildCalldata = utils.defaultAbiCoder.encode(
    ['address', 'bytes'],
    [polygonBridgeReceiver?.address, encodedL2Data]
  );

  // construct l1 proposal
  // fxRoot.sendMessageToChild(fxChildTunnel, message);
  const l1Targets = [FX_ROOT_GOERLI];
  const l1Values = [0];
  const l1Signatures = ["sendMessageToChild(address,bytes)"];
  const l1Calldata = [sendMessageToChildCalldata];

  // expect the delay to be 2 days
  // execute proposal
  // expect the delay to be 5 days

});

scenario('upgrade Comet implementation and initialize', {}, async ({ comet, configurator, proxyAdmin }, context) => {
  // For this scenario, we will be using the value of LiquidatorPoints.numAbsorbs for address ZERO to test that initialize has been called
  expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(0);

  // Deploy new version of Comet Factory
  const dm = context.deploymentManager;
  const cometModifiedFactory = await dm.deploy('cometFactory', 'test/CometModifiedFactory.sol', [], true);

  // Execute a governance proposal to:
  // 1. Set the new factory address in Configurator
  // 2. Deploy and upgrade to the new implementation of Comet
  // 3. Call initialize(address) on the new version of Comet
  const setFactoryCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [comet.address, cometModifiedFactory.address]);
  const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [configurator.address, comet.address]);
  const initializeCalldata = utils.defaultAbiCoder.encode(['address'], [constants.AddressZero]);
  await context.fastGovernanceExecute(
    [configurator.address, proxyAdmin.address, comet.address],
    [0, 0, 0],
    ['setFactory(address,address)', 'deployAndUpgradeTo(address,address)', 'initialize(address)'],
    [setFactoryCalldata, deployAndUpgradeToCalldata, initializeCalldata]
  );

  // LiquidatorPoints.numAbsorbs for address ZERO should now be set as UInt32.MAX
  expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(2 ** 32 - 1);
});

scenario('upgrade Comet implementation and initialize using deployUpgradeToAndCall', {}, async ({ comet, configurator, proxyAdmin }, context) => {
  // For this scenario, we will be using the value of LiquidatorPoints.numAbsorbs for address ZERO to test that initialize has been called
  expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(0);

  // Deploy new version of Comet Factory
  const dm = context.deploymentManager;
  const cometModifiedFactory = await dm.deploy(
    'cometFactory',
    'test/CometModifiedFactory.sol',
    [],
    true
  );

  // Execute a governance proposal to:
  // 1. Set the new factory address in Configurator
  // 2. DeployUpgradeToAndCall the new implementation of Comet
  const setFactoryCalldata = utils.defaultAbiCoder.encode(["address", "address"], [comet.address, cometModifiedFactory.address]);
  const modifiedComet = (await dm.hre.ethers.getContractFactory('CometModified')).attach(comet.address);
  const initializeCalldata = (await modifiedComet.populateTransaction.initialize(constants.AddressZero)).data;
  const deployUpgradeToAndCallCalldata = utils.defaultAbiCoder.encode(["address", "address", "bytes"], [configurator.address, comet.address, initializeCalldata]);

  await context.fastGovernanceExecute(
    [configurator.address, proxyAdmin.address],
    [0, 0],
    ["setFactory(address,address)", "deployUpgradeToAndCall(address,address,bytes)"],
    [setFactoryCalldata, deployUpgradeToAndCallCalldata]
  );

  // LiquidatorPoints.numAbsorbs for address ZERO should now be set as UInt32.MAX
  expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(2 ** 32 - 1);
});

scenario('upgrade Comet implementation and call new function', {}, async ({ comet, configurator, proxyAdmin, actors }, context) => {
  const { signer } = actors;

  // Deploy new version of Comet Factory
  const dm = context.deploymentManager;
  const cometModifiedFactory = await dm.deploy('cometFactory', 'test/CometModifiedFactory.sol', [], true);

  // Upgrade Comet implementation
  const setFactoryCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [comet.address, cometModifiedFactory.address]);
  const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [configurator.address, comet.address]);
  await context.fastGovernanceExecute(
    [configurator.address, proxyAdmin.address],
    [0, 0],
    ['setFactory(address,address)', 'deployAndUpgradeTo(address,address)'],
    [setFactoryCalldata, deployAndUpgradeToCalldata]
  );

  const CometModified = await dm.hre.ethers.getContractFactory('CometModified');
  const modifiedComet = CometModified.attach(comet.address).connect(signer.signer);

  // Call new functions on Comet
  await modifiedComet.initialize(constants.AddressZero);
  expect(await modifiedComet.newFunction()).to.be.equal(101n);
});
