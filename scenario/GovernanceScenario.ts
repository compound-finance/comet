import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { constants, utils } from 'ethers';
import hreForBase from '../plugins/scenario/utils/hreForBase';
import { DeploymentManager } from '../plugins/deployment_manager/DeploymentManager';
import { COMP_WHALES } from "../src/deploy";
import { ProposalState, OpenProposal } from './context/Gov';

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

  console.log(`await l2Timelock?.delay(): ${await l2Timelock?.delay()}`);
  expect(await l2Timelock?.delay()).to.eq(2 * 24 * 60 * 60);

  async function setNextL1BaseFeeToZero() {
    await l1Hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);
  }

  async function setNextL1BlockTimestamp(timestamp: number) {
    await l1Hre.ethers.provider.send('evm_setNextBlockTimestamp', [timestamp]);
  }

  async function mineL1Blocks(blocks: number) {
    await l1Hre.network.provider.send('hardhat_mine', [`0x${blocks.toString(16)}`]);
  }

  await setNextL1BaseFeeToZero();

  // propose
  const proposeTxn = await (
    await l1Governor?.connect(l1Proposer).propose(
      l1Targets,
      l1Values,
      l1Signatures,
      l1Calldata,
      'FastExecuteProposal',
      { gasPrice: 0 }
    )
  ).wait();
  const proposeEvent = proposeTxn.events.find(event => event.event === 'ProposalCreated');
  const [id, , , , , , startBlock, endBlock] = proposeEvent.args;

  // execute open proposal
  // const governor = await this.getGovernor();
  const blockNow = await l1Hre.ethers.provider.getBlockNumber();
  const blocksUntilStart = startBlock - blockNow;
  const blocksUntilEnd = endBlock - Math.max(startBlock, blockNow);

  if (blocksUntilStart > 0) {
    await mineL1Blocks(blocksUntilStart);
  }

  if (blocksUntilEnd > 0) {
    for (const whale of COMP_WHALES) {
      try {
        // Voting can fail if voter has already voted

        // const voter = await this.world.impersonateAddress(whale);
        await l1Hre.network.provider.request({
          method: 'hardhat_impersonateAccount',
          params: [whale],
        });
        const voter = await l1DeploymentManager.getSigner(whale);
        await setNextL1BaseFeeToZero();
        await l1Governor?.connect(voter).castVote(id, 1, { gasPrice: 0 });
      } catch (err) {
        console.log(`Error while voting for ${whale}`, err.message);
      }
    }
    await mineL1Blocks(blocksUntilEnd);
  }

  // Queue proposal (maybe)
  const state = await l1Governor?.state(id);
  if (state == ProposalState.Succeeded) {
    await setNextL1BaseFeeToZero();
    await l1Governor?.queue(id, { gasPrice: 0 });
  }

  const proposal = await l1Governor?.proposals(id);
  await setNextL1BlockTimestamp(proposal.eta.toNumber() + 1);

  // Execute proposal (w/ gas limit so we see if exec reverts, not a gas estimation error)
  await setNextL1BaseFeeToZero();
  await l1Governor?.execute(id, { gasPrice: 0, gasLimit: 12000000 });

  // listen on events on the fxRoot

  // impersonate the l2 bridge contract; pass the event data from l1 event

  // expect the delay to be 5 days
  console.log(`await l2Timelock?.delay(): ${await l2Timelock?.delay()}`);
  expect(await l2Timelock?.delay()).to.eq(5 * 24 * 60 * 60);
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
