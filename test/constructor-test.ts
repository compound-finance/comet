import { ethers, exp, expect, makeProtocol, ONE } from './helpers';
import {
  AssetListFactory__factory,
  CometExt__factory,
  CometExtAssetList__factory,
  CometHarness__factory,
  CometHarnessExtendedAssetList__factory,
  FaucetToken__factory,
  SimplePriceFeed__factory,
} from '../build/types';
import type { CometHarnessInterfaceExtendedAssetList as CometWithExtendedAssetList } from '../build/types';
import { BigNumber } from 'ethers';

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
      targetHealthFactor: 0,
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

  context('target health factor', function () {
    let CometFactory: CometHarnessExtendedAssetList__factory;
    let baseConfig: any;
    let referenceComet: CometWithExtendedAssetList;
    let minHealthFactor: BigNumber;

    before(async function () {
      const [governor, pauseGuardian] = await ethers.getSigners();

      const FaucetFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
      const baseToken = await FaucetFactory.deploy(exp(1, 6), 'USDC', 6, 'USDC');
      await baseToken.deployed();

      const PriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
      const priceFeed = await PriceFeedFactory.deploy(exp(1, 8), 8);
      await priceFeed.deployed();

      const AssetListFactoryFactory = (await ethers.getContractFactory('AssetListFactory')) as AssetListFactory__factory;
      const assetListFactory = await AssetListFactoryFactory.deploy();
      await assetListFactory.deployed();

      const CometExtFactory = (await ethers.getContractFactory('CometExtAssetList')) as CometExtAssetList__factory;
      const extensionDelegate = await CometExtFactory.deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('📈BASE'),
        },
        assetListFactory.address
      );
      await extensionDelegate.deployed();

      CometFactory = (await ethers.getContractFactory('CometHarnessExtendedAssetList')) as CometHarnessExtendedAssetList__factory;

      baseConfig = {
        governor: governor.address,
        pauseGuardian: pauseGuardian.address,
        extensionDelegate: extensionDelegate.address,
        baseToken: baseToken.address,
        baseTokenPriceFeed: priceFeed.address,
        supplyKink: exp(0.8, 18),
        supplyPerYearInterestRateBase: exp(0, 18),
        supplyPerYearInterestRateSlopeLow: exp(0.05, 18),
        supplyPerYearInterestRateSlopeHigh: exp(2, 18),
        borrowKink: exp(0.8, 18),
        borrowPerYearInterestRateBase: exp(0.005, 18),
        borrowPerYearInterestRateSlopeLow: exp(0.1, 18),
        borrowPerYearInterestRateSlopeHigh: exp(3, 18),
        storeFrontPriceFactor: exp(1, 18),
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(1, 15),
        baseTrackingBorrowSpeed: exp(1, 15),
        baseMinForRewards: exp(1, 6),
        baseBorrowMin: exp(1, 6),
        targetReserves: 0,
        targetHealthFactor: exp(1.05, 18),
        assetConfigs: [],
      };

      referenceComet = (await CometFactory.deploy(baseConfig)) as unknown as CometWithExtendedAssetList;
      await referenceComet.deployed();
      minHealthFactor = await referenceComet.MIN_TARGET_HEALTH_FACTOR();
    });

    describe('with the default target health factor', function () {
      let deployedTargetHealthFactor: BigNumber;

      it('deploy the comet', async function () {
        const comet = (await CometFactory.deploy(baseConfig)) as unknown as CometWithExtendedAssetList;
        deployedTargetHealthFactor = await comet.targetHealthFactor();
      });

      it('stores the configured target health factor', function () {
        expect(deployedTargetHealthFactor).to.be.equal(baseConfig.targetHealthFactor);
      });

      it('default value equals the minimum allowed health factor from the contract', function () {
        expect(deployedTargetHealthFactor).to.be.equal(minHealthFactor);
      });
    });

    describe('with the minimum allowed target health factor', function () {
      let deployedTargetHealthFactor: BigNumber;

      it('deploy the comet', async function () {
        const comet = (await CometFactory.deploy({ ...baseConfig, targetHealthFactor: minHealthFactor })) as unknown as CometWithExtendedAssetList;
        deployedTargetHealthFactor = await comet.targetHealthFactor();
      });

      it('stores the minimum target health factor', function () {
        expect(deployedTargetHealthFactor).to.be.equal(minHealthFactor);
      });
    });

    describe('with a target health factor above the minimum', function () {
      const targetHealthFactor = exp(1.20, 18);
      let deployedTargetHealthFactor: BigNumber;

      before(async function () {
        const comet = (await CometFactory.deploy({ ...baseConfig, targetHealthFactor })) as unknown as CometWithExtendedAssetList;
        await comet.deployed();
        deployedTargetHealthFactor = await comet.targetHealthFactor();
      });

      it('stores the configured target health factor', function () {
        expect(deployedTargetHealthFactor).to.be.equal(targetHealthFactor);
      });
    });

    describe('revert when', function () {
      it('target health factor is one below the minimum', async function () {
        await expect(
          CometFactory.deploy({ ...baseConfig, targetHealthFactor: minHealthFactor.sub(1) })
        ).to.be.revertedWithCustomError(referenceComet, 'BadHealthFactor');
      });

      it('target health factor is zero', async function () {
        await expect(
          CometFactory.deploy({ ...baseConfig, targetHealthFactor: 0 })
        ).to.be.revertedWithCustomError(referenceComet, 'BadHealthFactor');
      });
    });
  });
});
