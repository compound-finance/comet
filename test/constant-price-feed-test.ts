import { ethers, exp, expect, getBlock } from './helpers';
import {
  ConstantPriceFeed__factory
} from '../build/types';

export async function makeConstantPriceFeed({ decimals }) {
  const constantPriceFeedFactory = (await ethers.getContractFactory('ConstantPriceFeed')) as ConstantPriceFeed__factory;
  const constantPriceFeed = await constantPriceFeedFactory.deploy(decimals);
  await constantPriceFeed.deployed();

  return constantPriceFeed;
}

describe('constant price feed', function () {
  describe('latestRoundData', function () {
    it('returns constant price for 8 decimals', async () => {
      const constantPriceFeed = await makeConstantPriceFeed({ decimals: 8 });
      const latestRoundData = await constantPriceFeed.latestRoundData();
      const price = latestRoundData.answer.toBigInt();

      expect(price).to.eq(exp(1, 8));
    });

    it('returns constant price for 18 decimals', async () => {
      const constantPriceFeed = await makeConstantPriceFeed({ decimals: 18 });
      const latestRoundData = await constantPriceFeed.latestRoundData();
      const price = latestRoundData.answer.toBigInt();

      expect(price).to.eq(exp(1, 18));
    });

    it('returns expected roundId, startedAt, updatedAt and answeredInRound values', async () => {
      const constantPriceFeed = await makeConstantPriceFeed({ decimals: 18 });

      const {
        roundId,
        startedAt,
        updatedAt,
        answeredInRound
      } = await constantPriceFeed.latestRoundData();
      const currentTimestamp = (await getBlock()).timestamp;

      expect(roundId).to.eq(0);
      expect(startedAt).to.eq(currentTimestamp);
      expect(updatedAt).to.eq(currentTimestamp);
      expect(answeredInRound).to.eq(0);
    });
  });

  it(`getRoundData > always reverts`, async () => {
    const constantPriceFeed = await makeConstantPriceFeed({ decimals: 8 });

    await expect(
      constantPriceFeed.getRoundData(1)
    ).to.be.revertedWith("custom error 'NotImplemented()'");
  });
});
