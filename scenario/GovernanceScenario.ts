import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { BigNumberish, constants, utils } from 'ethers';
import { exp } from '../test/helpers';
import { FaucetToken } from '../build/types';
import { calldata } from '../src/deploy';
import { COMP_WHALES } from '../src/deploy';
import { impersonateAddress } from '../plugins/scenario/utils';
import { isBridgedDeployment, fastL2GovernanceExecute } from './utils';

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
    const borrowAmount = 1_000n * (await comet.baseScale()).toBigInt();
    await dogecoin.connect(albert.signer).approve(comet.address, exp(100, 8));
    await albert.supplyAsset({ asset: dogecoin.address, amount: exp(100, 8) });
    await albert.withdrawAsset({ asset: baseAssetAddress, amount: borrowAmount });

    expect(await albert.getCometCollateralBalance(dogecoin.address)).to.be.equal(exp(100, 8));
    expect(await albert.getCometBaseBalance()).to.be.equal(-borrowAmount);
  });

scenario(
  'execute Mumbai governance proposal',
  {
    filter: async (ctx) => ctx.world.base.network === 'mumbai'
  },
  async ({ timelock, bridgeReceiver }, _context, world) => {
    const governanceDeploymentManager = world.auxiliaryDeploymentManager;
    if (!governanceDeploymentManager) {
      throw new Error('cannot execute governance without governance deployment manager');
    }

    const proposer = await impersonateAddress(governanceDeploymentManager, COMP_WHALES.testnet[0]);

    const currentTimelockDelay = await timelock.delay();
    const newTimelockDelay = currentTimelockDelay.mul(2);

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [timelock.address],
        [0],
        ['setDelay(uint256)'],
        [utils.defaultAbiCoder.encode(['uint'], [newTimelockDelay])]
      ]
    );

    const sendMessageToChildCalldata = utils.defaultAbiCoder.encode(
      ['address', 'bytes'],
      [bridgeReceiver.address, l2ProposalData]
    );

    const fxRoot = await governanceDeploymentManager.getContractOrThrow('fxRoot');

    expect(await timelock.delay()).to.eq(currentTimelockDelay);
    expect(currentTimelockDelay).to.not.eq(newTimelockDelay);

    await fastL2GovernanceExecute(
      governanceDeploymentManager,
      world.deploymentManager,
      proposer,
      [fxRoot.address],
      [0],
      ['sendMessageToChild(address,bytes)'],
      [sendMessageToChildCalldata]
    );

    expect(await timelock.delay()).to.eq(newTimelockDelay);
  }
);