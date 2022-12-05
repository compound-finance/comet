import { ethers, exp, expect } from './helpers';
import {
  SimplePriceFeed__factory,
  ScalingPriceFeed__factory
} from '../build/types';

export async function makeScalingPriceFeed({ price, priceFeedDecimals }) {
  const SimplePriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
  const simplePriceFeed = await SimplePriceFeedFactory.deploy(price, priceFeedDecimals);
  await simplePriceFeed.deployed();

  const scalingPriceFeedFactory = (await ethers.getContractFactory('ScalingPriceFeed')) as ScalingPriceFeed__factory;
  const scalingPriceFeed = await scalingPriceFeedFactory.deploy(simplePriceFeed.address, 8);
  await scalingPriceFeed.deployed();

  return {
    simplePriceFeed,
    scalingPriceFeed
  };
}

const testCases = [
  // Price feeds with same amount of decimals as scaling
  {
    price: exp(100, 8),
    priceFeedDecimals: 8,
    result: exp(100, 8)
  },
  {
    price: exp(123456, 8),
    priceFeedDecimals: 8,
    result: exp(123456, 8)
  },
  {
    price: exp(-1000, 8),
    priceFeedDecimals: 8,
    result: exp(-1000, 8)
  },
  // Price feeds with more decimals than scaling
  {
    price: exp(100, 18),
    priceFeedDecimals: 18,
    result: exp(100, 8)
  },
  {
    price: exp(123456, 18),
    priceFeedDecimals: 18,
    result: exp(123456, 8)
  },
  {
    price: exp(-1000, 18),
    priceFeedDecimals: 18,
    result: exp(-1000, 8)
  },
  // Price feeds with less decimals than scaling
  {
    price: exp(100, 6),
    priceFeedDecimals: 6,
    result: exp(100, 8)
  },
  {
    price: exp(123456, 6),
    priceFeedDecimals: 6,
    result: exp(123456, 8)
  },
  {
    price: exp(-1000, 6),
    priceFeedDecimals: 6,
    result: exp(-1000, 8)
  },
];

describe('scaling price feed', function () {
  it(`description is set properly`, async () => {
    const { simplePriceFeed, scalingPriceFeed } = await makeScalingPriceFeed({ price: exp(10, 18), priceFeedDecimals: 18 });

    expect(await scalingPriceFeed.description()).to.eq(await simplePriceFeed.description());
  });

  describe('latestRoundData', function () {
    for (const { price, priceFeedDecimals, result } of testCases) {
      it(`price (${price}), priceFeedDecimals (${priceFeedDecimals}) -> ${result}`, async () => {
        const { scalingPriceFeed } = await makeScalingPriceFeed({ price, priceFeedDecimals });
        const latestRoundData = await scalingPriceFeed.latestRoundData();
        const res = latestRoundData.answer.toBigInt();

        expect(res).to.eq(result);
      });
    }

    it('passes along roundId, startedAt, updatedAt and answeredInRound values from underlying price feed', async () => {
      const { simplePriceFeed, scalingPriceFeed } = await makeScalingPriceFeed({ price: exp(10, 18), priceFeedDecimals: 18 });

      await simplePriceFeed.setRoundData(
        exp(15, 18), // roundId_,
        1,           // answer_,
        exp(16, 8),  // startedAt_,
        exp(17, 8),  // updatedAt_,
        exp(18, 18)  // answeredInRound_
      );

      const {
        roundId,
        startedAt,
        updatedAt,
        answeredInRound
      } = await scalingPriceFeed.latestRoundData();

      expect(roundId.toBigInt()).to.eq(exp(15, 18));
      expect(startedAt.toBigInt()).to.eq(exp(16, 8));
      expect(updatedAt.toBigInt()).to.eq(exp(17, 8));
      expect(answeredInRound.toBigInt()).to.eq(exp(18, 18));
    });
  });
});
