import { ethers, exp, expect, makeProtocol, ONE } from './helpers';
import {
  CometExt__factory,
  CometHarness__factory,
  FaucetToken__factory,
  SimplePriceFeed__factory,
} from '../build/types';

describe('constructor', function () {
  it('sets the baseBorrowMin', async function () {
    const { comet } = await makeProtocol({
      baseBorrowMin: exp(100,6)
    });
    expect(await comet.baseBorrowMin()).to.eq(exp(100,6));
  });

  it('verifies asset scales', async function () {
    const [governor, pauseGuardian] = await ethers.getSigners();

    // extension delegate
    const CometExtFactory = (await ethers.getContractFactory('CometExt')) as CometExt__factory;
    const extensionDelegate = await CometExtFactory.deploy({
      symbol32: ethers.utils.formatBytes32String('📈BASE')
    });
    await extensionDelegate.deployed();

    // tokens
    const assets = {
      USDC: { decimals: 6 },
      EVIL: {
        decimals: 18,
        packedDecimals: 19,
      }
    };
    const FaucetFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
    const tokens = {};
    for (const symbol in assets) {
      const config = assets[symbol];
      const decimals = config.decimals;
      const token = (tokens[symbol] = await FaucetFactory.deploy(1e6, symbol, decimals, symbol));
      await token.deployed();
    }

    // price feeds
    let priceFeeds = {};
    const PriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
    for (const asset in assets) {
      const priceFeed = await PriceFeedFactory.deploy(exp(1,8), 8);
      await priceFeed.deployed();
      priceFeeds[asset] = priceFeed;
    }

    const CometFactory = (await ethers.getContractFactory('CometHarness')) as CometHarness__factory;
    await expect(CometFactory.deploy({
      governor: governor.address,
      pauseGuardian: pauseGuardian.address,
      extensionDelegate: extensionDelegate.address,
      baseToken: tokens["USDC"].address,
      baseTokenPriceFeed: priceFeeds["USDC"].address,
      kink: exp(8, 17),
      perYearInterestRateBase: exp(5, 15),
      perYearInterestRateSlopeLow: exp(1, 17),
      perYearInterestRateSlopeHigh: exp(3, 18),
      reserveRate: exp(1, 17),
      storeFrontPriceFactor: exp(1, 18),
      trackingIndexScale: exp(1, 15),
      baseTrackingSupplySpeed: exp(1, 15),
      baseTrackingBorrowSpeed: exp(1, 15),
      baseMinForRewards: exp(1,6),
      baseBorrowMin: exp(1, 6),
      targetReserves: 0,
      assetConfigs: [{
        asset: tokens["EVIL"].address,
        priceFeed: priceFeeds["EVIL"].address,
        decimals: assets["EVIL"].packedDecimals, // <-- packed decimals differ from deployed token's decimals
        borrowCollateralFactor: ONE - 1n,
        liquidateCollateralFactor: ONE,
        liquidationFactor: ONE,
        supplyCap: exp(100, 18),
      }],
    })).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  it('reverts if baseTokenPriceFeed does not have 8 decimals', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {
            priceFeedDecimals: 18,
          },
        },
      })
    ).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  it('reverts if asset has a price feed that does not have 8 decimals', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {},
          COMP: {
            initial: 1e7,
            decimals: 18,
            initialPrice: 1.2345,
            priceFeedDecimals: 18,
          },
        },
      })
    ).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  it('reverts if base token has fewer than 6 decimals', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {
            decimals: 5,
          },
        },
      })
    ).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  it('reverts if base token has more than 18 decimals', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {
            decimals: 19,
          },
        },
      })
    ).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  it('reverts if liquidation factor is greater than storefront price factor', async () => {
    await expect(
      makeProtocol({
        storeFrontPriceFactor: exp(0.9, 18),
        assets: {
          USDC: {},
          COMP: {
            initial: 1e7,
            decimals: 18,
            initialPrice: 1,
            liquidationFactor: exp(0.95, 18),
          },
        },
      })
    ).to.be.revertedWith("custom error 'BadLiquidationFactor()'");
  });

  it('reverts if initializeStorage is called after initialization', async () => {
    const { comet } = await makeProtocol();
    await expect(
      comet.initializeStorage()
    ).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  it('reverts if reserveRate is greater than FACTOR_SCALE (1e18)', async () => {
    await expect(
      makeProtocol({
        reserveRate: exp(2,18)
      })
    ).to.be.revertedWith("custom error 'ReserveRateTooLarge()'");
  });
});
