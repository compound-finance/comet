import { expect, exp, makeConfigurator, ONE } from './helpers';
import { SimplePriceFeed__factory, FaucetToken__factory, CometExt__factory, CometExtendedAssetList__factory, AssetListFactory__factory } from '../build/types';

import { ethers } from 'hardhat';
describe('asset info', function () {
  it('initializes protocol', async () => {
    const { cometExtendedAssetList: comet, tokens } = await makeConfigurator({
      assets: {
        USDC: {},
        ASSET1: {},
        ASSET2: {},
        ASSET3: {},
      },
      reward: 'ASSET1',
    });

    const cometNumAssets = await comet.numAssets();
    expect(cometNumAssets).to.be.equal(3);

    const assetInfo00 = await comet.getAssetInfo(0);
    expect(assetInfo00.asset).to.be.equal(tokens['ASSET1'].address);
    expect(assetInfo00.borrowCollateralFactor).to.equal(ONE - exp(1, 14));
    expect(assetInfo00.liquidateCollateralFactor).to.equal(ONE);

    const assetInfo01 = await comet.getAssetInfo(1);
    expect(assetInfo01.asset).to.be.equal(tokens['ASSET2'].address);
    expect(assetInfo01.borrowCollateralFactor).to.equal(ONE - exp(1, 14));
    expect(assetInfo01.liquidateCollateralFactor).to.equal(ONE);

    const assetInfo02 = await comet.getAssetInfo(2);
    expect(assetInfo02.asset).to.be.equal(tokens['ASSET3'].address);
    expect(assetInfo02.borrowCollateralFactor).to.equal(ONE - exp(1, 14));
    expect(assetInfo02.liquidateCollateralFactor).to.equal(ONE);
  });

  it('do NOT reverts if too many assets are passed', async () => {
    const signers = await ethers.getSigners();

    const assets = {
      USDC: {},
      ASSET1: {},
      ASSET2: {},
      ASSET3: {},
      ASSET4: {},
      ASSET5: {},
      ASSET6: {},
      ASSET7: {},
      ASSET8: {},
      ASSET9: {},
      ASSET10: {},
      ASSET11: {},
      ASSET12: {},
      ASSET13: {},
      ASSET14: {},
      ASSET15: {},
      ASSET16: {},
      ASSET17: {},
      ASSET18: {},
      ASSET19: {},
      ASSET20: {},
    };
    let priceFeeds = {};
    const PriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
    for (const asset in assets) {
      const initialPrice = exp(assets[asset].initialPrice || 1, 8);
      const priceFeedDecimals = assets[asset].priceFeedDecimals || 8;
      const priceFeed = await PriceFeedFactory.deploy(initialPrice, priceFeedDecimals);
      await priceFeed.deployed();
      priceFeeds[asset] = priceFeed;
    }
  
    const name32 = ethers.utils.formatBytes32String(('Compound Comet'));
    const symbol32 = ethers.utils.formatBytes32String(('📈BASE'));
    const governor = signers[0];
    const pauseGuardian = signers[1];
    const base = 'USDC';
    const supplyKink = exp(0.8, 18);
    const supplyPerYearInterestRateBase = exp(0.0, 18);
    const supplyPerYearInterestRateSlopeLow = exp(0.05, 18);
    const supplyPerYearInterestRateSlopeHigh = exp(2, 18);
    const borrowKink = exp(0.8, 18);
    const borrowPerYearInterestRateBase = exp(0.005, 18);
    const borrowPerYearInterestRateSlopeLow = exp(0.1, 18);
    const borrowPerYearInterestRateSlopeHigh = exp(3, 18);
    const storeFrontPriceFactor = ONE;
    const trackingIndexScale = exp(1, 15);
    const baseTrackingSupplySpeed = trackingIndexScale;
    const baseTrackingBorrowSpeed = trackingIndexScale;
    const baseMinForRewards = exp(1, 18);
    const baseBorrowMin = exp(1, 18);
    const targetReserves = 0;
  
    const FaucetFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
    const tokens = {};
    for (const symbol in assets) {
      const config = assets[symbol];
      const decimals = config.decimals || 18;
      const initial = config.initial || 1e6;
      const name = config.name || symbol;
      const factory = config.factory || FaucetFactory;
      let token = (tokens[symbol] = await factory.deploy(initial, name, decimals, symbol));
      await token.deployed();
    }
    const AssetListFactory = (await ethers.getContractFactory('AssetListFactory')) as AssetListFactory__factory;
    const assetListFactory = await AssetListFactory.deploy();
    await assetListFactory.deployed();

    const CometExtFactory = (await ethers.getContractFactory('CometExt')) as CometExt__factory;
    const extensionDelegate = await CometExtFactory.deploy({ name32, symbol32 }, assetListFactory.address);
    await extensionDelegate.deployed();
    
  
    const config = {
      governor: governor.address,
      pauseGuardian: pauseGuardian.address,
      extensionDelegate: extensionDelegate.address,
      baseToken: tokens[base].address,
      baseTokenPriceFeed: priceFeeds[base].address,
      supplyKink,
      supplyPerYearInterestRateBase,
      supplyPerYearInterestRateSlopeLow,
      supplyPerYearInterestRateSlopeHigh,
      borrowKink,
      borrowPerYearInterestRateBase,
      borrowPerYearInterestRateSlopeLow,
      borrowPerYearInterestRateSlopeHigh,
      storeFrontPriceFactor,
      trackingIndexScale,
      baseTrackingSupplySpeed,
      baseTrackingBorrowSpeed,
      baseMinForRewards,
      baseBorrowMin,
      targetReserves,
      assetConfigs: Object.entries(assets).reduce((acc, [symbol], _i) => {
        if (symbol != base) {
          acc.push({
            asset: tokens[symbol].address,
            priceFeed: priceFeeds[symbol].address,
            decimals: 18,
            borrowCollateralFactor: ONE - 1n,
            liquidateCollateralFactor: ONE,
            liquidationFactor: ONE,
            supplyCap: exp(100, 18),
          });
        }
        return acc;
      }, []),
    };  
    const CometExtendedAssetList = (await ethers.getContractFactory('CometExtendedAssetList')) as CometExtendedAssetList__factory;
    await expect(CometExtendedAssetList.deploy(config)).to.not.be.reverted;
  });

  it('reverts if index is greater than numAssets', async () => {
    const { cometExtendedAssetList } = await makeConfigurator();
    await expect(cometExtendedAssetList.getAssetInfo(3)).to.be.revertedWith("custom error 'BadAsset()'");
  });

  it('reverts if collateral factors are out of range', async () => {
    await expect(makeConfigurator({
      assets: {
        USDC: {},
        ASSET1: {borrowCF: exp(0.9, 18), liquidateCF: exp(0.9, 18)},
        ASSET2: {},
      },
    })).to.be.revertedWith("custom error 'BorrowCFTooLarge()'");

    // check descaled factors
    await expect(makeConfigurator({
      assets: {
        USDC: {},
        ASSET1: {borrowCF: exp(0.9, 18), liquidateCF: exp(0.9, 18) + 1n},
        ASSET2: {},
      },
    })).to.be.revertedWith("custom error 'BorrowCFTooLarge()'");

    await expect(makeConfigurator({
      assets: {
        USDC: {},
        ASSET1: {borrowCF: exp(0.99, 18), liquidateCF: exp(1.1, 18)},
        ASSET2: {},
      },
    })).to.be.revertedWith("custom error 'LiquidateCFTooLarge()'");
  });
});
