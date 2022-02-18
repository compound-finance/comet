import { annualize, defactor, defaultAssets, ethers, event, exp, expect, factor, makeConfigurator, Numeric, truncateDecimals, wait } from './helpers';
import { SimplePriceFeed__factory, SimpleTimelock__factory } from '../build/types';
import { AssetInfoStructOutput } from '../build/types/CometHarnessInterface';

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
    const { configurator, configuratorProxy } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    const txn = await wait(configuratorAsProxy.deploy()) as any;
    const [ newCometAddress ] = txn.receipt.events.find(event => event.event === 'CometDeployed').args;

    expect(event(txn, 0)).to.be.deep.equal({
      CometDeployed: {
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

<<<<<<< HEAD
    expect(newCometAddress).to.not.be.equal(comet.address);
  });

  it('reverts if deploy is called from non-governor', async () => {
    const { configuratorProxy, proxyAdmin, cometProxy, users: [alice] } = await makeConfigurator();

    await expect(proxyAdmin.connect(alice).deployAndUpgradeTo(configuratorProxy.address, cometProxy.address)).to.be.revertedWith('Ownable: caller is not the owner');
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

    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(governor.address);

    // 1. SetGovernor
    // 2. DeployAndUpgradeTo
    let setGovernorCalldata = ethers.utils.defaultAbiCoder.encode(['address'], [alice.address]);
    let deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'address'], [configuratorProxy.address, cometProxy.address]);
    await timelock.executeTransactions([configuratorProxy.address, proxyAdmin.address], [0, 0], ['setGovernor(address)', 'deployAndUpgradeTo(address,address)'], [setGovernorCalldata, deployAndUpgradeToCalldata]);

    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(alice.address);
  });

  it('reverts if initialized more than once', async () => {
    const { governor, configurator, configuratorProxy, cometFactory } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    let configuration = await configuratorAsProxy.getConfiguration();
    await expect(configuratorAsProxy.initialize(governor.address, cometFactory.address, configuration)).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  describe('configuration setters', function () {
    it('sets governor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(await comet.governor());

      const oldGovernor = await comet.governor();
      const newGovernor = alice.address;
      const txn = await wait(configuratorAsProxy.setGovernor(newGovernor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetGovernor: {
          oldGovernor,
          newGovernor,
        }
      });
      expect(oldGovernor).to.be.not.equal(newGovernor);
      expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(newGovernor);
      expect(await cometAsProxy.governor()).to.be.equal(newGovernor);
    });

    it('sets pauseGuardian and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).pauseGuardian).to.be.equal(await comet.pauseGuardian());

      const oldPauseGuardian = await comet.pauseGuardian();
      const newPauseGuardian = alice.address;
      const txn = await wait(configuratorAsProxy.setPauseGuardian(newPauseGuardian));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetPauseGuardian: {
          oldPauseGuardian,
          newPauseGuardian,
        }
      });
      expect(oldPauseGuardian).to.be.not.equal(newPauseGuardian);
      expect((await configuratorAsProxy.getConfiguration()).pauseGuardian).to.be.equal(newPauseGuardian);
      expect(await cometAsProxy.pauseGuardian()).to.be.equal(newPauseGuardian);
    });

    it('sets baseTokenPriceFeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseTokenPriceFeed).to.be.equal(await comet.baseTokenPriceFeed());

      // Deploy new price feed
      const PriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
      const priceFeed = await PriceFeedFactory.deploy(exp(20, 8), 8);
      await priceFeed.deployed();

      const oldPriceFeed = await comet.baseTokenPriceFeed();
      const newPriceFeed = priceFeed.address;
      const txn = await wait(configuratorAsProxy.setBaseTokenPriceFeed(newPriceFeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseTokenPriceFeed: {
          oldBaseTokenPriceFeed: oldPriceFeed,
          newBaseTokenPriceFeed: newPriceFeed,
        }
      });
      expect(oldPriceFeed).to.be.not.equal(newPriceFeed);
      expect((await configuratorAsProxy.getConfiguration()).baseTokenPriceFeed).to.be.equal(newPriceFeed);
      expect(await cometAsProxy.baseTokenPriceFeed()).to.be.equal(newPriceFeed);
    });

    it('sets extensionDelegate and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).extensionDelegate).to.be.equal(await comet.extensionDelegate());

      const oldExt = await comet.extensionDelegate();
      const newExt = ethers.constants.AddressZero;
      const txn = await wait(configuratorAsProxy.setExtensionDelegate(newExt));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetExtensionDelegate: {
          oldExt,
          newExt,
        }
      });
      expect(oldExt).to.be.not.equal(newExt);
      expect((await configuratorAsProxy.getConfiguration()).extensionDelegate).to.be.equal(newExt);
      expect(await cometAsProxy.extensionDelegate()).to.be.equal(newExt);
    });

    it('sets kink and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).kink).to.be.equal(await comet.kink());

      const oldKink = (await comet.kink()).toBigInt();
      const newKink = 100n;
      const txn = await wait(configuratorAsProxy.setKink(newKink));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetKink: {
          oldKink,
          newKink,
        }
      });
      expect(oldKink).to.be.not.equal(newKink);
      expect((await configuratorAsProxy.getConfiguration()).kink).to.be.equal(newKink);
      expect(await cometAsProxy.kink()).to.be.equal(newKink);
    });

    it('sets perYearInterestRateSlopeLow and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration()).perYearInterestRateSlopeLow))
        .to.be.approximately(annualize(await comet.perSecondInterestRateSlopeLow()), 0.00001);

      const oldIRSlopeLow = (await configuratorAsProxy.getConfiguration()).perYearInterestRateSlopeLow.toBigInt();
      const newIRSlopeLow = exp(5.5, 18);
      const txn = await wait(configuratorAsProxy.setPerYearInterestRateSlopeLow(newIRSlopeLow));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetPerYearInterestRateSlopeLow: {
          oldIRSlopeLow,
          newIRSlopeLow,
        }
      });
      expect(oldIRSlopeLow).to.be.not.equal(newIRSlopeLow);
      expect((await configuratorAsProxy.getConfiguration()).perYearInterestRateSlopeLow).to.be.equal(newIRSlopeLow);
      expect(annualize(await cometAsProxy.perSecondInterestRateSlopeLow()))
        .to.be.approximately(defactor(newIRSlopeLow), 0.00001);
    });

    it('sets perYearInterestRateSlopeHigh and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration()).perYearInterestRateSlopeHigh))
        .to.be.approximately(annualize(await comet.perSecondInterestRateSlopeHigh()), 0.00001);

      const oldIRSlopeHigh = (await configuratorAsProxy.getConfiguration()).perYearInterestRateSlopeHigh.toBigInt();
      const newIRSlopeHigh = exp(5.5, 18);
      const txn = await wait(configuratorAsProxy.setPerYearInterestRateSlopeHigh(newIRSlopeHigh));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetPerYearInterestRateSlopeHigh: {
          oldIRSlopeHigh,
          newIRSlopeHigh,
        }
      });
      expect(oldIRSlopeHigh).to.be.not.equal(newIRSlopeHigh);
      expect((await configuratorAsProxy.getConfiguration()).perYearInterestRateSlopeHigh).to.be.equal(newIRSlopeHigh);
      expect(annualize(await cometAsProxy.perSecondInterestRateSlopeHigh()))
        .to.be.approximately(defactor(newIRSlopeHigh), 0.00001);
    });

    it('sets perYearInterestRateBase and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration()).perYearInterestRateBase))
        .to.be.approximately(annualize(await comet.perSecondInterestRateBase()), 0.00001);

      const oldIRBase = (await configuratorAsProxy.getConfiguration()).perYearInterestRateBase.toBigInt();
      const newIRBase = exp(5.5, 18);
      const txn = await wait(configuratorAsProxy.setPerYearInterestRateBase(newIRBase));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetPerYearInterestRateBase: {
          oldIRBase,
          newIRBase,
        }
      });
      expect(oldIRBase).to.be.not.equal(newIRBase);
      expect((await configuratorAsProxy.getConfiguration()).perYearInterestRateBase).to.be.equal(newIRBase);
      expect(annualize(await cometAsProxy.perSecondInterestRateBase()))
        .to.be.approximately(defactor(newIRBase), 0.00001);
    });

    it('sets reserveRate and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).reserveRate).to.be.equal(await comet.reserveRate());

      const oldReserveRate = (await comet.reserveRate()).toBigInt();
      const newReserveRate = 100n;
      const txn = await wait(configuratorAsProxy.setReserveRate(newReserveRate));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetReserveRate: {
          oldReserveRate,
          newReserveRate,
        }
      });
      expect(oldReserveRate).to.be.not.equal(newReserveRate);
      expect((await configuratorAsProxy.getConfiguration()).reserveRate).to.be.equal(newReserveRate);
      expect(await cometAsProxy.reserveRate()).to.be.equal(newReserveRate);
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
      expect((await configuratorAsProxy.getConfiguration()).storeFrontPriceFactor).to.be.equal(await comet.storeFrontPriceFactor());

      const oldStoreFrontPriceFactor = (await comet.storeFrontPriceFactor()).toBigInt();
      const newStoreFrontPriceFactor = factor(0.95);
      const txn = await wait(configuratorAsProxy.setStoreFrontPriceFactor(newStoreFrontPriceFactor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetStoreFrontPriceFactor: {
          oldStoreFrontPriceFactor,
          newStoreFrontPriceFactor,
        }
      });
      expect(oldStoreFrontPriceFactor).to.be.not.equal(newStoreFrontPriceFactor);
      expect((await configuratorAsProxy.getConfiguration()).storeFrontPriceFactor).to.be.equal(newStoreFrontPriceFactor);
      expect(await cometAsProxy.storeFrontPriceFactor()).to.be.equal(newStoreFrontPriceFactor);
    });

    it('sets baseTrackingSupplySpeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingSupplySpeed).to.be.equal(await comet.baseTrackingSupplySpeed());

      const oldSpeed = (await comet.baseTrackingSupplySpeed()).toBigInt();
      const newSpeed = 100n;
      const txn = await wait(configuratorAsProxy.setBaseTrackingSupplySpeed(newSpeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseTrackingSupplySpeed: {
          oldBaseTrackingSupplySpeed: oldSpeed,
          newBaseTrackingSupplySpeed: newSpeed,
        }
      });
      expect(oldSpeed).to.be.not.equal(newSpeed);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingSupplySpeed).to.be.equal(newSpeed);
      expect(await cometAsProxy.baseTrackingSupplySpeed()).to.be.equal(newSpeed);
    });

    it('sets baseTrackingBorrowSpeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingBorrowSpeed).to.be.equal(await comet.baseTrackingBorrowSpeed());

      const oldSpeed = (await comet.baseTrackingBorrowSpeed()).toBigInt();
      const newSpeed = 100n;
      const txn = await wait(configuratorAsProxy.setBaseTrackingBorrowSpeed(newSpeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseTrackingBorrowSpeed: {
          oldBaseTrackingBorrowSpeed: oldSpeed,
          newBaseTrackingBorrowSpeed: newSpeed,
        }
      });
      expect(oldSpeed).to.be.not.equal(newSpeed);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingBorrowSpeed).to.be.equal(newSpeed);
      expect(await cometAsProxy.baseTrackingBorrowSpeed()).to.be.equal(newSpeed);
    });

    it('sets baseMinForRewards and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseMinForRewards).to.be.equal(await comet.baseMinForRewards());

      const oldBaseMinForRewards = (await comet.baseMinForRewards()).toBigInt();
      const newBaseMinForRewards = 100n;
      const txn = await wait(configuratorAsProxy.setBaseMinForRewards(newBaseMinForRewards));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseMinForRewards: {
          oldBaseMinForRewards,
          newBaseMinForRewards,
        }
      });
      expect(oldBaseMinForRewards).to.be.not.equal(newBaseMinForRewards);
      expect((await configuratorAsProxy.getConfiguration()).baseMinForRewards).to.be.equal(newBaseMinForRewards);
      expect(await cometAsProxy.baseMinForRewards()).to.be.equal(newBaseMinForRewards);
    });

    it('sets baseBorrowMin and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseBorrowMin).to.be.equal(await comet.baseBorrowMin());

      const oldBaseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
      const newBaseBorrowMin = 100n;
      const txn = await wait(configuratorAsProxy.setBaseBorrowMin(newBaseBorrowMin));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetBaseBorrowMin: {
          oldBaseBorrowMin,
          newBaseBorrowMin,
        }
      });
      expect(oldBaseBorrowMin).to.be.not.equal(newBaseBorrowMin);
      expect((await configuratorAsProxy.getConfiguration()).baseBorrowMin).to.be.equal(newBaseBorrowMin);
      expect(await cometAsProxy.baseBorrowMin()).to.be.equal(newBaseBorrowMin);
    });

    it('sets targetReserves and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).targetReserves).to.be.equal(await comet.targetReserves());

      const oldTargetReserves = (await comet.targetReserves()).toBigInt();
      const newTargetReserves = 100n;
      const txn = await wait(configuratorAsProxy.setTargetReserves(newTargetReserves));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        SetTargetReserves: {
          oldTargetReserves,
          newTargetReserves,
        }
      });
      expect(oldTargetReserves).to.be.not.equal(newTargetReserves);
      expect((await configuratorAsProxy.getConfiguration()).targetReserves).to.be.equal(newTargetReserves);
      expect(await cometAsProxy.targetReserves()).to.be.equal(newTargetReserves);
    });

    it('adds asset and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, unsupportedToken } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldNumAssets = await comet.numAssets();
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs.length).to.be.equal(oldNumAssets);

      const newAssetConfig: ConfiguratorAssetConfig = {
        asset: unsupportedToken.address,
        priceFeed: await comet.baseTokenPriceFeed(),
        decimals: await unsupportedToken.decimals(),
        borrowCollateralFactor: exp(0.9, 18),
        liquidateCollateralFactor: exp(1, 18),
        liquidationFactor: exp(0.95, 18),
        supplyCap: exp(1_000_000, 8),
      };
      const txn = await wait(configuratorAsProxy.addAsset(newAssetConfig));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        AddAsset: {
          assetConfig: convertToEventAssetConfig(newAssetConfig),
        }
      });
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs.length).to.be.equal(oldNumAssets + 1);
      expect(await cometAsProxy.numAssets()).to.be.equal(oldNumAssets + 1);
      expectAssetConfigsToMatch(newAssetConfig, await cometAsProxy.getAssetInfo(oldNumAssets));
    });

    it('updates asset and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldNumAssets = await comet.numAssets();
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs.length).to.be.equal(oldNumAssets);

      const oldAssetConfig = (await configuratorAsProxy.getConfiguration()).assetConfigs[0];
      const updatedAssetConfig: ConfiguratorAssetConfig = {
        asset: COMP.address,
        priceFeed: await comet.baseTokenPriceFeed(),
        decimals: await COMP.decimals(),
        borrowCollateralFactor: exp(0.5, 18),
        liquidateCollateralFactor: exp(0.6, 18),
        liquidationFactor: exp(0.8, 18),
        supplyCap: exp(888, 18),
      };
      const txn = await wait(configuratorAsProxy.updateAsset(updatedAssetConfig));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAsset: {
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
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs.length).to.be.equal(oldNumAssets);
      expect(await cometAsProxy.numAssets()).to.be.equal(oldNumAssets);
      expectAssetConfigsToMatch(updatedAssetConfig, await cometAsProxy.getAssetInfo(0));
    });

    it('updates asset priceFeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens, priceFeeds } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].priceFeed)
        .to.be.equal((await comet.getAssetInfo(0)).priceFeed);

      const oldPriceFeed = (await configuratorAsProxy.getConfiguration()).assetConfigs[0].priceFeed;
      const newPriceFeed = priceFeeds['WETH'].address;
      const txn = await wait(configuratorAsProxy.updateAssetPriceFeed(COMP.address, newPriceFeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetPriceFeed: {
          asset: COMP.address,
          oldPriceFeed,
          newPriceFeed,
        }
      });
      expect(oldPriceFeed).to.be.not.equal(newPriceFeed);
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].priceFeed).to.be.equal(newPriceFeed);
      expect((await cometAsProxy.getAssetInfo(0)).priceFeed).to.be.equal(newPriceFeed);
    });

    it('updates asset borrowCollateralFactor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(truncateDecimals((await configuratorAsProxy.getConfiguration()).assetConfigs[0].borrowCollateralFactor))
        .to.be.equal((await comet.getAssetInfo(0)).borrowCollateralFactor);

      const oldBorrowCF = (await configuratorAsProxy.getConfiguration()).assetConfigs[0].borrowCollateralFactor.toBigInt();
      const newBorrowCF = exp(0.5, 18);
      const txn = await wait(configuratorAsProxy.updateAssetBorrowCollateralFactor(COMP.address, newBorrowCF));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetBorrowCollateralFactor: {
          asset: COMP.address,
          oldBorrowCF,
          newBorrowCF,
        }
      });
      expect(oldBorrowCF).to.be.not.equal(newBorrowCF);
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].borrowCollateralFactor).to.be.equal(newBorrowCF);
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
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].liquidateCollateralFactor)
        .to.be.equal((await comet.getAssetInfo(0)).liquidateCollateralFactor);

      const oldLiquidateCF = (await configuratorAsProxy.getConfiguration()).assetConfigs[0].liquidateCollateralFactor.toBigInt();
      const newLiquidateCF = exp(0.6, 18); // must be higher than borrowCF
      const txn = await wait(configuratorAsProxy.updateAssetLiquidateCollateralFactor(COMP.address, newLiquidateCF));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetLiquidateCollateralFactor: {
          asset: COMP.address,
          oldLiquidateCF,
          newLiquidateCF,
        }
      });
      expect(oldLiquidateCF).to.be.not.equal(newLiquidateCF);
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].liquidateCollateralFactor).to.be.equal(newLiquidateCF);
      expect((await cometAsProxy.getAssetInfo(0)).liquidateCollateralFactor).to.be.equal(newLiquidateCF);
    });

    it('updates asset liquidationFactor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].liquidationFactor)
        .to.be.equal((await comet.getAssetInfo(0)).liquidationFactor);

      const oldLiquidationFactor = (await configuratorAsProxy.getConfiguration()).assetConfigs[0].liquidationFactor.toBigInt();
      const newLiquidationFactor = exp(0.5, 18);
      const txn = await wait(configuratorAsProxy.updateAssetLiquidationFactor(COMP.address, newLiquidationFactor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetLiquidationFactor: {
          asset: COMP.address,
          oldLiquidationFactor,
          newLiquidationFactor,
        }
      });
      expect(oldLiquidationFactor).to.be.not.equal(newLiquidationFactor);
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].liquidationFactor).to.be.equal(newLiquidationFactor);
      expect((await cometAsProxy.getAssetInfo(0)).liquidationFactor).to.be.equal(newLiquidationFactor);
    });

    it('updates asset supplyCap and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].supplyCap)
        .to.be.equal((await comet.getAssetInfo(0)).supplyCap);

      const oldSupplyCap = (await configuratorAsProxy.getConfiguration()).assetConfigs[0].supplyCap.toBigInt();
      const newSupplyCap = exp(555, 18);
      const txn = await wait(configuratorAsProxy.updateAssetSupplyCap(COMP.address, newSupplyCap));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(event(txn, 0)).to.be.deep.equal({
        UpdateAssetSupplyCap: {
          asset: COMP.address,
          oldSupplyCap,
          newSupplyCap,
        }
      });
      expect(oldSupplyCap).to.be.not.equal(newSupplyCap);
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].supplyCap).to.be.equal(newSupplyCap);
      expect((await cometAsProxy.getAssetInfo(0)).supplyCap).to.be.equal(newSupplyCap);
    });

    it('reverts if updating a non-existent asset', async () => {
      const { configurator, configuratorProxy } = await makeConfigurator();

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);

      await expect(
        configuratorAsProxy.updateAssetSupplyCap(ethers.constants.AddressZero, exp(555, 18))
      ).to.be.revertedWith("custom error 'AssetDoesNotExist()'");
    });

    it('reverts if setter is called from non-governor', async () => {
      const { configuratorProxy, configurator, users: [alice] } = await makeConfigurator();

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      await expect(
        configuratorAsProxy.connect(alice).setGovernor(alice.address)
      ).to.be.revertedWith("custom error 'Unauthorized()'");
    });
