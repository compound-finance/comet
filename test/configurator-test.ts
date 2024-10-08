import { annualize, defactor, defaultAssets, ethers, event, exp, expect, factor, makeConfigurator, Numeric, truncateDecimals, wait } from './helpers';
import {
  CometModifiedFactory__factory,
  MarketAdminPermissionChecker__factory,
  SimplePriceFeed__factory,
  SimpleTimelock__factory
} from '../build/types';
import { AssetInfoStructOutput } from '../build/types/CometHarnessInterface';
import { ConfigurationStructOutput } from '../build/types/Configurator';
import { BigNumber } from 'ethers';

type ConfiguratorAssetConfig = {
  asset: string;
  priceFeed: string;
  decimals: Numeric;
  borrowCollateralFactor: Numeric;
  liquidateCollateralFactor: Numeric;
  liquidationFactor: Numeric;
  supplyCap: Numeric;
};

function convertToEventAssetConfig(assetConfig: ConfiguratorAssetConfig) {
  return [
    assetConfig.asset,
    assetConfig.priceFeed,
    assetConfig.decimals,
    assetConfig.borrowCollateralFactor,
    assetConfig.liquidateCollateralFactor,
    assetConfig.liquidationFactor,
    assetConfig.supplyCap,
  ];
}

function convertToEventConfiguration(configuration: ConfigurationStructOutput) {
  return [
    configuration.governor,
    configuration.pauseGuardian,
    configuration.baseToken,
    configuration.baseTokenPriceFeed,
    configuration.extensionDelegate,
    configuration.supplyKink.toBigInt(),
    configuration.supplyPerYearInterestRateSlopeLow.toBigInt(),
    configuration.supplyPerYearInterestRateSlopeHigh.toBigInt(),
    configuration.supplyPerYearInterestRateBase.toBigInt(),
    configuration.borrowKink.toBigInt(),
    configuration.borrowPerYearInterestRateSlopeLow.toBigInt(),
    configuration.borrowPerYearInterestRateSlopeHigh.toBigInt(),
    configuration.borrowPerYearInterestRateBase.toBigInt(),
    configuration.storeFrontPriceFactor.toBigInt(),
    configuration.trackingIndexScale.toBigInt(),
    configuration.baseTrackingSupplySpeed.toBigInt(),
    configuration.baseTrackingBorrowSpeed.toBigInt(),
    configuration.baseMinForRewards.toBigInt(),
    configuration.baseBorrowMin.toBigInt(),
    configuration.targetReserves.toBigInt(),
    [] // leave asset configs empty for simplicity
  ];
}

// Checks that the Configurator asset config matches the Comet asset info
function expectAssetConfigsToMatch(
  configuratorAssetConfigs: ConfiguratorAssetConfig,
  cometAssetInfo: AssetInfoStructOutput
) {
  expect(configuratorAssetConfigs.asset).to.be.equal(cometAssetInfo.asset);
  expect(configuratorAssetConfigs.priceFeed).to.be.equal(cometAssetInfo.priceFeed);
  expect(exp(1, configuratorAssetConfigs.decimals)).to.be.equal(cometAssetInfo.scale);
  expect(configuratorAssetConfigs.borrowCollateralFactor).to.be.equal(cometAssetInfo.borrowCollateralFactor);
  expect(configuratorAssetConfigs.liquidateCollateralFactor).to.be.equal(cometAssetInfo.liquidateCollateralFactor);
  expect(configuratorAssetConfigs.liquidationFactor).to.be.equal(cometAssetInfo.liquidationFactor);
  expect(configuratorAssetConfigs.supplyCap).to.be.equal(cometAssetInfo.supplyCap);
}

