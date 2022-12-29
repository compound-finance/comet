import { ethers, exp, expect, getBlock } from './helpers';
import {
  ConstantPriceFeed__factory
} from '../build/types';

export async function makeConstantPriceFeed({ decimals, constantPrice }) {
  const constantPriceFeedFactory = (await ethers.getContractFactory('ConstantPriceFeed')) as ConstantPriceFeed__factory;
  const constantPriceFeed = await constantPriceFeedFactory.deploy(decimals, constantPrice);
  await constantPriceFeed.deployed();

  return constantPriceFeed;
}

describe('constant price feed', function () {
  describe('latestRoundData', function () {
    it('returns constant price for 8 decimals', async () => {
      const constantPriceFeed = await makeConstantPriceFeed({ decimals: 8, constantPrice: exp(1, 8) });
      const latestRoundData = await constantPriceFeed.latestRoundData();
      const price = latestRoundData.answer.toBigInt();

      expect(price).to.eq(exp(1, 8));
    });

    it('returns constant price for 18 decimals', async () => {
      const constantPriceFeed = await makeConstantPriceFeed({ decimals: 18, constantPrice: exp(1, 18) });
      const latestRoundData = await constantPriceFeed.latestRoundData();
      const price = latestRoundData.answer.toBigInt();

      expect(price).to.eq(exp(1, 18));
    });

    it('returns expected roundId, startedAt, updatedAt and answeredInRound values', async () => {
      const constantPriceFeed = await makeConstantPriceFeed({ decimals: 18, constantPrice: exp(1, 18) });

      const {
        roundId,
        startedAt,
        updatedAt,
        answeredInRound
      } = await constantPriceFeed.latestRoundData();
      const currentTimestamp = (await getBlock()).timestamp;

      expect(roundId).to.eq(1);
      expect(startedAt).to.eq(currentTimestamp);
      expect(updatedAt).to.eq(currentTimestamp);
      expect(answeredInRound).to.eq(1);
    });
  });
});
