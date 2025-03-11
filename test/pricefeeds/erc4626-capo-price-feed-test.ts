import { ethers, exp, expect } from '../helpers';
import {
  SimplePriceFeed__factory,
  ERC4626CorrelatedAssetsPriceOracle__factory,
  SimpleERC4626RatePriceFeed__factory,
} from '../../build/types';

export async function makeCAPOPriceFeed({ priceA, priceB, decimalsA = 8, decimalsB = 8 }) {
  const [signer] = await ethers.getSigners();
  const SimplePriceFeedFactory = (await ethers.getContractFactory(
    'SimplePriceFeed'
  )) as SimplePriceFeed__factory;

  const SimpleERC4626RatePriceFeed = (await ethers.getContractFactory(
    'SimpleERC4626RatePriceFeed'
  )) as SimpleERC4626RatePriceFeed__factory;

  const PriceFeedA = await SimplePriceFeedFactory.deploy(priceA, decimalsA);
  await PriceFeedA.deployed();

  const PriceFeedB = await SimpleERC4626RatePriceFeed.deploy(priceB, decimalsB);
  await PriceFeedB.deployed();

  const ERC4626CorrelatedAssetsPriceOracleFactory = (await ethers.getContractFactory(
    'ERC4626CorrelatedAssetsPriceOracle'
  )) as ERC4626CorrelatedAssetsPriceOracle__factory;

  const currentTimestamp = await ethers.provider.getBlock('latest').then(b => b.timestamp);

  const CapoPriceFeed = await ERC4626CorrelatedAssetsPriceOracleFactory.deploy(
    signer.address,
    PriceFeedA.address,
    PriceFeedB.address,
    'CAPO Price Feed',
    decimalsB,
    8,
    3600,
    {
      snapshotRatio: priceB,
      snapshotTimestamp: currentTimestamp - 3600,
      maxYearlyRatioGrowthPercent: exp(0.01, 4)
    }
  );

  await CapoPriceFeed.deployed();

  return {
    PriceFeedA,
    PriceFeedB,
    CapoPriceFeed
  };
}

const testCases = [
  {
    priceA: exp(1, 8),
    priceB: exp(30_000, 8),
    result: exp(30_000, 8)
  },
  {
    priceA: exp(2.123456, 8),
    priceB: exp(31_333.123, 8),
    result: 6653450803308n
  },
  {
    priceA: exp(100, 8),
    priceB: exp(30_000, 8),
    result: exp(3_000_000, 8)
  },
  {
    priceA: exp(0.9999, 8),
    priceB: exp(30_000, 8),
    result: exp(29_997, 8)
  },
  {
    priceA: exp(0.987937, 8),
    priceB: exp(31_947.71623, 8),
    result: 3156233092911n
  },
  {
    priceA: exp(0.5, 8),
    priceB: exp(30_000, 8),
    result: exp(15_000, 8)
  },
  {
    priceA: exp(0.00555, 8),
    priceB: exp(30_000, 8),
    result: exp(166.5, 8)
  },
  {
    priceA: exp(0, 8),
    priceB: exp(30_000, 8),
    result: exp(0, 8)
  },
  {
    priceA: exp(1, 18),
    priceB: exp(1800, 8),
    decimalsA: 18,
    decimalsB: 8,
    result: exp(1800, 8)
  },
  {
    priceA: exp(1.25, 18),
    priceB: exp(1800, 8),
    decimalsA: 18,
    decimalsB: 8,
    result: exp(2250, 8)
  },
  {
    priceA: exp(0.72, 18),
    priceB: exp(1800, 8),
    decimalsA: 18,
    decimalsB: 8,
    result: exp(1296, 8)
  }
];

