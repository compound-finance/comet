import { annualize, defactor, defaultAssets, ethers, exp, expect, makeConfigurator, Numeric, truncateDecimals, wait } from './helpers';
import { SimplePriceFeed__factory, SimpleTimelock__factory } from '../build/types';
import { AssetInfoStructOutput } from '../build/types/CometHarnessInterface';

type ConfiguratorAssetConfig = {
  asset: string,
  priceFeed: string,
  decimals: Numeric,
  borrowCollateralFactor: Numeric,
  liquidateCollateralFactor: Numeric,
  liquidationFactor: Numeric,
  supplyCap: Numeric,
};

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
    const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.be.equal(comet.address);
    expect(await proxyAdmin.getProxyImplementation(configuratorProxy.address)).to.be.equal(configurator.address);

    await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.not.be.equal(comet.address);
  });

  it('reverts if deploy is called from non-governor', async () => {
    const { configuratorProxy, proxyAdmin, cometProxy, users: [alice] } = await makeConfigurator();

    await expect(proxyAdmin.connect(alice).deployAndUpgradeTo(configuratorProxy.address, cometProxy.address)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('e2e governance actions from timelock', async () => {
    const { governor, configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

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
    let setGovernorCalldata = ethers.utils.defaultAbiCoder.encode(["address"], [alice.address]);
    let deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(["address", "address"], [configuratorProxy.address, cometProxy.address]);
    await timelock.executeTransactions([configuratorProxy.address, proxyAdmin.address], [0, 0], ["setGovernor(address)", "deployAndUpgradeTo(address,address)"], [setGovernorCalldata, deployAndUpgradeToCalldata]);

    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(alice.address);
  });

  it('reverts if initialized more than once', async () => {
    const { governor, configurator, configuratorProxy, cometFactory } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    let configuration = await configuratorAsProxy.getConfiguration();
    await expect(configuratorAsProxy.initialize(governor.address, cometFactory.address, configuration)).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  // XXX test events
  describe('configuration setters', function () {
    it('sets governor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(await comet.governor());

      const oldGovernor = await comet.governor();
      const newGovernor = alice.address;
      await wait(configuratorAsProxy.setGovernor(newGovernor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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
      await wait(configuratorAsProxy.setPauseGuardian(newPauseGuardian));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldPauseGuardian).to.be.not.equal(newPauseGuardian);
      expect((await configuratorAsProxy.getConfiguration()).pauseGuardian).to.be.equal(newPauseGuardian);
      expect(await cometAsProxy.pauseGuardian()).to.be.equal(newPauseGuardian);
    });

    it('sets baseToken and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseToken).to.be.equal(await comet.baseToken());

      const oldBaseToken = await comet.baseToken();
      const newBaseToken = COMP.address;
      await wait(configuratorAsProxy.setBaseToken(newBaseToken));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldBaseToken).to.be.not.equal(newBaseToken);
      expect((await configuratorAsProxy.getConfiguration()).baseToken).to.be.equal(newBaseToken);
      expect(await cometAsProxy.baseToken()).to.be.equal(newBaseToken);
    });

    it('sets baseTokenPriceFeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, priceFeeds } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseTokenPriceFeed).to.be.equal(await comet.baseTokenPriceFeed());

      // Deploy new price feed
      const PriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
      const priceFeed = await PriceFeedFactory.deploy(exp(20, 8), 8);
      await priceFeed.deployed();

      const oldPriceFeed = await comet.baseTokenPriceFeed();
      const newPriceFeed = priceFeed.address;
      await wait(configuratorAsProxy.setBaseTokenPriceFeed(newPriceFeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldPriceFeed).to.be.not.equal(newPriceFeed);
      expect((await configuratorAsProxy.getConfiguration()).baseTokenPriceFeed).to.be.equal(newPriceFeed);
      expect(await cometAsProxy.baseTokenPriceFeed()).to.be.equal(newPriceFeed);
    });

    it('sets extensionDelegate and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).extensionDelegate).to.be.equal(await comet.extensionDelegate());

      const oldExtDelegate = await comet.extensionDelegate();
      const newExtDelegate = ethers.constants.AddressZero;
      await wait(configuratorAsProxy.setExtensionDelegate(newExtDelegate));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldExtDelegate).to.be.not.equal(newExtDelegate);
      expect((await configuratorAsProxy.getConfiguration()).extensionDelegate).to.be.equal(newExtDelegate);
      expect(await cometAsProxy.extensionDelegate()).to.be.equal(newExtDelegate);
    });

    it('sets kink and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).kink).to.be.equal(await comet.kink());

      const oldKink = await comet.kink();
      const newKink = 100;
      await wait(configuratorAsProxy.setKink(newKink));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const oldIRSlopeLow = (await configuratorAsProxy.getConfiguration()).perYearInterestRateSlopeLow;
      const newIRSlopeLow = exp(5.5, 18);
      await wait(configuratorAsProxy.setPerYearInterestRateSlopeLow(newIRSlopeLow));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const oldIRSlopeHigh = (await configuratorAsProxy.getConfiguration()).perYearInterestRateSlopeHigh;
      const newIRSlopeHigh = exp(5.5, 18);
      await wait(configuratorAsProxy.setPerYearInterestRateSlopeHigh(newIRSlopeHigh));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const oldIRBase = (await configuratorAsProxy.getConfiguration()).perYearInterestRateBase;
      const newIRBase = exp(5.5, 18);
      await wait(configuratorAsProxy.setPerYearInterestRateBase(newIRBase));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const oldReserveRate = await comet.reserveRate();
      const newReserveRate = 100;
      await wait(configuratorAsProxy.setReserveRate(newReserveRate));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldReserveRate).to.be.not.equal(newReserveRate);
      expect((await configuratorAsProxy.getConfiguration()).reserveRate).to.be.equal(newReserveRate);
      expect(await cometAsProxy.reserveRate()).to.be.equal(newReserveRate);
    });

    it('sets storeFrontPriceFactor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).storeFrontPriceFactor).to.be.equal(await comet.storeFrontPriceFactor());

      const oldStoreFrontPriceFactor = await comet.storeFrontPriceFactor();
      const newStoreFrontPriceFactor = 100;
      await wait(configuratorAsProxy.setStoreFrontPriceFactor(newStoreFrontPriceFactor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldStoreFrontPriceFactor).to.be.not.equal(newStoreFrontPriceFactor);
      expect((await configuratorAsProxy.getConfiguration()).storeFrontPriceFactor).to.be.equal(newStoreFrontPriceFactor);
      expect(await cometAsProxy.storeFrontPriceFactor()).to.be.equal(newStoreFrontPriceFactor);
    });

    it('sets trackingIndexScale and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).trackingIndexScale).to.be.equal(await comet.trackingIndexScale());

      const oldTrackingIndexScale = await comet.trackingIndexScale();
      const newTrackingIndexScale = 100;
      await wait(configuratorAsProxy.setTrackingIndexScale(newTrackingIndexScale));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldTrackingIndexScale).to.be.not.equal(newTrackingIndexScale);
      expect((await configuratorAsProxy.getConfiguration()).trackingIndexScale).to.be.equal(newTrackingIndexScale);
      expect(await cometAsProxy.trackingIndexScale()).to.be.equal(newTrackingIndexScale);
    });

    it('sets baseTrackingSupplySpeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingSupplySpeed).to.be.equal(await comet.baseTrackingSupplySpeed());

      const oldSpeed = await comet.baseTrackingSupplySpeed();
      const newSpeed = 100;
      await wait(configuratorAsProxy.setBaseTrackingSupplySpeed(newSpeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldSpeed).to.be.not.equal(newSpeed);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingSupplySpeed).to.be.equal(newSpeed);
      expect(await cometAsProxy.baseTrackingSupplySpeed()).to.be.equal(newSpeed);
    });

    it('sets baseTrackingBorrowSpeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingBorrowSpeed).to.be.equal(await comet.baseTrackingBorrowSpeed());

      const oldSpeed = await comet.baseTrackingBorrowSpeed();
      const newSpeed = 100;
      await wait(configuratorAsProxy.setBaseTrackingBorrowSpeed(newSpeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldSpeed).to.be.not.equal(newSpeed);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingBorrowSpeed).to.be.equal(newSpeed);
      expect(await cometAsProxy.baseTrackingBorrowSpeed()).to.be.equal(newSpeed);
    });

    it('sets baseMinForRewards and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseMinForRewards).to.be.equal(await comet.baseMinForRewards());

      const oldBaseMinForRewards = await comet.baseMinForRewards();
      const newBaseMinForRewards = 100;
      await wait(configuratorAsProxy.setBaseMinForRewards(newBaseMinForRewards));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldBaseMinForRewards).to.be.not.equal(newBaseMinForRewards);
      expect((await configuratorAsProxy.getConfiguration()).baseMinForRewards).to.be.equal(newBaseMinForRewards);
      expect(await cometAsProxy.baseMinForRewards()).to.be.equal(newBaseMinForRewards);
    });

    it('sets baseBorrowMin and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseBorrowMin).to.be.equal(await comet.baseBorrowMin());

      const oldBaseBorrowMin = await comet.baseBorrowMin();
      const newBaseBorrowMin = 100;
      await wait(configuratorAsProxy.setBaseBorrowMin(newBaseBorrowMin));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldBaseBorrowMin).to.be.not.equal(newBaseBorrowMin);
      expect((await configuratorAsProxy.getConfiguration()).baseBorrowMin).to.be.equal(newBaseBorrowMin);
      expect(await cometAsProxy.baseBorrowMin()).to.be.equal(newBaseBorrowMin);
    });

    it('sets targetReserves and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).targetReserves).to.be.equal(await comet.targetReserves());

      const oldTargetReserves = await comet.targetReserves();
      const newTargetReserves = 100;
      await wait(configuratorAsProxy.setTargetReserves(newTargetReserves));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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
      await wait(configuratorAsProxy.addAsset(newAssetConfig));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).assetConfigs.length).to.be.equal(oldNumAssets + 1);
      expect(await cometAsProxy.numAssets()).to.be.equal(oldNumAssets + 1);
      expectAssetConfigsToMatch(newAssetConfig, await cometAsProxy.getAssetInfo(oldNumAssets));
    });

    it('updates asset and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens, unsupportedToken } = await makeConfigurator();
      const { COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldNumAssets = await comet.numAssets();
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs.length).to.be.equal(oldNumAssets);

      const updatedAssetConfig: ConfiguratorAssetConfig = {
        asset: COMP.address,
        priceFeed: await comet.baseTokenPriceFeed(),
        decimals: await COMP.decimals(),
        borrowCollateralFactor: exp(0.5, 18),
        liquidateCollateralFactor: exp(0.6, 18),
        liquidationFactor: exp(0.8, 18),
        supplyCap: exp(888, 18),
      };
      await wait(configuratorAsProxy.updateAsset(updatedAssetConfig));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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
      await wait(configuratorAsProxy.updateAssetPriceFeed(COMP.address, newPriceFeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const oldBorrowCF = (await configuratorAsProxy.getConfiguration()).assetConfigs[0].borrowCollateralFactor;
      const newBorrowCF = exp(0.5, 18);
      await wait(configuratorAsProxy.updateAssetBorrowCollateralFactor(COMP.address, newBorrowCF));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const oldLiquidateCF = (await configuratorAsProxy.getConfiguration()).assetConfigs[0].liquidateCollateralFactor;
      const newLiquidateCF = exp(0.6, 18); // must be higher than borrowCF
      await wait(configuratorAsProxy.updateAssetLiquidateCollateralFactor(COMP.address, newLiquidateCF));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const oldLiquidationFactor = (await configuratorAsProxy.getConfiguration()).assetConfigs[0].liquidationFactor;
      const newLiquidationFactor = exp(0.5, 18);
      await wait(configuratorAsProxy.updateAssetLiquidationFactor(COMP.address, newLiquidationFactor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const oldSupplyCap = (await configuratorAsProxy.getConfiguration()).assetConfigs[0].supplyCap;
      const newSupplyCap = exp(555, 18);
      await wait(configuratorAsProxy.updateAssetSupplyCap(COMP.address, newSupplyCap));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect(oldSupplyCap).to.be.not.equal(newSupplyCap);
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs[0].supplyCap).to.be.equal(newSupplyCap);
      expect((await cometAsProxy.getAssetInfo(0)).supplyCap).to.be.equal(newSupplyCap);
    });

    it('reverts if setter is called from non-governor', async () => {
      const { configuratorProxy, configurator, users: [alice] } = await makeConfigurator();

      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      await expect(
        configuratorAsProxy.connect(alice).setGovernor(alice.address)
      ).to.be.revertedWith("custom error 'Unauthorized()'");
    });
  });
});