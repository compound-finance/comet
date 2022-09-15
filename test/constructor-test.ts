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
      baseBorrowMin: exp(100, 6)
    });
    expect(await comet.baseBorrowMin()).to.eq(exp(100, 6));
  });

  it('verifies asset scales', async function () {
    const [governor, pauseGuardian] = await ethers.getSigners();

    // extension delegate
    const CometExtFactory = (await ethers.getContractFactory('CometExt')) as CometExt__factory;
    const extensionDelegate = await CometExtFactory.deploy({
      name32: ethers.utils.formatBytes32String('Compound Comet'),
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
      const priceFeed = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeed.deployed();
      priceFeeds[asset] = priceFeed;
    }

    const CometFactory = (await ethers.getContractFactory('CometHarness')) as CometHarness__factory;
    await expect(CometFactory.deploy({
      governor: governor.address,
      pauseGuardian: pauseGuardian.address,
      extensionDelegate: extensionDelegate.address,
      baseToken: tokens['USDC'].address,
      baseTokenPriceFeed: priceFeeds['USDC'].address,
      supplyKink: exp(8, 17),
      supplyPerYearInterestRateBase: exp(5, 15),
      supplyPerYearInterestRateSlopeLow: exp(1, 17),
      supplyPerYearInterestRateSlopeHigh: exp(3, 18),
      borrowKink: exp(8, 17),
      borrowPerYearInterestRateBase: exp(5, 15),
      borrowPerYearInterestRateSlopeLow: exp(1, 17),
      borrowPerYearInterestRateSlopeHigh: exp(3, 18),
      storeFrontPriceFactor: exp(1, 18),
      trackingIndexScale: exp(1, 15),
      baseTrackingSupplySpeed: exp(1, 15),
      baseTrackingBorrowSpeed: exp(1, 15),
      baseMinForRewards: exp(1, 6),
      baseBorrowMin: exp(1, 6),
      targetReserves: 0,
      assetConfigs: [{
        asset: tokens['EVIL'].address,
        priceFeed: priceFeeds['EVIL'].address,
        decimals: assets['EVIL'].packedDecimals, // <-- packed decimals differ from deployed token's decimals
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

  it('reverts if initializeStorage is called after initialization', async () => {
    const { comet } = await makeProtocol();
    await expect(
      comet.initializeStorage()
    ).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  it('is not possible to create a perSecondInterestRateSlopeLow above FACTOR_SCALE', async () => {
    const uint64Max = BigInt(2 ** 64) - 1n;

    const { comet } = await makeProtocol({
      supplyInterestRateSlopeLow: uint64Max,
      borrowInterestRateSlopeLow: uint64Max
    });

    // max value of interestRateSlopeLow should result in a value less than FACTOR_SCALE
    expect(await comet.supplyPerSecondInterestRateBase()).to.be.lt(exp(1, 18));
    expect(await comet.borrowPerSecondInterestRateBase()).to.be.lt(exp(1, 18));

    // exceeding the max value of interestRateSlopeLow should overflow
    await expect(
      makeProtocol({
        supplyInterestRateSlopeLow: uint64Max + 1n
      })
    ).to.be.rejectedWith('value out-of-bounds'); // ethers.js error
    await expect(
      makeProtocol({
        borrowInterestRateSlopeLow: uint64Max + 1n
      })
    ).to.be.rejectedWith('value out-of-bounds'); // ethers.js error
  });
});