describe('CAPO price feed', function() {
  it('reverts if constructed with bad manager address', async () => {
    const SimplePriceFeedFactory = (await ethers.getContractFactory(
      'SimplePriceFeed'
    )) as SimplePriceFeed__factory;

    const SimpleERC4626RatePriceFeed = (await ethers.getContractFactory(
      'SimpleERC4626RatePriceFeed'
    )) as SimpleERC4626RatePriceFeed__factory;

    const PriceFeedA = await SimplePriceFeedFactory.deploy(exp(1, 8), 8);
    await PriceFeedA.deployed();

    const PriceFeedB = await SimpleERC4626RatePriceFeed.deploy(exp(30_000), 8);
    await PriceFeedB.deployed();

    const ERC4626CorrelatedAssetsPriceOracle = (await ethers.getContractFactory(
      'ERC4626CorrelatedAssetsPriceOracle'
    )) as ERC4626CorrelatedAssetsPriceOracle__factory;

    await expect(
      ERC4626CorrelatedAssetsPriceOracle.deploy(
        ethers.constants.AddressZero,
        PriceFeedA.address,
        PriceFeedB.address,
        'CAPO Price Feed',
        18,
        8,
        0,
        {
          snapshotRatio: 0,
          snapshotTimestamp: 1,
          maxYearlyRatioGrowthPercent: 0
        }
      )).to.be.revertedWith("custom error 'ManagerIsZeroAddress()'");
  });

  it('reverts if constructed with bad price feed', async () => {
    const SimplePriceFeedFactory = (await ethers.getContractFactory(
      'SimplePriceFeed'
    )) as SimplePriceFeed__factory;

    const SimpleERC4626RatePriceFeed = (await ethers.getContractFactory(
      'SimpleERC4626RatePriceFeed'
    )) as SimpleERC4626RatePriceFeed__factory;

    const PriceFeedA = await SimplePriceFeedFactory.deploy(exp(1, 8), 8);
    await PriceFeedA.deployed();

    const PriceFeedB = await SimpleERC4626RatePriceFeed.deploy(exp(30_000), 8);
    await PriceFeedB.deployed();

    const ERC4626CorrelatedAssetsPriceOracle = (await ethers.getContractFactory(
      'ERC4626CorrelatedAssetsPriceOracle'
    )) as ERC4626CorrelatedAssetsPriceOracle__factory;

    await expect(
      ERC4626CorrelatedAssetsPriceOracle.deploy(
        PriceFeedB.address,
        ethers.constants.AddressZero,
        PriceFeedB.address,
        'CAPO Price Feed',
        18,
        8,
        0,
        {
          snapshotRatio: 0,
          snapshotTimestamp: 1,
          maxYearlyRatioGrowthPercent: 0
        }
      )).to.be.revertedWith("custom error 'InvalidAddress()'");
    await expect(
      ERC4626CorrelatedAssetsPriceOracle.deploy(
        PriceFeedB.address,
        PriceFeedB.address,
        ethers.constants.AddressZero,
        'CAPO Price Feed',
        18,
        8,
        0,
        {
          snapshotRatio: 0,
          snapshotTimestamp: 1,
          maxYearlyRatioGrowthPercent: 0
        }
      )).to.be.revertedWith("custom error 'InvalidAddress()'");
  });

  it('reverts if set cap parameters not by manager', async () => {
    const { CapoPriceFeed } = await makeCAPOPriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });

    const [,signer] = await ethers.getSigners();

    await expect(CapoPriceFeed.connect(signer).updateSnapshot({
      snapshotRatio: 0,
      snapshotTimestamp: 0,
      maxYearlyRatioGrowthPercent: 0
    })).to.be.revertedWithCustomError(CapoPriceFeed, 'OnlyManager');
  });

  describe('latestRoundData', function() {
    for (const { priceA, priceB, decimalsA, decimalsB, result } of testCases) {
      it(`priceA (${priceA}) with ${decimalsA ?? 8} decimals, priceB (${priceB}) with ${decimalsB ?? 8} decimals -> ${result}`, async () => {
        const { CapoPriceFeed } = await makeCAPOPriceFeed({ priceA, priceB, decimalsA, decimalsB });
        const latestRoundData = await CapoPriceFeed.latestRoundData();
        const price = latestRoundData[1].toBigInt();

        expect(price).to.eq(result);
      });
    }

    it('if current rate > last snapshot * max yearly growth rate, then price is capped and rate == max rate', async () => {
      const { CapoPriceFeed, PriceFeedB } = await makeCAPOPriceFeed({
        priceA: exp(1, 18),
        decimalsA: 18,
        priceB: exp(30_000, 18),
        decimalsB: 18
      });

      await PriceFeedB.setRoundData(
        exp(1, 18),      // roundId_,
        exp(35_000, 18), // answer_,
        exp(2, 8),       // startedAt_,
        exp(3, 8),       // updatedAt_,
        exp(4, 18)       // answeredInRound_
      );

      const latestRoundData = await CapoPriceFeed.latestRoundData();
      //300000342656012.176546580000000000
      const price = latestRoundData[1].toBigInt();

      expect(await CapoPriceFeed.isCapped()).to.be.true;
      const maxRatePerSecond = exp(30_000, 18) * exp(0.01, 4) / 31536000n / exp(1, 4);

      expect(price).to.eq((exp(30_000, 18) + maxRatePerSecond * 3602n) / exp(1, 10));
    });

    it('passes along roundId, startedAt, updatedAt and answeredInRound values from price feed A', async () => {
      const { PriceFeedA, CapoPriceFeed } = await makeCAPOPriceFeed({
        priceA: exp(1, 18),
        decimalsA: 18,
        priceB: exp(30_000, 18),
        decimalsB: 18
      });

      await PriceFeedA.setRoundData(
        exp(15, 18), // roundId_,
        1,           // answer_,
        exp(16, 8),  // startedAt_,
        exp(17, 8),  // updatedAt_,
        exp(18, 18)  // answeredInRound_
      );

      const roundData = await CapoPriceFeed.latestRoundData();

      expect(roundData[0].toBigInt()).to.eq(exp(15, 18));
      expect(roundData[2].toBigInt()).to.eq(exp(16, 8));
      expect(roundData[3].toBigInt()).to.eq(exp(17, 8));
      expect(roundData[4].toBigInt()).to.eq(exp(18, 18));
    });
  });

  it('reverts if snapshot timestamp is invalid', async () => {
    const { CapoPriceFeed } = await makeCAPOPriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });

    await expect(CapoPriceFeed.updateSnapshot({
      snapshotRatio: 1,
      snapshotTimestamp: 0,
      maxYearlyRatioGrowthPercent: 0
    })).to.be.revertedWithCustomError(CapoPriceFeed, 'InvalidRatioTimestamp').withArgs(0);
  });

  it('reverts if snapshot is updated too soon', async () => {
    const { CapoPriceFeed } = await makeCAPOPriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });

    const currentTimestamp = await ethers.provider.getBlock('latest').then(b => b.timestamp);
    await expect(CapoPriceFeed.updateSnapshot({
      snapshotRatio: 1,
      snapshotTimestamp: currentTimestamp,
      maxYearlyRatioGrowthPercent: 0
    })).to.be.revertedWithCustomError(CapoPriceFeed, 'InvalidRatioTimestamp').withArgs(currentTimestamp);
  });

  it('reverts if new snapshot ratio is 0', async () => {
    const { CapoPriceFeed } = await makeCAPOPriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });

    const currentTimestamp = await ethers.provider.getBlock('latest').then(b => b.timestamp);

    // advance time
    await ethers.provider.send('evm_increaseTime', [3600]);

    await expect(CapoPriceFeed.updateSnapshot({
      snapshotRatio: 0,
      snapshotTimestamp: currentTimestamp,
      maxYearlyRatioGrowthPercent: 0
    })).to.be.revertedWithCustomError(CapoPriceFeed, 'SnapshotRatioIsZero');
  });

  it('reverts if new snapshot ratio will overflow in 3 years', async () => {
    const { CapoPriceFeed } = await makeCAPOPriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });

    const currentTimestamp = await ethers.provider.getBlock('latest').then(b => b.timestamp);

    // advance time
    await ethers.provider.send('evm_increaseTime', [3600]);

    await expect(CapoPriceFeed.updateSnapshot({
      snapshotRatio: exp(30_000, 26),
      snapshotTimestamp: currentTimestamp,
      maxYearlyRatioGrowthPercent: exp(10000, 2)
    })).to.be.revertedWithCustomError(CapoPriceFeed, 'SnapshotCloseToOverflow');
  });

  it('reverts if non-manager tries to set new manager', async () => {
    const { CapoPriceFeed } = await makeCAPOPriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });
    const [, newManager] = await ethers.getSigners();

    await expect(CapoPriceFeed.connect(newManager).setManager(newManager.address)).to.be.revertedWithCustomError(CapoPriceFeed, 'OnlyManager');
  });

  it('getters return correct values', async () => {
    const { CapoPriceFeed } = await makeCAPOPriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });
    const [signer] = await ethers.getSigners();

    expect(await CapoPriceFeed.description()).to.eq('CAPO Price Feed');
    expect(await CapoPriceFeed.version()).to.eq(1);
    expect(await CapoPriceFeed.decimals()).to.eq(8);
    expect(await CapoPriceFeed.manager()).to.eq(signer.address);
    expect(await CapoPriceFeed.snapshotRatio()).to.eq(exp(30_000, 18));
    expect(await CapoPriceFeed.maxYearlyRatioGrowthPercent()).to.eq(exp(0.01, 4));
    expect(await CapoPriceFeed.maxRatioGrowthPerSecond()).to.eq(exp(30_000, 18) * exp(0.01, 4) / 31536000n / exp(1, 4));
    expect(await CapoPriceFeed.getRatio()).to.eq(exp(30_000, 18));
    expect(await CapoPriceFeed.isCapped()).to.be.false;
  });

  it('set cap parameters', async () => {
    const { CapoPriceFeed } = await makeCAPOPriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });

    const currentTimestamp = await ethers.provider.getBlock('latest').then(b => b.timestamp);

    // advance time
    await ethers.provider.send('evm_increaseTime', [3600]);

    await CapoPriceFeed.updateSnapshot({
      snapshotRatio: exp(30_100, 18),
      snapshotTimestamp: currentTimestamp,
      maxYearlyRatioGrowthPercent: 100
    });

    expect(await CapoPriceFeed.getRatio()).to.eq(exp(30_000, 18));
    expect(await CapoPriceFeed.snapshotRatio()).to.eq(exp(30_100, 18));
    expect(await CapoPriceFeed.snapshotTimestamp()).to.eq(currentTimestamp);
    expect(await CapoPriceFeed.maxYearlyRatioGrowthPercent()).to.eq(exp(0.01, 4));
    expect(await CapoPriceFeed.maxRatioGrowthPerSecond()).to.eq(exp(30_100, 18) * exp(0.01, 4) / 31536000n / exp(1, 4));
  });

  it('set new manager', async () => {
    const { CapoPriceFeed } = await makeCAPOPriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });
    const [signer, newManager] = await ethers.getSigners();

    await CapoPriceFeed.connect(signer).setManager(newManager.address);

    expect(await CapoPriceFeed.manager()).to.eq(newManager.address);
  });
});
