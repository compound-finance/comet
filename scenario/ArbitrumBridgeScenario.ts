import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils, constants } from 'ethers';
import { fastL2GovernanceExecute, matchesDeployment } from './utils';
import { calldata, COMP_WHALES } from '../src/deploy';
import { ArbitrumBridgeReceiver } from '../build/types';
import { World } from '../plugins/scenario';
import { impersonateAddress } from '../plugins/scenario/utils';
import { exp } from '../test/helpers';

scenario(
  'execute Arbitrum governance proposal',
  {
    filter: async ctx => matchesDeployment(ctx, [{network: 'arbitrum'}, {network: 'arbitrum-goerli'}])
  },
  async ({ comet, timelock, bridgeReceiver }, _context, world) => {
    const currentTimelockDelay = await timelock.delay();
    const newTimelockDelay = currentTimelockDelay.mul(2);

    // Cross-chain proposal to change L2 timelock's delay and pause L2 Comet actions
    const setDelayCalldata = utils.defaultAbiCoder.encode(['uint'], [newTimelockDelay]);
    const pauseCalldata = await calldata(comet.populateTransaction.pause(true, true, true, true, true));
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [timelock.address, comet.address],
        [0, 0],
        ['setDelay(uint256)', 'pause(bool,bool,bool,bool,bool)'],
        [setDelayCalldata, pauseCalldata]
      ]
    );

    expect(await timelock.delay()).to.eq(currentTimelockDelay);
    expect(currentTimelockDelay).to.not.eq(newTimelockDelay);

    await fastL1ToArbitrumGovernanceExecute(
      l2ProposalData,
      bridgeReceiver as ArbitrumBridgeReceiver,
      world
    );

    expect(await timelock.delay()).to.eq(newTimelockDelay);
    expect(await comet.isAbsorbPaused()).to.eq(true);
    expect(await comet.isBuyPaused()).to.eq(true);
    expect(await comet.isSupplyPaused()).to.eq(true);
    expect(await comet.isTransferPaused()).to.eq(true);
    expect(await comet.isWithdrawPaused()).to.eq(true);
  }
);

