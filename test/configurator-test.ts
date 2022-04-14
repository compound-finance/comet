import { annualize, defactor, ethers, exp, expect, makeConfigurator, wait } from './helpers';
import { SimpleTimelock__factory } from '../build/types';

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

  describe('configuration setters', function () {
    it('sets governor and deploys Comet with new configuration', async () => {
      const { governor, configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(governor.address);

      const newGovernor = alice.address;
      await wait(configuratorAsProxy.setGovernor(newGovernor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(newGovernor);
      expect(await cometAsProxy.governor()).to.be.equal(newGovernor);
    });

    it('sets pauseGuardian and deploys Comet with new configuration', async () => {
      const { pauseGuardian, configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).pauseGuardian).to.be.equal(pauseGuardian.address);

      const newPauseGuardian = alice.address;
      await wait(configuratorAsProxy.setPauseGuardian(newPauseGuardian));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).pauseGuardian).to.be.equal(newPauseGuardian);
      expect(await cometAsProxy.pauseGuardian()).to.be.equal(newPauseGuardian);
    });

    it('sets baseToken and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens } = await makeConfigurator();
      const { USDC, COMP } = tokens;

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseToken).to.be.equal(USDC.address);

      const newBaseToken = COMP.address;
      await wait(configuratorAsProxy.setBaseToken(newBaseToken));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).baseToken).to.be.equal(newBaseToken);
      expect(await cometAsProxy.baseToken()).to.be.equal(newBaseToken);
    });

    it('sets baseTokenPriceFeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, priceFeeds } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseTokenPriceFeed).to.be.equal(await comet.baseTokenPriceFeed());

      const newPriceFeed = priceFeeds['USDC'].address;
      await wait(configuratorAsProxy.setBaseTokenPriceFeed(newPriceFeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).baseTokenPriceFeed).to.be.equal(newPriceFeed);
      expect(await cometAsProxy.baseTokenPriceFeed()).to.be.equal(newPriceFeed);
    });

    it('sets extensionDelegate and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).extensionDelegate).to.be.equal(await comet.extensionDelegate());

      const newExtDelegate = ethers.constants.AddressZero;
      await wait(configuratorAsProxy.setExtensionDelegate(newExtDelegate));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).extensionDelegate).to.be.equal(newExtDelegate);
      expect(await cometAsProxy.extensionDelegate()).to.be.equal(newExtDelegate);
    });

    it('sets kink and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).kink).to.be.equal(await comet.kink());

      const newKink = 100;
      await wait(configuratorAsProxy.setKink(newKink));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).kink).to.be.equal(newKink);
      expect(await cometAsProxy.kink()).to.be.equal(newKink);
    });

    it('sets perYearInterestRateSlopeLow and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect(defactor((await configuratorAsProxy.getConfiguration()).perYearInterestRateSlopeLow))
        .to.be.approximately(annualize(await comet.perSecondInterestRateSlopeLow()), 0.00001);

      const newIRSlopeLow = exp(5.5, 18);
      await wait(configuratorAsProxy.setPerYearInterestRateSlopeLow(newIRSlopeLow));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const newIRSlopeHigh = exp(5.5, 18);
      await wait(configuratorAsProxy.setPerYearInterestRateSlopeHigh(newIRSlopeHigh));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

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

      const newIRBase = exp(5.5, 18);
      await wait(configuratorAsProxy.setPerYearInterestRateBase(newIRBase));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).perYearInterestRateBase).to.be.equal(newIRBase);
      expect(annualize(await cometAsProxy.perSecondInterestRateBase()))
        .to.be.approximately(defactor(newIRBase), 0.00001);
    });

    it('sets reserveRate and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).reserveRate).to.be.equal(await comet.reserveRate());

      const newReserveRate = 100;
      await wait(configuratorAsProxy.setReserveRate(newReserveRate));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).reserveRate).to.be.equal(newReserveRate);
      expect(await cometAsProxy.reserveRate()).to.be.equal(newReserveRate);
    });

    it('sets storeFrontPriceFactor and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).storeFrontPriceFactor).to.be.equal(await comet.storeFrontPriceFactor());

      const newStoreFrontPriceFactor = 100;
      await wait(configuratorAsProxy.setStoreFrontPriceFactor(newStoreFrontPriceFactor));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).storeFrontPriceFactor).to.be.equal(newStoreFrontPriceFactor);
      expect(await cometAsProxy.storeFrontPriceFactor()).to.be.equal(newStoreFrontPriceFactor);
    });

    it('sets trackingIndexScale and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).trackingIndexScale).to.be.equal(await comet.trackingIndexScale());

      const newTrackingIndexScale = 100;
      await wait(configuratorAsProxy.setTrackingIndexScale(newTrackingIndexScale));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).trackingIndexScale).to.be.equal(newTrackingIndexScale);
      expect(await cometAsProxy.trackingIndexScale()).to.be.equal(newTrackingIndexScale);
    });

    it('sets baseTrackingSupplySpeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingSupplySpeed).to.be.equal(await comet.baseTrackingSupplySpeed());

      const newSpeed = 100;
      await wait(configuratorAsProxy.setBaseTrackingSupplySpeed(newSpeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).baseTrackingSupplySpeed).to.be.equal(newSpeed);
      expect(await cometAsProxy.baseTrackingSupplySpeed()).to.be.equal(newSpeed);
    });

    it('sets baseTrackingBorrowSpeed and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseTrackingBorrowSpeed).to.be.equal(await comet.baseTrackingBorrowSpeed());

      const newSpeed = 100;
      await wait(configuratorAsProxy.setBaseTrackingBorrowSpeed(newSpeed));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).baseTrackingBorrowSpeed).to.be.equal(newSpeed);
      expect(await cometAsProxy.baseTrackingBorrowSpeed()).to.be.equal(newSpeed);
    });

    it('sets baseMinForRewards and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseMinForRewards).to.be.equal(await comet.baseMinForRewards());

      const newBaseMinForRewards = 100;
      await wait(configuratorAsProxy.setBaseMinForRewards(newBaseMinForRewards));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).baseMinForRewards).to.be.equal(newBaseMinForRewards);
      expect(await cometAsProxy.baseMinForRewards()).to.be.equal(newBaseMinForRewards);
    });

    it('sets baseBorrowMin and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).baseBorrowMin).to.be.equal(await comet.baseBorrowMin());

      const newBaseBorrowMin = 100;
      await wait(configuratorAsProxy.setBaseBorrowMin(newBaseBorrowMin));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).baseBorrowMin).to.be.equal(newBaseBorrowMin);
      expect(await cometAsProxy.baseBorrowMin()).to.be.equal(newBaseBorrowMin);
    });

    it('sets targetReserves and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      expect((await configuratorAsProxy.getConfiguration()).targetReserves).to.be.equal(await comet.targetReserves());

      const newTargetReserves = 100;
      await wait(configuratorAsProxy.setTargetReserves(newTargetReserves));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).targetReserves).to.be.equal(newTargetReserves);
      expect(await cometAsProxy.targetReserves()).to.be.equal(newTargetReserves);
    });

    it('adds asset and deploys Comet with new configuration', async () => {
      const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy, tokens, unsupportedToken } = await makeConfigurator();

      const cometAsProxy = comet.attach(cometProxy.address);
      const configuratorAsProxy = configurator.attach(configuratorProxy.address);
      const oldNumAssets = await comet.numAssets();
      expect((await configuratorAsProxy.getConfiguration()).assetConfigs.length).to.be.equal(oldNumAssets);

      const newAssetConfig = {
        asset: unsupportedToken.address,
        priceFeed: await comet.baseTokenPriceFeed(),
        decimals: await unsupportedToken.decimals(),
        borrowCollateralFactor: (0.9e18).toString(),
        liquidateCollateralFactor: (1e18).toString(),
        liquidationFactor: (0.95e18).toString(),
        supplyCap: (1000000e8).toString(),
      };
      await wait(configuratorAsProxy.addAsset(newAssetConfig));
      await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

      expect((await configuratorAsProxy.getConfiguration()).assetConfigs.length).to.be.equal(oldNumAssets + 1);
      expect(await cometAsProxy.numAssets()).to.be.equal(oldNumAssets + 1);
      expect(await (await cometAsProxy.getAssetInfo(oldNumAssets)).asset)
        .to.be.equal(newAssetConfig.asset);
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