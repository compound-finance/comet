import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { BigNumberish, constants, utils } from 'ethers';
import { exp } from '../test/helpers';
import { BaseBridgeReceiver, FaucetToken } from '../build/types';
import { calldata } from '../src/deploy';
import { COMP_WHALES } from '../src/deploy';
import { impersonateAddress } from '../plugins/scenario/utils';
import { isBridgedDeployment, fastL2GovernanceExecute } from './utils';
import { World } from '../plugins/scenario';

scenario('upgrade Comet implementation and initialize', {filter: async (ctx) => !isBridgedDeployment(ctx)}, async ({ comet, configurator, proxyAdmin }, context) => {
  // For this scenario, we will be using the value of LiquidatorPoints.numAbsorbs for address ZERO to test that initialize has been called
  expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(0);

  // Deploy new version of Comet Factory
  const dm = context.world.deploymentManager;
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

scenario('upgrade Comet implementation and initialize using deployUpgradeToAndCall', {filter: async (ctx) => !isBridgedDeployment(ctx)}, async ({ comet, configurator, proxyAdmin }, context) => {
  // For this scenario, we will be using the value of LiquidatorPoints.numAbsorbs for address ZERO to test that initialize has been called
  expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(0);

  // Deploy new version of Comet Factory
  const dm = context.world.deploymentManager;
  const cometModifiedFactory = await dm.deploy(
    'cometFactory',
    'test/CometModifiedFactory.sol',
    [],
    true
  );

  // Execute a governance proposal to:
  // 1. Set the new factory address in Configurator
  // 2. DeployUpgradeToAndCall the new implementation of Comet
  const setFactoryCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [comet.address, cometModifiedFactory.address]);
  const modifiedComet = (await dm.hre.ethers.getContractFactory('CometModified')).attach(comet.address);
  const initializeCalldata = (await modifiedComet.populateTransaction.initialize(constants.AddressZero)).data;
  const deployUpgradeToAndCallCalldata = utils.defaultAbiCoder.encode(['address', 'address', 'bytes'], [configurator.address, comet.address, initializeCalldata]);

  await context.fastGovernanceExecute(
    [configurator.address, proxyAdmin.address],
    [0, 0],
    ['setFactory(address,address)', 'deployUpgradeToAndCall(address,address,bytes)'],
    [setFactoryCalldata, deployUpgradeToAndCallCalldata]
  );

  // LiquidatorPoints.numAbsorbs for address ZERO should now be set as UInt32.MAX
  expect((await comet.liquidatorPoints(constants.AddressZero)).numAbsorbs).to.be.equal(2 ** 32 - 1);
});

scenario('upgrade Comet implementation and call new function', {filter: async (ctx) => !isBridgedDeployment(ctx)}, async ({ comet, configurator, proxyAdmin, actors }, context) => {
  const { signer } = actors;

  // Deploy new version of Comet Factory
  const dm = context.world.deploymentManager;
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

scenario('add new asset',
  {
    filter: async (ctx) => !isBridgedDeployment(ctx),
    tokenBalances: {
      $comet: { $base: '>= 1000' },
    },
    prices: {
      $base: 1
    }
  },
  async ({ comet, configurator, proxyAdmin, actors }, context) => {
    const { albert } = actors;

    // Deploy new token and pricefeed
    const dm = context.world.deploymentManager;
    const dogecoin = await dm.deploy<FaucetToken, [string, string, BigNumberish, string]>(
      'DOGE',
      'test/FaucetToken.sol',
      [exp(1_000_000, 8).toString(), 'Dogecoin', 8, 'DOGE'],
      true
    );
    const dogecoinPricefeed = await dm.deploy(
      'DOGE:priceFeed',
      'test/SimplePriceFeed.sol',
      [exp(1_000, 8).toString(), 8],
      true
    );

    // Allocate some tokens to Albert
    await dogecoin.allocateTo(albert.address, exp(100, 8));

    // Execute a governance proposal to:
    // 1. Add new asset via Configurator
    // 2. Deploy and upgrade to new implementation of Comet
    const newAssetConfig = {
      asset: dogecoin.address,
      priceFeed: dogecoinPricefeed.address,
      decimals: await dogecoin.decimals(),
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1_000, 8),
    };

    const addAssetCalldata = await calldata(configurator.populateTransaction.addAsset(comet.address, newAssetConfig));
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(['address', 'address'], [configurator.address, comet.address]);
    await context.fastGovernanceExecute(
      [configurator.address, proxyAdmin.address],
      [0, 0],
      ['addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))', 'deployAndUpgradeTo(address,address)'],
      [addAssetCalldata, deployAndUpgradeToCalldata]
    );

    // Try to supply new token and borrow base
    const baseAssetAddress = await comet.baseToken();
    const borrowAmount = 1000n * (await comet.baseScale()).toBigInt();
    await dogecoin.connect(albert.signer).approve(comet.address, exp(100, 8));
    await albert.supplyAsset({ asset: dogecoin.address, amount: exp(100, 8) });
    await albert.withdrawAsset({ asset: baseAssetAddress, amount: borrowAmount });

    expect(await albert.getCometCollateralBalance(dogecoin.address)).to.be.equal(exp(100, 8));
    expect(await albert.getCometBaseBalance()).to.be.equal(-borrowAmount);
  });

scenario(
  'execute Polygon governance proposal',
  {
    filter: async ctx => ctx.world.base.network === 'mumbai' || ctx.world.base.network === 'polygon'
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

    await fastL1ToPolygonGovernanceExecute(l2ProposalData, bridgeReceiver, world);

    expect(await timelock.delay()).to.eq(newTimelockDelay);
    expect(await comet.isAbsorbPaused()).to.eq(true);
    expect(await comet.isBuyPaused()).to.eq(true);
    expect(await comet.isSupplyPaused()).to.eq(true);
    expect(await comet.isTransferPaused()).to.eq(true);
    expect(await comet.isWithdrawPaused()).to.eq(true);
  }
);

scenario(
  'upgrade Polygon governance contracts and ensure they work properly',
  {
    filter: async ctx => ctx.world.base.network === 'mumbai' || ctx.world.base.network === 'polygon'
  },
  async ({ comet, configurator, proxyAdmin, timelock: oldLocalTimelock, bridgeReceiver: oldBridgeReceiver }, _context, world) => {
    const dm = world.deploymentManager;
    const governanceDeploymentManager = world.auxiliaryDeploymentManager;
    if (!governanceDeploymentManager) {
      throw new Error('cannot execute governance without governance deployment manager');
    }
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

    await fastL1ToPolygonGovernanceExecute(upgradeL2GovContractsProposal, oldBridgeReceiver, world);

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

    await fastL1ToPolygonGovernanceExecute(l2ProposalData, newBridgeReceiver, world);

    expect(await newLocalTimelock.delay()).to.eq(newTimelockDelay);
    expect(await comet.isAbsorbPaused()).to.eq(true);
    expect(await comet.isBuyPaused()).to.eq(true);
    expect(await comet.isSupplyPaused()).to.eq(true);
    expect(await comet.isTransferPaused()).to.eq(true);
    expect(await comet.isWithdrawPaused()).to.eq(true);
  }
);

async function fastL1ToPolygonGovernanceExecute(
  l2ProposalData: string,
  bridgeReceiver: BaseBridgeReceiver,
  world: World
) {
  const governanceDeploymentManager = world.auxiliaryDeploymentManager;
  if (!governanceDeploymentManager) {
    throw new Error('cannot execute governance without governance deployment manager');
  }

  const compWhale = world.base.network === 'polygon' ? COMP_WHALES.mainnet[0] : COMP_WHALES.testnet[0];
  const proposer = await impersonateAddress(governanceDeploymentManager, compWhale, exp(1, 18)); // give them enough ETH to make the proposal

  const sendMessageToChildCalldata = utils.defaultAbiCoder.encode(
    ['address', 'bytes'],
    [bridgeReceiver.address, l2ProposalData]
  );

  const fxRoot = await governanceDeploymentManager.getContractOrThrow('fxRoot');

  await fastL2GovernanceExecute(
    governanceDeploymentManager,
    world.deploymentManager,
    proposer,
    [fxRoot.address],
    [0],
    ['sendMessageToChild(address,bytes)'],
    [sendMessageToChildCalldata]
  );
}