scenario(
  'upgrade Arbitrum governance contracts and ensure they work properly',
  {
    filter: async ctx => matchesDeployment(ctx, [{network: 'arbitrum'}, {network: 'arbitrum-goerli'}])
  },
  async ({ comet, configurator, proxyAdmin, timelock: oldLocalTimelock, bridgeReceiver: oldBridgeReceiver }, _context, world) => {
    const dm = world.deploymentManager;
    const governanceDeploymentManager = world.auxiliaryDeploymentManager;
    if (!governanceDeploymentManager) {
      throw new Error('cannot execute governance without governance deployment manager');
    }

    // Deploy new ArbitrumBridgeReceiver
    const newBridgeReceiver = await dm.deploy<ArbitrumBridgeReceiver, []>(
      'newBridgeReceiver',
      'bridges/arbitrum/ArbitrumBridgeReceiver.sol',
      []
    );

    // Deploy new local Timelock
    const secondsPerDay = 24 * 60 * 60;
    const newLocalTimelock = await dm.deploy(
      'newTimelock',
      'vendor/Timelock.sol',
      [
        newBridgeReceiver.address, // admin
        2 * secondsPerDay,         // delay
        14 * secondsPerDay,        // grace period
        2 * secondsPerDay,         // minimum delay
        30 * secondsPerDay         // maxiumum delay
      ]
    );

    // Initialize new ArbitrumBridgeReceiver
    const mainnetTimelock = (await governanceDeploymentManager.getContractOrThrow('timelock')).address;
    await newBridgeReceiver.initialize(
      mainnetTimelock,             // govTimelock
      newLocalTimelock.address     // localTimelock
    );

    // Process for upgrading L2 governance contracts (order matters):
    // 1. Update the admin of Comet in Configurator to be the new Timelock
    // 2. Update the admin of CometProxyAdmin to be the new Timelock
    const transferOwnershipCalldata = utils.defaultAbiCoder.encode(
      ['address'],
      [newLocalTimelock.address]
    );
    const setGovernorCalldata = await calldata(
      configurator.populateTransaction.setGovernor(comet.address, newLocalTimelock.address)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const upgradeL2GovContractsProposal = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, proxyAdmin.address, proxyAdmin.address],
        [0, 0, 0],
        [
          'setGovernor(address,address)',
          'deployAndUpgradeTo(address,address)',
          'transferOwnership(address)'
        ],
        [setGovernorCalldata, deployAndUpgradeToCalldata, transferOwnershipCalldata]
      ]
    );

    expect(await proxyAdmin.owner()).to.eq(oldLocalTimelock.address);
    expect(await comet.governor()).to.eq(oldLocalTimelock.address);

    await fastL1ToArbitrumGovernanceExecute(
      upgradeL2GovContractsProposal,
      oldBridgeReceiver as ArbitrumBridgeReceiver,
      world
    );

    expect(await proxyAdmin.owner()).to.eq(newLocalTimelock.address);
    expect(await comet.governor()).to.eq(newLocalTimelock.address);

    // Update aliases now that the new Timelock and BridgeReceiver are official
    await dm.putAlias('timelock', newLocalTimelock);
    await dm.putAlias('bridgeReceiver', newBridgeReceiver);

    // Now, test that the new L2 governance contracts are working properly via another cross-chain proposal
    const currentTimelockDelay = await newLocalTimelock.delay();
    const newTimelockDelay = currentTimelockDelay.mul(2);

    const setDelayCalldata = utils.defaultAbiCoder.encode(['uint'], [newTimelockDelay]);
    const pauseCalldata = await calldata(comet.populateTransaction.pause(true, true, true, true, true));
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [newLocalTimelock.address, comet.address],
        [0, 0],
        ['setDelay(uint256)', 'pause(bool,bool,bool,bool,bool)'],
        [setDelayCalldata, pauseCalldata]
      ]
    );

    expect(await newLocalTimelock.delay()).to.eq(currentTimelockDelay);
    expect(currentTimelockDelay).to.not.eq(newTimelockDelay);

    await fastL1ToArbitrumGovernanceExecute(l2ProposalData, newBridgeReceiver, world);

    expect(await newLocalTimelock.delay()).to.eq(newTimelockDelay);
    expect(await comet.isAbsorbPaused()).to.eq(true);
    expect(await comet.isBuyPaused()).to.eq(true);
    expect(await comet.isSupplyPaused()).to.eq(true);
    expect(await comet.isTransferPaused()).to.eq(true);
    expect(await comet.isWithdrawPaused()).to.eq(true);
  }
);

async function fastL1ToArbitrumGovernanceExecute(
  l2ProposalData: string,
  arbitrumBridgeReceiver: ArbitrumBridgeReceiver,
  world: World
) {
  const governanceDeploymentManager = world.auxiliaryDeploymentManager;
  if (!governanceDeploymentManager) {
    throw new Error('cannot execute governance without governance deployment manager');
  }

  const isMainnetArbitrum = world.base.network === 'arbitrum';
  const compWhale = isMainnetArbitrum ? COMP_WHALES.mainnet[0] : COMP_WHALES.testnet[0];
  const proposer = await impersonateAddress(governanceDeploymentManager, compWhale, exp(1, 18)); // give them enough ETH to make the proposal

  const refundAddress = constants.AddressZero; // XXX

  // createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)
  const createRetryableTicketCalldata = utils.defaultAbiCoder.encode(
    [
      'address','uint256','uint256','address','address','uint256','uint256','bytes'
    ],
    [
      arbitrumBridgeReceiver.address, // address to,
      0,                              // uint256 l2CallValue,
      0,                              // uint256 maxSubmissionCost,
      refundAddress,                  // address excessFeeRefundAddress,
      refundAddress,                  // address callValueRefundAddress,
      0,                              // uint256 gasLimit,
      0,                              // uint256 maxFeePerGas,
      l2ProposalData                  // bytes calldata data
    ]
  );

  // XXX
  const inbox = await governanceDeploymentManager.getContractOrThrow('inbox');

  // XXX
  await fastL2GovernanceExecute(
    governanceDeploymentManager,
    world.deploymentManager,
    proposer,
    [inbox.address],
    [0],
    [
      'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)'
    ],
    [createRetryableTicketCalldata]
  );
}
