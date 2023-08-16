import { ethers, exp, expect } from '../helpers';
import {
  SimplePriceFeed__factory,
  MultiplicativePriceFeed__factory
} from '../../build/types';

export async function makeMultiplicativePriceFeed({ priceA, priceB, decimalsA = 8, decimalsB = 8 }) {
  const SimplePriceFeedFactory = (await ethers.getContractFactory(
    'SimplePriceFeed'
  )) as SimplePriceFeed__factory;
  const PriceFeedA = await SimplePriceFeedFactory.deploy(priceA, decimalsA);
  await PriceFeedA.deployed();

  const PriceFeedB = await SimplePriceFeedFactory.deploy(priceB, decimalsB);
  await PriceFeedB.deployed();

  const MultiplicativePriceFeedFactory = (await ethers.getContractFactory(
    'MultiplicativePriceFeed'
  )) as MultiplicativePriceFeed__factory;
  const MultiplicativePriceFeed = await MultiplicativePriceFeedFactory.deploy(
    PriceFeedA.address,
    PriceFeedB.address,
    8,
    'Multiplicative Price Feed'
  );
  await MultiplicativePriceFeed.deployed();

  return {
    PriceFeedA,
    PriceFeedB,
    MultiplicativePriceFeed
  };
}

const testCases = [
  // Existing test cases from WBTC price feed
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
    priceA: exp(1, 8),
    priceB: exp(0, 8),
    result: exp(0, 8)
  },
  {
    priceA: exp(0, 8),
    priceB: exp(0, 8),
    result: exp(0, 8)
  },
  // e.g. cbETH / ETH (18 decimals) and ETH / USD (8 decimals)
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
  },
];

describe('Multiplicative price feed', function() {
  it('reverts if constructed with bad decimals', async () => {
    const SimplePriceFeedFactory = (await ethers.getContractFactory(
      'SimplePriceFeed'
    )) as SimplePriceFeed__factory;
    const PriceFeedA = await SimplePriceFeedFactory.deploy(exp(1, 8), 8);
    await PriceFeedA.deployed();

    const PriceFeedB = await SimplePriceFeedFactory.deploy(exp(30_000), 8);
    await PriceFeedB.deployed();

    const MultiplicativePriceFeed = (await ethers.getContractFactory(
      'MultiplicativePriceFeed'
    )) as MultiplicativePriceFeed__factory;
    await expect(
      MultiplicativePriceFeed.deploy(
        PriceFeedA.address,
        PriceFeedB.address,
        20, // decimals_ is too high
        'Multiplicative Price Feed'
      )
    ).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  describe('latestRoundData', function() {
    for (const { priceA, priceB, decimalsA, decimalsB, result } of testCases) {
      it(`priceA (${priceA}) with ${decimalsA ?? 8} decimals, priceB (${priceB}) with ${decimalsB ?? 8} decimals -> ${result}`, async () => {
        const { MultiplicativePriceFeed } = await makeMultiplicativePriceFeed({ priceA, priceB, decimalsA, decimalsB });
        const latestRoundData = await MultiplicativePriceFeed.latestRoundData();
        const price = latestRoundData[1].toBigInt();

        expect(price).to.eq(result);
      });
    }

    it('passes along roundId, startedAt, updatedAt and answeredInRound values from price feed B', async () => {
      const { PriceFeedB, MultiplicativePriceFeed } = await makeMultiplicativePriceFeed({
        priceA: exp(1, 18),
        priceB: exp(30_000, 18)
      });

      await PriceFeedB.setRoundData(
        exp(15, 18), // roundId_,
        1,           // answer_,
        exp(16, 8),  // startedAt_,
        exp(17, 8),  // updatedAt_,
        exp(18, 18)  // answeredInRound_
      );

      const roundData = await MultiplicativePriceFeed.latestRoundData();

      expect(roundData[0].toBigInt()).to.eq(exp(15, 18));
      expect(roundData[2].toBigInt()).to.eq(exp(16, 8));
      expect(roundData[3].toBigInt()).to.eq(exp(17, 8));
      expect(roundData[4].toBigInt()).to.eq(exp(18, 18));
    });
  });

  it('getters return correct values', async () => {
    const { MultiplicativePriceFeed } = await makeMultiplicativePriceFeed({
      priceA: exp(1, 18),
      priceB: exp(30_000, 18)
    });

    expect(await MultiplicativePriceFeed.version()).to.eq(1);
    expect(await MultiplicativePriceFeed.description()).to.eq('Multiplicative Price Feed');
    expect(await MultiplicativePriceFeed.decimals()).to.eq(8);
  });
});