=======
  it.skip('sets entire Configuration and deploys Comet with new configuration', async () => {
  });

  it('sets governor and deploys Comet with new configuration', async () => {
    const { governor, configurator, proxyAdmin, users: [alice] } = await makeConfigurator();

    expect(await configurator.governorParam()).to.be.equal(governor.address);

    await wait(proxyAdmin.connect(governor).setGovernor(configurator.address, alice.address));
    await wait(proxyAdmin.connect(governor).deployAndUpgrade(configurator.address));

    expect(await configurator.governorParam()).to.be.equal(alice.address);
  });

  it.skip('adds asset and deploys Comet with new configuration', async () => {
  });

  it('packs asset configs correctly', async () => {
    const { governor, configurator, proxyAdmin, comet, tokens, users: [alice] } = await makeConfigurator({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.9, 18),
          liquidateCF: exp(0.95, 18),
          liquidationFactor: exp(0.95, 18),
          supplyCap: exp(1_000_000, 18),
        },
      },
    });

    await wait(proxyAdmin.connect(governor).deployAndUpgrade(configurator.address));

    // Verify Comet address has changed
    const newCometAddress = await proxyAdmin.getProxyImplementation(configurator.address);
    expect(newCometAddress).to.not.be.equal(comet.address);

    const CometFactory = (await ethers.getContractFactory('Comet')) as Comet__factory;
    const newComet = CometFactory.attach(newCometAddress);

    // Verify assets are correctly set
    const cometNumAssets = await newComet.numAssets();
    expect(cometNumAssets).to.be.equal(1);
    const assetInfo00 = await comet.getAssetInfo(0);
    expect(assetInfo00.asset).to.be.equal(tokens['COMP'].address);
    expect(assetInfo00.scale).to.equal(exp(1, 18));
    expect(assetInfo00.borrowCollateralFactor).to.equal(exp(0.9, 18));
    expect(assetInfo00.liquidateCollateralFactor).to.equal(exp(0.95, 18));
    expect(assetInfo00.supplyCap).to.equal(exp(1_000_000, 18));
  });

  it('reverts if deploy is called from non-governor', async () => {
    const { configurator, proxyAdmin, users: [alice] } = await makeConfigurator();

    await expect(proxyAdmin.connect(alice).deployAndUpgrade(configurator.address)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('reverts if deploy is called directly in Configurator instead of from ProxyAdmin', async () => {
    const { configurator, users: [alice] } = await makeConfigurator();

    await expect(configurator.connect(alice).deployAndUpgrade()).to.be.revertedWith(`function selector was not recognized and there's no fallback function`);
>>>>>>> 6315557 (Add more configurator unit tests and fix asset config bug in configurator)
  });
});
