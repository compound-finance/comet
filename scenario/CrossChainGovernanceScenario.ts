import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { utils } from 'ethers';
import { BaseBridgeReceiver, LineaBridgeReceiver, ScrollBridgeReceiver } from '../build/types';
import { calldata } from '../src/deploy';
import { isBridgedDeployment, matchesDeployment, createCrossChainProposal } from './utils';
import { ArbitrumBridgeReceiver } from '../build/types';

// This is a generic scenario that runs for all L2s and sidechains
scenario(
  'execute cross-chain governance proposal',
  {
    filter: async ctx => isBridgedDeployment(ctx)
  },
  async ({ comet, timelock, bridgeReceiver }, context) => {
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

    await createCrossChainProposal(context, l2ProposalData, bridgeReceiver);

    expect(await timelock.delay()).to.eq(newTimelockDelay);
    expect(await comet.isAbsorbPaused()).to.eq(true);
    expect(await comet.isBuyPaused()).to.eq(true);
    expect(await comet.isSupplyPaused()).to.eq(true);
    expect(await comet.isTransferPaused()).to.eq(true);
    expect(await comet.isWithdrawPaused()).to.eq(true);
  }
);

// This is a Polygon-specific scenario that tests the governance contract upgrade flow
scenario(
  'upgrade Polygon governance contracts and ensure they work properly',
  {
    filter: async ctx => matchesDeployment(ctx, [{network: 'polygon'}, {network: 'mumbai'}])
  },
  async ({ comet, configurator, proxyAdmin, timelock: oldLocalTimelock, bridgeReceiver: oldBridgeReceiver }, context, world) => {
    const dm = world.deploymentManager;
    const govDeploymentManager = world.auxiliaryDeploymentManager!;
    const fxChild = await dm.getContractOrThrow('fxChild');

    // Deploy new PolygonBridgeReceiver
    const newBridgeReceiver = await dm.deploy<BaseBridgeReceiver, [string]>(
      'newBridgeReceiver',
      'bridges/polygon/PolygonBridgeReceiver.sol',
      [fxChild.address]           // fxChild
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

    // Initialize new PolygonBridgeReceiver
    const mainnetTimelock = (await govDeploymentManager.getContractOrThrow('timelock')).address;
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

    await createCrossChainProposal(context, upgradeL2GovContractsProposal, oldBridgeReceiver);

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

    await createCrossChainProposal(context, l2ProposalData, newBridgeReceiver);

    expect(await newLocalTimelock.delay()).to.eq(newTimelockDelay);
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
  async ({ comet, configurator, proxyAdmin, timelock: oldLocalTimelock, bridgeReceiver: oldBridgeReceiver }, context, world) => {
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

    await createCrossChainProposal(context, upgradeL2GovContractsProposal, oldBridgeReceiver);

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

    await createCrossChainProposal(context, l2ProposalData, newBridgeReceiver);

    expect(await newLocalTimelock.delay()).to.eq(newTimelockDelay);
    expect(await comet.isAbsorbPaused()).to.eq(true);
    expect(await comet.isBuyPaused()).to.eq(true);
    expect(await comet.isSupplyPaused()).to.eq(true);
    expect(await comet.isTransferPaused()).to.eq(true);
    expect(await comet.isWithdrawPaused()).to.eq(true);
  }
);

scenario(
  'upgrade Linea governance contracts and ensure they work properly',
  {
    filter: async ctx => matchesDeployment(ctx, [{ network: 'linea-goerli' }])
  },
  async (
    {
      comet,
      configurator,
      proxyAdmin,
      timelock: oldLocalTimelock,
      bridgeReceiver: oldBridgeReceiver
    },
    context,
    world
  ) => {
    const dm = world.deploymentManager;
    const governanceDeploymentManager = world.auxiliaryDeploymentManager;
    if (!governanceDeploymentManager) {
      throw new Error('cannot execute governance without governance deployment manager');
    }

    const l2MessageService = await dm.getContractOrThrow('l2MessageService');

    // Deploy new LineaBridgeReceiver
    const newBridgeReceiver = await dm.deploy<LineaBridgeReceiver, [string]>(
      'newBridgeReceiver',
      'bridges/linea/LineaBridgeReceiver.sol',
      [l2MessageService.address]
    );

    // Deploy new local Timelock
    const secondsPerDay = 24 * 60 * 60;
    const newLocalTimelock = await dm.deploy('newTimelock', 'vendor/Timelock.sol', [
      newBridgeReceiver.address, // admin
      2 * secondsPerDay, // delay
      14 * secondsPerDay, // grace period
      2 * secondsPerDay, // minimum delay
      30 * secondsPerDay // maxiumum delay
    ]);

    // Initialize new LineaBridgeReceiver
    const mainnetTimelock = (await governanceDeploymentManager.getContractOrThrow('timelock'))
      .address;
    await newBridgeReceiver.initialize(
      mainnetTimelock, // govTimelock
      newLocalTimelock.address // localTimelock
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

    await createCrossChainProposal(context, upgradeL2GovContractsProposal, oldBridgeReceiver);

    expect(await proxyAdmin.owner()).to.eq(newLocalTimelock.address);
    expect(await comet.governor()).to.eq(newLocalTimelock.address);

    // Update aliases now that the new Timelock and BridgeReceiver are official
    await dm.putAlias('timelock', newLocalTimelock);
    await dm.putAlias('bridgeReceiver', newBridgeReceiver);

    // Now, test that the new L2 governance contracts are working properly via another cross-chain proposal
    const currentTimelockDelay = await newLocalTimelock.delay();
    const newTimelockDelay = currentTimelockDelay.mul(2);

    const setDelayCalldata = utils.defaultAbiCoder.encode(['uint'], [newTimelockDelay]);
    const pauseCalldata = await calldata(
      comet.populateTransaction.pause(true, true, true, true, true)
    );
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

    await createCrossChainProposal(context, l2ProposalData, newBridgeReceiver);

    expect(await newLocalTimelock.delay()).to.eq(newTimelockDelay);
    expect(await comet.isAbsorbPaused()).to.eq(true);
    expect(await comet.isBuyPaused()).to.eq(true);
    expect(await comet.isSupplyPaused()).to.eq(true);
    expect(await comet.isTransferPaused()).to.eq(true);
    expect(await comet.isWithdrawPaused()).to.eq(true);
  }
);

scenario(
  'upgrade Scroll governance contracts and ensure they work properly',
  {
    filter: async ctx => matchesDeployment(ctx, [{ network: 'scroll-goerli' }, {network: 'scroll'}])
  },
  async (
    {
      comet,
      configurator,
      proxyAdmin,
      timelock: oldLocalTimelock,
      bridgeReceiver: oldBridgeReceiver
    },
    context,
    world
  ) => {
    const dm = world.deploymentManager;
    const governanceDeploymentManager = world.auxiliaryDeploymentManager;
    if (!governanceDeploymentManager) {
      throw new Error('cannot execute governance without governance deployment manager');
    }

    const l2Messenger = await dm.getContractOrThrow('l2Messenger');

    // Deploy new ScrollBridgeReceiver
    const newBridgeReceiver = await dm.deploy<ScrollBridgeReceiver, [string]>(
      'newBridgeReceiver',
      'bridges/scroll/ScrollBridgeReceiver.sol',
      [l2Messenger.address]
    );

    // Deploy new local Timelock
    const secondsPerDay = 24 * 60 * 60;
    const newLocalTimelock = await dm.deploy('newTimelock', 'vendor/Timelock.sol', [
      newBridgeReceiver.address, // admin
      2 * secondsPerDay, // delay
      14 * secondsPerDay, // grace period
      2 * secondsPerDay, // minimum delay
      30 * secondsPerDay // maxiumum delay
    ]);

    // Initialize new ScrollBridgeReceiver
    const mainnetTimelock = (await governanceDeploymentManager.getContractOrThrow('timelock'))
      .address;
    await newBridgeReceiver.initialize(
      mainnetTimelock, // govTimelock
      newLocalTimelock.address // localTimelock
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

    await createCrossChainProposal(context, upgradeL2GovContractsProposal, oldBridgeReceiver);

    expect(await proxyAdmin.owner()).to.eq(newLocalTimelock.address);
    expect(await comet.governor()).to.eq(newLocalTimelock.address);

    // Update aliases now that the new Timelock and BridgeReceiver are official
    await dm.putAlias('timelock', newLocalTimelock);
    await dm.putAlias('bridgeReceiver', newBridgeReceiver);

    // Now, test that the new L2 governance contracts are working properly via another cross-chain proposal
    const currentTimelockDelay = await newLocalTimelock.delay();
    const newTimelockDelay = currentTimelockDelay.mul(2);

    const setDelayCalldata = utils.defaultAbiCoder.encode(['uint'], [newTimelockDelay]);
    const pauseCalldata = await calldata(
      comet.populateTransaction.pause(true, true, true, true, true)
    );
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

    await createCrossChainProposal(context, l2ProposalData, newBridgeReceiver);

    expect(await newLocalTimelock.delay()).to.eq(newTimelockDelay);
    expect(await comet.isAbsorbPaused()).to.eq(true);
    expect(await comet.isBuyPaused()).to.eq(true);
    expect(await comet.isSupplyPaused()).to.eq(true);
    expect(await comet.isTransferPaused()).to.eq(true);
    expect(await comet.isWithdrawPaused()).to.eq(true);
  }
);