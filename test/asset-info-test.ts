import { expect, exp, makeProtocol, ONE } from './helpers';
import { ethers } from 'hardhat';
import {
  SimplePriceFeed__factory,
  FaucetToken__factory,
  CometHarness__factory
} from '../build/types';

describe('asset info', function () {
  it('initializes protocol', async () => {
    const { comet, tokens } = await makeProtocol({
      assets: {
        USDC: {},
        ASSET1: {},
        ASSET2: {},
        ASSET3: {},
      },
      reward: 'ASSET1',
    });

    const cometNumAssets = await comet.numAssets();
    const cometMaxAssets = await comet.maxAssets();
    expect(cometMaxAssets).to.be.equal(15);
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

  it('reverts if too many assets are passed', async () => {
    let priceFeeds = {};
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
    };
    const base = 'USDC';
    const PriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
    for (const asset in assets) {
      const initialPrice = exp(assets[asset].initialPrice || 1, 8);
      const priceFeedDecimals = assets[asset].priceFeedDecimals || 8;
      const priceFeed = await PriceFeedFactory.deploy(initialPrice, priceFeedDecimals);
      await priceFeed.deployed();
      priceFeeds[asset] = priceFeed;
    }
    const FaucetFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
    const tokens = {};
    for (const symbol in assets) {
      const config = assets[symbol];
      const decimals = config.decimals || 18;
      const initial = config.initial || 1e6;
      const name = config.name || symbol;
      const factory = config.factory || FaucetFactory;
      let token;
      token = (tokens[symbol] = await factory.deploy(initial, name, decimals, symbol));
      await token.deployed();
    }
    const config = {
      governor: ethers.constants.AddressZero,
      pauseGuardian: ethers.constants.AddressZero,
      extensionDelegate: ethers.constants.AddressZero,
      baseToken: tokens[base].address,
      baseTokenPriceFeed: priceFeeds[base].address,
      supplyKink: 0,
      supplyPerYearInterestRateBase: 0,
      supplyPerYearInterestRateSlopeLow: 0,
      supplyPerYearInterestRateSlopeHigh: 0,
      borrowKink: 0,
      borrowPerYearInterestRateBase: 0,
      borrowPerYearInterestRateSlopeLow: 0,
      borrowPerYearInterestRateSlopeHigh: 0,
      storeFrontPriceFactor: 8,
      trackingIndexScale: 0,
      baseTrackingSupplySpeed: 0,
      baseTrackingBorrowSpeed: 0,
      baseMinForRewards: 0,
      baseBorrowMin: 0,
      targetReserves: 0,
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
    const CometFactory = (await ethers.getContractFactory('CometHarness')) as CometHarness__factory;
    await expect(
      CometFactory.deploy(config)
    ).to.be.revertedWith("custom error 'TooManyAssets()'");
  });

  it('reverts if index is greater than numAssets', async () => {
    const { comet } = await makeProtocol();
    await expect(comet.getAssetInfo(3)).to.be.revertedWith("custom error 'BadAsset()'");
  });

  it('reverts if collateral factors are out of range', async () => {
    await expect(makeProtocol({
      assets: {
        USDC: {},
        ASSET1: {borrowCF: exp(0.9, 18), liquidateCF: exp(0.9, 18)},
        ASSET2: {},
      },
    })).to.be.revertedWith("custom error 'BorrowCFTooLarge()'");

    // check descaled factors
    await expect(makeProtocol({
      assets: {
        USDC: {},
        ASSET1: {borrowCF: exp(0.9, 18), liquidateCF: exp(0.9, 18) + 1n},
        ASSET2: {},
      },
    })).to.be.revertedWith("custom error 'BorrowCFTooLarge()'");

    await expect(makeProtocol({
      assets: {
        USDC: {},
        ASSET1: {borrowCF: exp(0.99, 18), liquidateCF: exp(1.1, 18)},
        ASSET2: {},
      },
    })).to.be.revertedWith("custom error 'LiquidateCFTooLarge()'");
  });
});