describe('configurator', function () {
  it('deploys Comet', async () => {
    const { configurator, configuratorProxy, cometProxy } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    const txn = await wait(configuratorAsProxy.deploy(cometProxy.address)) as any;
    const [, newCometAddress] = txn.receipt.events.find(event => event.event === 'CometDeployed').args;

    expect(event(txn, 0)).to.be.deep.equal({
      CometDeployed: {
        cometProxy: cometProxy.address,
        newComet: newCometAddress,
      }
    });
  });

  it('deploys Comet from ProxyAdmin', async () => {
    const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.be.equal(comet.address);
    expect(await proxyAdmin.getProxyImplementation(configuratorProxy.address)).to.be.equal(configurator.address);

    await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));
    const newCometAddress = await proxyAdmin.getProxyImplementation(cometProxy.address);

    expect(newCometAddress).to.not.be.equal(comet.address);
  });

  it('reverts if deploy is called from non-governor', async () => {
    const { configuratorProxy, proxyAdmin, cometProxy, users: [alice], governor } = await makeConfigurator();

    const MarketAdminPermissionCheckerFactory = (await ethers.getContractFactory(
      'MarketAdminPermissionChecker'
    )) as MarketAdminPermissionChecker__factory;


    const marketAdminPermissionCheckerContract =  await MarketAdminPermissionCheckerFactory.deploy(
      governor.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero
    );

    await expect(proxyAdmin.connect(alice).deployAndUpgradeTo(configuratorProxy.address, cometProxy.address)).to.be.revertedWithCustomError(marketAdminPermissionCheckerContract, 'Unauthorized');
  });

  it('e2e governance actions from timelock', async () => {
    const { governor, configurator, configuratorProxy, proxyAdmin, cometProxy, users: [alice] } = await makeConfigurator();

    const TimelockFactory = (await ethers.getContractFactory(
      'SimpleTimelock'
    )) as SimpleTimelock__factory;

    const timelock = await TimelockFactory.deploy(governor.address);
    await timelock.deployed();
    await proxyAdmin.transferOwnership(timelock.address);

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    await configuratorAsProxy.transferGovernor(timelock.address); // set timelock as admin of Configurator

    expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).governor).to.be.equal(governor.address);

    // 1. SetGovernor
    // 2. DeployAndUpgradeTo
    let setGovernorCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address'], [cometProxy.address, alice.address]);
    let deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address'], [configuratorProxy.address, cometProxy.address]);
    await timelock.executeTransactions([configuratorProxy.address, proxyAdmin.address], [0, 0], ['setGovernor(address,address)', 'deployAndUpgradeTo(address,address)'], [setGovernorCalldata, deployAndUpgradeToCalldata]);

    expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).governor).to.be.equal(alice.address);
  });

  it('reverts if initialized more than once', async () => {
    const { governor, configurator, configuratorProxy } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    await expect(configuratorAsProxy.initialize(governor.address)).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  it('reverts if initializing the implementation contract', async () => {
    const { governor, configurator } = await makeConfigurator();

    await expect(configurator.initialize(governor.address)).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  describe('configuration setters', function () {
    it('sets factory and deploys Comet using new factory', async () => {
      const { configurator, configuratorProxy, proxyAdmin, cometFactory, cometProxy } = await makeConfigurator();

      // Deploy modified CometFactory
      const CometModifiedFactoryFactory = (await ethers.getContractFactory('CometModifiedFactory')) as CometModifiedFactory__factory;
      const cometModifiedFactory = await CometModifiedFactoryFactory.deploy();
      await cometModifiedFactory.deployed();
      const oldFactory = cometFactory.address;
      const newFactory = cometModifiedFactory.address;

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const txn = await wait(configuratorAsProxy.setFactory(cometProxy.address, cometModifiedFactory.address));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetFactory: {
          cometProxy: cometProxy.address,
          oldFactory,
          newFactory,
        }
      });
      expect(oldFactory).to.be.not.equal(newFactory);
      expect(await configuratorAsProxy.factory(cometProxy.address)).to.be.equal(newFactory);
      // Call new function on Comet
      const CometModified = await ethers.getContractFactory('CometModified');
      const modifiedCometAsProxy = CometModified.attach(cometProxy.address);
      expect(await modifiedCometAsProxy.newFunction()).to.be.equal(101n);
    });

    it('sets Configuration for a new Comet proxy', async () => {
      const { configurator, configuratorProxy, proxyAdmin } = await makeConfigurator();

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const newCometProxyAddress = ethers.constants.AddressZero;
      const oldConfiguration = await configuratorAsProxy.getConfiguration(newCometProxyAddress);
      const newConfiguration = { ...oldConfiguration, governor: proxyAdmin.address } as ConfigurationStructOutput;

      const txn = await wait(configuratorAsProxy.setConfiguration(newCometProxyAddress, newConfiguration));

      expect(event(txn, 0)).to.be.deep.equal({
        SetConfiguration: {
          cometProxy: newCometProxyAddress,
          oldConfiguration: convertToEventConfiguration(oldConfiguration),
          newConfiguration: convertToEventConfiguration(newConfiguration),
        }
      });
      expect(oldConfiguration).to.be.not.equal(newConfiguration);
      expect((await configuratorAsProxy.getConfiguration(newCometProxyAddress)).governor).to.be.equal(newConfiguration.governor);
    });

    it('sets Configuration for a Comet proxy with an existing configuration', async () => {
      const { configurator, configuratorProxy, cometProxy } = await makeConfigurator({
        assets: {
          USDC: { initial: 1e6, decimals: 6 },
        }
      });

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldConfiguration = await configuratorAsProxy.getConfiguration(cometProxy.address);
      const newConfiguration = { ...oldConfiguration, baseBorrowMin: BigNumber.from(1) } as ConfigurationStructOutput;

      const txn = await wait(configuratorAsProxy.setConfiguration(cometProxy.address, newConfiguration));

      expect(event(txn, 0)).to.be.deep.equal({
        SetConfiguration: {
          cometProxy: cometProxy.address,
          oldConfiguration: convertToEventConfiguration(oldConfiguration),
          newConfiguration: convertToEventConfiguration(newConfiguration),
        }
      });
      expect(oldConfiguration).to.be.not.equal(newConfiguration);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseBorrowMin).to.be.equal(newConfiguration.baseBorrowMin);
    });

    it('reverts when setting Configuration and changing baseToken for a Comet proxy with an existing configuration', async () => {
      const { configurator, configuratorProxy, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldConfiguration = await configuratorAsProxy.getConfiguration(cometProxy.address);
      const newConfiguration = { ...oldConfiguration, baseToken: COMP.address } as ConfigurationStructOutput;

      await expect(
        configuratorAsProxy.setConfiguration(cometProxy.address, newConfiguration)
      ).to.be.revertedWith("custom error 'ConfigurationAlreadyExists()'");
    });

    it('reverts when setting Configuration and changing trackingIndexScale for a Comet proxy with an existing configuration', async () => {
      const { configurator, configuratorProxy, cometProxy } = await makeConfigurator();

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldConfiguration = await configuratorAsProxy.getConfiguration(cometProxy.address);
      const newConfiguration = { ...oldConfiguration, trackingIndexScale: BigNumber.from(1e7) } as ConfigurationStructOutput;

      await expect(
        configuratorAsProxy.setConfiguration(cometProxy.address, newConfiguration)
      ).to.be.revertedWith("custom error 'ConfigurationAlreadyExists()'");
    });

    it('reverts when setting bad Configuration for a Comet proxy with an existing configuration', async () => {
      const { configurator, configuratorProxy, cometProxy } = await makeConfigurator();

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldConfiguration = await configuratorAsProxy.getConfiguration(cometProxy.address);
      const newConfiguration = { ...oldConfiguration, baseToken: ethers.constants.AddressZero };

      await expect(
        configuratorAsProxy.setConfiguration(cometProxy.address, newConfiguration)
      ).to.be.revertedWith("custom error 'ConfigurationAlreadyExists()'");
    });

    it('sets governor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).governor).to.be.equal(await comet.governor());

      const oldGovernor = await comet.governor();
      const newGovernor = alice.address;
      const txn = await wait(configuratorAsProxy.setGovernor(cometProxy.address, newGovernor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetGovernor: {
          cometProxy: cometProxy.address,
          oldGovernor,
          newGovernor,
        }
      });
      expect(oldGovernor).to.be.not.equal(newGovernor);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).governor).to.be.equal(newGovernor);
      expect(await cometAsProxy.governor()).to.be.equal(newGovernor);
    });

    it('sets pauseGuardian and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).pauseGuardian).to.be.equal(await comet.pauseGuardian());

      const oldPauseGuardian = await comet.pauseGuardian();
      const newPauseGuardian = alice.address;
      const txn = await wait(configuratorAsProxy.setPauseGuardian(cometProxy.address, newPauseGuardian));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetPauseGuardian: {
          cometProxy: cometProxy.address,
          oldPauseGuardian,
          newPauseGuardian,
        }
      });
      expect(oldPauseGuardian).to.be.not.equal(newPauseGuardian);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).pauseGuardian).to.be.equal(newPauseGuardian);
      expect(await cometAsProxy.pauseGuardian()).to.be.equal(newPauseGuardian);
    });

    it('sets baseTokenPriceFeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseTokenPriceFeed).to.be.equal(await comet.baseTokenPriceFeed());

      // Deploy new price feed
      const PriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
      const priceFeed = await PriceFeedFactory.deploy(exp(20, 8), 8);
      await priceFeed.deployed();

      const oldPriceFeed = await comet.baseTokenPriceFeed();
      const newPriceFeed = priceFeed.address;
      const txn = await wait(configuratorAsProxy.setBaseTokenPriceFeed(cometProxy.address, newPriceFeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseTokenPriceFeed: {
          cometProxy: cometProxy.address,
          oldBaseTokenPriceFeed: oldPriceFeed,
          newBaseTokenPriceFeed: newPriceFeed,
        }
      });
      expect(oldPriceFeed).to.be.not.equal(newPriceFeed);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseTokenPriceFeed).to.be.equal(newPriceFeed);
      expect(await cometAsProxy.baseTokenPriceFeed()).to.be.equal(newPriceFeed);
    });

    it('sets extensionDelegate and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).extensionDelegate).to.be.equal(await comet.extensionDelegate());

      const oldExt = await comet.extensionDelegate();
      const newExt = ethers.constants.AddressZero;
      const txn = await wait(configuratorAsProxy.setExtensionDelegate(cometProxy.address, newExt));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetExtensionDelegate: {
          cometProxy: cometProxy.address,
          oldExt,
          newExt,
        }
      });
      expect(oldExt).to.be.not.equal(newExt);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).extensionDelegate).to.be.equal(newExt);
      expect(await cometAsProxy.extensionDelegate()).to.be.equal(newExt);
    });

    it('sets supplyKink and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyKink).to.be.equal(await comet.supplyKink());

      const oldKink = (await comet.supplyKink()).toBigInt();
      const newKink = 100n;
      const txn = await wait(configuratorAsProxy.setSupplyKink(cometProxy.address, newKink));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetSupplyKink: {
          cometProxy: cometProxy.address,
          oldKink,
          newKink,
        }
      });
      expect(oldKink).to.be.not.equal(newKink);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyKink).to.be.equal(newKink);
      expect(await cometAsProxy.supplyKink()).to.be.equal(newKink);
    });

    it('sets supplyPerYearInterestRateSlopeLow and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyPerYearInterestRateSlopeLow))
        .to.be.approximately(annualize(await comet.supplyPerSecondInterestRateSlopeLow()), 0.00001);

      const oldIRSlopeLow = (await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyPerYearInterestRateSlopeLow.toBigInt();
      const newIRSlopeLow = exp(5.5, 18);
      const txn = await wait(configuratorAsProxy.setSupplyPerYearInterestRateSlopeLow(cometProxy.address, newIRSlopeLow));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetSupplyPerYearInterestRateSlopeLow: {
          cometProxy: cometProxy.address,
          oldIRSlopeLow,
          newIRSlopeLow,
        }
      });
      expect(oldIRSlopeLow).to.be.not.equal(newIRSlopeLow);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyPerYearInterestRateSlopeLow).to.be.equal(newIRSlopeLow);
      expect(annualize(await cometAsProxy.supplyPerSecondInterestRateSlopeLow()))
        .to.be.approximately(defactor(newIRSlopeLow), 0.00001);
    });

    it('sets supplyPerYearInterestRateSlopeHigh and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyPerYearInterestRateSlopeHigh))
        .to.be.approximately(annualize(await comet.supplyPerSecondInterestRateSlopeHigh()), 0.00001);

      const oldIRSlopeHigh = (await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyPerYearInterestRateSlopeHigh.toBigInt();
      const newIRSlopeHigh = exp(5.5, 18);
      const txn = await wait(configuratorAsProxy.setSupplyPerYearInterestRateSlopeHigh(cometProxy.address, newIRSlopeHigh));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetSupplyPerYearInterestRateSlopeHigh: {
          cometProxy: cometProxy.address,
          oldIRSlopeHigh,
          newIRSlopeHigh,
        }
      });
      expect(oldIRSlopeHigh).to.be.not.equal(newIRSlopeHigh);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyPerYearInterestRateSlopeHigh).to.be.equal(newIRSlopeHigh);
      expect(annualize(await cometAsProxy.supplyPerSecondInterestRateSlopeHigh()))
        .to.be.approximately(defactor(newIRSlopeHigh), 0.00001);
    });

    it('sets supplyPerYearInterestRateBase and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyPerYearInterestRateBase))
        .to.be.approximately(annualize(await comet.supplyPerSecondInterestRateBase()), 0.00001);

      const oldIRBase = (await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyPerYearInterestRateBase.toBigInt();
      const newIRBase = exp(5.5, 18);
      const txn = await wait(configuratorAsProxy.setSupplyPerYearInterestRateBase(cometProxy.address, newIRBase));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetSupplyPerYearInterestRateBase: {
          cometProxy: cometProxy.address,
          oldIRBase,
          newIRBase,
        }
      });
      expect(oldIRBase).to.be.not.equal(newIRBase);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).supplyPerYearInterestRateBase).to.be.equal(newIRBase);
      expect(annualize(await cometAsProxy.supplyPerSecondInterestRateBase()))
        .to.be.approximately(defactor(newIRBase), 0.00001);
    });

    it('sets borrowKink and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowKink).to.be.equal(await comet.borrowKink());

      const oldKink = (await comet.borrowKink()).toBigInt();
      const newKink = 100n;
      const txn = await wait(configuratorAsProxy.setBorrowKink(cometProxy.address, newKink));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBorrowKink: {
          cometProxy: cometProxy.address,
          oldKink,
          newKink,
        }
      });
      expect(oldKink).to.be.not.equal(newKink);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowKink).to.be.equal(newKink);
      expect(await cometAsProxy.borrowKink()).to.be.equal(newKink);
    });

    it('sets borrowPerYearInterestRateSlopeLow and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowPerYearInterestRateSlopeLow))
        .to.be.approximately(annualize(await comet.borrowPerSecondInterestRateSlopeLow()), 0.00001);

      const oldIRSlopeLow = (await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowPerYearInterestRateSlopeLow.toBigInt();
      const newIRSlopeLow = exp(5.5, 18);
      const txn = await wait(configuratorAsProxy.setBorrowPerYearInterestRateSlopeLow(cometProxy.address, newIRSlopeLow));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBorrowPerYearInterestRateSlopeLow: {
          cometProxy: cometProxy.address,
          oldIRSlopeLow,
          newIRSlopeLow,
        }
      });
      expect(oldIRSlopeLow).to.be.not.equal(newIRSlopeLow);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowPerYearInterestRateSlopeLow).to.be.equal(newIRSlopeLow);
      expect(annualize(await cometAsProxy.borrowPerSecondInterestRateSlopeLow()))
        .to.be.approximately(defactor(newIRSlopeLow), 0.00001);
    });

    it('sets borrowPerYearInterestRateSlopeHigh and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowPerYearInterestRateSlopeHigh))
        .to.be.approximately(annualize(await comet.borrowPerSecondInterestRateSlopeHigh()), 0.00001);

      const oldIRSlopeHigh = (await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowPerYearInterestRateSlopeHigh.toBigInt();
      const newIRSlopeHigh = exp(5.5, 18);
      const txn = await wait(configuratorAsProxy.setBorrowPerYearInterestRateSlopeHigh(cometProxy.address, newIRSlopeHigh));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBorrowPerYearInterestRateSlopeHigh: {
          cometProxy: cometProxy.address,
          oldIRSlopeHigh,
          newIRSlopeHigh,
        }
      });
      expect(oldIRSlopeHigh).to.be.not.equal(newIRSlopeHigh);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowPerYearInterestRateSlopeHigh).to.be.equal(newIRSlopeHigh);
      expect(annualize(await cometAsProxy.borrowPerSecondInterestRateSlopeHigh()))
        .to.be.approximately(defactor(newIRSlopeHigh), 0.00001);
    });

    it('sets borrowPerYearInterestRateBase and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowPerYearInterestRateBase))
        .to.be.approximately(annualize(await comet.borrowPerSecondInterestRateBase()), 0.00001);

      const oldIRBase = (await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowPerYearInterestRateBase.toBigInt();
      const newIRBase = exp(5.5, 18);
      const txn = await wait(configuratorAsProxy.setBorrowPerYearInterestRateBase(cometProxy.address, newIRBase));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBorrowPerYearInterestRateBase: {
          cometProxy: cometProxy.address,
          oldIRBase,
          newIRBase,
        }
      });
      expect(oldIRBase).to.be.not.equal(newIRBase);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).borrowPerYearInterestRateBase).to.be.equal(newIRBase);
      expect(annualize(await cometAsProxy.borrowPerSecondInterestRateBase()))
        .to.be.approximately(defactor(newIRBase), 0.00001);
    });

    it('sets storeFrontPriceFactor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator({
        assets: {
          USDC: { decimals: 6, },
          COMP: {
            decimals: 18,
            // This needs to be < 1e18 (default) so the StoreFrontPriceFactor can be < 1e18
            liquidationFactor: exp(0.8, 18),
          },
        },
      });

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).storeFrontPriceFactor).to.be.equal(await comet.storeFrontPriceFactor());

      const oldStoreFrontPriceFactor = (await comet.storeFrontPriceFactor()).toBigInt();
      const newStoreFrontPriceFactor = factor(0.95);
      const txn = await wait(configuratorAsProxy.setStoreFrontPriceFactor(cometProxy.address, newStoreFrontPriceFactor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetStoreFrontPriceFactor: {
          cometProxy: cometProxy.address,
          oldStoreFrontPriceFactor,
          newStoreFrontPriceFactor,
        }
      });
      expect(oldStoreFrontPriceFactor).to.be.not.equal(newStoreFrontPriceFactor);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).storeFrontPriceFactor).to.be.equal(newStoreFrontPriceFactor);
      expect(await cometAsProxy.storeFrontPriceFactor()).to.be.equal(newStoreFrontPriceFactor);
    });

    it('sets baseTrackingSupplySpeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseTrackingSupplySpeed).to.be.equal(await comet.baseTrackingSupplySpeed());

      const oldSpeed = (await comet.baseTrackingSupplySpeed()).toBigInt();
      const newSpeed = 100n;
      const txn = await wait(configuratorAsProxy.setBaseTrackingSupplySpeed(cometProxy.address, newSpeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseTrackingSupplySpeed: {
          cometProxy: cometProxy.address,
          oldBaseTrackingSupplySpeed: oldSpeed,
          newBaseTrackingSupplySpeed: newSpeed,
        }
      });
      expect(oldSpeed).to.be.not.equal(newSpeed);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseTrackingSupplySpeed).to.be.equal(newSpeed);
      expect(await cometAsProxy.baseTrackingSupplySpeed()).to.be.equal(newSpeed);
    });

    it('sets baseTrackingBorrowSpeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseTrackingBorrowSpeed).to.be.equal(await comet.baseTrackingBorrowSpeed());

      const oldSpeed = (await comet.baseTrackingBorrowSpeed()).toBigInt();
      const newSpeed = 100n;
      const txn = await wait(configuratorAsProxy.setBaseTrackingBorrowSpeed(cometProxy.address, newSpeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseTrackingBorrowSpeed: {
          cometProxy: cometProxy.address,
          oldBaseTrackingBorrowSpeed: oldSpeed,
          newBaseTrackingBorrowSpeed: newSpeed,
        }
      });
      expect(oldSpeed).to.be.not.equal(newSpeed);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseTrackingBorrowSpeed).to.be.equal(newSpeed);
      expect(await cometAsProxy.baseTrackingBorrowSpeed()).to.be.equal(newSpeed);
    });

    it('sets baseMinForRewards and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseMinForRewards).to.be.equal(await comet.baseMinForRewards());

      const oldBaseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
      const newBaseMinForRewards = 100n;
      const txn = await wait(configuratorAsProxy.setBaseMinForRewards(cometProxy.address, newBaseMinForRewards));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseMinForRewards: {
          cometProxy: cometProxy.address,
          oldBaseMinForRewards,
          newBaseMinForRewards,
        }
      });
      expect(oldBaseMinForRewards).to.be.not.equal(newBaseMinForRewards);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseMinForRewards).to.be.equal(newBaseMinForRewards);
      expect(await cometAsProxy.baseMinForRewards()).to.be.equal(newBaseMinForRewards);
    });

    it('sets baseBorrowMin and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseBorrowMin).to.be.equal(await comet.baseBorrowMin());

      const oldBaseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
      const newBaseBorrowMin = 100n;
      const txn = await wait(configuratorAsProxy.setBaseBorrowMin(cometProxy.address, newBaseBorrowMin));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseBorrowMin: {
          cometProxy: cometProxy.address,
          oldBaseBorrowMin,
          newBaseBorrowMin,
        }
      });
      expect(oldBaseBorrowMin).to.be.not.equal(newBaseBorrowMin);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).baseBorrowMin).to.be.equal(newBaseBorrowMin);
      expect(await cometAsProxy.baseBorrowMin()).to.be.equal(newBaseBorrowMin);
    });

    it('sets targetReserves and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).targetReserves).to.be.equal(await comet.targetReserves());

      const oldTargetReserves = (await comet.targetReserves()).toBigInt();
      const newTargetReserves = 100n;
      const txn = await wait(configuratorAsProxy.setTargetReserves(cometProxy.address, newTargetReserves));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetTargetReserves: {
          cometProxy: cometProxy.address,
          oldTargetReserves,
          newTargetReserves,
        }
      });
      expect(oldTargetReserves).to.be.not.equal(newTargetReserves);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).targetReserves).to.be.equal(newTargetReserves);
      expect(await cometAsProxy.targetReserves()).to.be.equal(newTargetReserves);
    });

    it('adds asset and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, unsupportedToken } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldNumAssets = await comet.numAssets();
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs.length).to.be.equal(oldNumAssets);

      const newAssetConfig: ConfiguratorAssetConfig = {
        asset: unsupportedToken.address,
        priceFeed: await comet.baseTokenPriceFeed(),
        decimals: await unsupportedToken.decimals(),
        borrowCollateralFactor: exp(0.9, 18),
        liquidateCollateralFactor: exp(1, 18),
        liquidationFactor: exp(0.95, 18),
        supplyCap: exp(1_000_000, 8),
      };
      const txn = await wait(configuratorAsProxy.addAsset(cometProxy.address, newAssetConfig));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        AddAsset: {
          cometProxy: cometProxy.address,
          assetConfig: convertToEventAssetConfig(newAssetConfig),
        }
      });
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs.length).to.be.equal(oldNumAssets + 1);
      expect(await cometAsProxy.numAssets()).to.be.equal(oldNumAssets + 1);
      expectAssetConfigsToMatch(newAssetConfig, await cometAsProxy.getAssetInfo(oldNumAssets));
    });

    it('updates asset and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldNumAssets = await comet.numAssets();
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs.length).to.be.equal(oldNumAssets);

      const oldAssetConfig = (await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0];
      const updatedAssetConfig: ConfiguratorAssetConfig = {
        asset: COMP.address,
        priceFeed: await comet.baseTokenPriceFeed(),
        decimals: await COMP.decimals(),
        borrowCollateralFactor: exp(0.5, 18),
        liquidateCollateralFactor: exp(0.6, 18),
        liquidationFactor: exp(0.8, 18),
        supplyCap: exp(888, 18),
      };
      const txn = await wait(configuratorAsProxy.updateAsset(cometProxy.address, updatedAssetConfig));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAsset: {
          cometProxy: cometProxy.address,
          oldAssetConfig: [
            oldAssetConfig.asset,
            oldAssetConfig.priceFeed,
            oldAssetConfig.decimals,
            oldAssetConfig.borrowCollateralFactor.toBigInt(),
            oldAssetConfig.liquidateCollateralFactor.toBigInt(),
            oldAssetConfig.liquidationFactor.toBigInt(),
            oldAssetConfig.supplyCap.toBigInt(),
          ],
          newAssetConfig: convertToEventAssetConfig(updatedAssetConfig),
        }
      });
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs.length).to.be.equal(oldNumAssets);
      expect(await cometAsProxy.numAssets()).to.be.equal(oldNumAssets);
      expectAssetConfigsToMatch(updatedAssetConfig, await cometAsProxy.getAssetInfo(0));
    });

    it('updates asset priceFeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens, priceFeeds } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].priceFeed)
        .to.be.equal((await comet.getAssetInfo(0)).priceFeed);

      const oldPriceFeed = (await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].priceFeed;
      const newPriceFeed = priceFeeds['WETH'].address;
      const txn = await wait(configuratorAsProxy.updateAssetPriceFeed(cometProxy.address, COMP.address, newPriceFeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetPriceFeed: {
          cometProxy: cometProxy.address,
          asset: COMP.address,
          oldPriceFeed,
          newPriceFeed,
        }
      });
      expect(oldPriceFeed).to.be.not.equal(newPriceFeed);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].priceFeed).to.be.equal(newPriceFeed);
      expect((await cometAsProxy.getAssetInfo(0)).priceFeed).to.be.equal(newPriceFeed);
    });

    it('updates asset borrowCollateralFactor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(truncateDecimals((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].borrowCollateralFactor))
        .to.be.equal((await comet.getAssetInfo(0)).borrowCollateralFactor);

      const oldBorrowCF = (await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].borrowCollateralFactor.toBigInt();
      const newBorrowCF = exp(0.5, 18);
      const txn = await wait(configuratorAsProxy.updateAssetBorrowCollateralFactor(cometProxy.address, COMP.address, newBorrowCF));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetBorrowCollateralFactor: {
          cometProxy: cometProxy.address,
          asset: COMP.address,
          oldBorrowCF,
          newBorrowCF,
        }
      });
      expect(oldBorrowCF).to.be.not.equal(newBorrowCF);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].borrowCollateralFactor).to.be.equal(newBorrowCF);
      expect((await cometAsProxy.getAssetInfo(0)).borrowCollateralFactor).to.be.equal(newBorrowCF);
    });

    it('updates asset liquidateCollateralFactor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator({
        assets: defaultAssets({}, {
          COMP: { borrowCF: exp(0.5, 18) }
        })
      });
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].liquidateCollateralFactor)
        .to.be.equal((await comet.getAssetInfo(0)).liquidateCollateralFactor);

      const oldLiquidateCF = (await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].liquidateCollateralFactor.toBigInt();
      const newLiquidateCF = exp(0.6, 18); // must be higher than borrowCF
      const txn = await wait(configuratorAsProxy.updateAssetLiquidateCollateralFactor(cometProxy.address, COMP.address, newLiquidateCF));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetLiquidateCollateralFactor: {
          cometProxy: cometProxy.address,
          asset: COMP.address,
          oldLiquidateCF,
          newLiquidateCF,
        }
      });
      expect(oldLiquidateCF).to.be.not.equal(newLiquidateCF);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].liquidateCollateralFactor).to.be.equal(newLiquidateCF);
      expect((await cometAsProxy.getAssetInfo(0)).liquidateCollateralFactor).to.be.equal(newLiquidateCF);
    });

    it('updates asset liquidationFactor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].liquidationFactor)
        .to.be.equal((await comet.getAssetInfo(0)).liquidationFactor);

      const oldLiquidationFactor = (await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].liquidationFactor.toBigInt();
      const newLiquidationFactor = exp(0.5, 18);
      const txn = await wait(configuratorAsProxy.updateAssetLiquidationFactor(cometProxy.address, COMP.address, newLiquidationFactor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetLiquidationFactor: {
          cometProxy: cometProxy.address,
          asset: COMP.address,
          oldLiquidationFactor,
          newLiquidationFactor,
        }
      });
      expect(oldLiquidationFactor).to.be.not.equal(newLiquidationFactor);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].liquidationFactor).to.be.equal(newLiquidationFactor);
      expect((await cometAsProxy.getAssetInfo(0)).liquidationFactor).to.be.equal(newLiquidationFactor);
    });

    it('updates asset supplyCap and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].supplyCap)
        .to.be.equal((await comet.getAssetInfo(0)).supplyCap);

      const oldSupplyCap = (await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].supplyCap.toBigInt();
      const newSupplyCap = exp(555, 18);
      const txn = await wait(configuratorAsProxy.updateAssetSupplyCap(cometProxy.address, COMP.address, newSupplyCap));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetSupplyCap: {
          cometProxy: cometProxy.address,
          asset: COMP.address,
          oldSupplyCap,
          newSupplyCap,
        }
      });
      expect(oldSupplyCap).to.be.not.equal(newSupplyCap);
      expect((await configuratorAsProxy.getConfiguration(cometProxy.address)).assetConfigs[0].supplyCap).to.be.equal(newSupplyCap);
      expect((await cometAsProxy.getAssetInfo(0)).supplyCap).to.be.equal(newSupplyCap);
    });

    it('reverts if updating a non-existent asset', async () => {
      const { configurator, configuratorProxy, cometProxy } = await makeConfigurator();

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);

      await expect(
        configuratorAsProxy.updateAssetSupplyCap(cometProxy.address, ethers.constants.AddressZero, exp(555, 18))
      ).to.be.revertedWith("custom error 'AssetDoesNotExist()'");
    });

    it('reverts if setter is called from non-governor', async () => {
      const { configuratorProxy, configurator, cometProxy, users: [alice] } = await makeConfigurator();

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      await expect(
        configuratorAsProxy.connect(alice).setGovernor(cometProxy.address, alice.address)
      ).to.be.revertedWith("custom error 'Unauthorized()'");
    });
  });
});
