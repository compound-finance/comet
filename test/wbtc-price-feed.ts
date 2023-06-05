import { ethers, exp, expect } from './helpers';
import {
  SimplePriceFeed__factory,
  WBTCPriceFeed__factory
} from '../build/types';

export async function makeWBTCPriceFeed({ WBTCToBTCPrice, BTCToUSDPrice }) {
  const SimplePriceFeedFactory = (await ethers.getContractFactory(
    'SimplePriceFeed'
  )) as SimplePriceFeed__factory;
  const WBTCToBTCPriceFeed = await SimplePriceFeedFactory.deploy(WBTCToBTCPrice, 8);
  await WBTCToBTCPriceFeed.deployed();

  const BTCToUSDPriceFeed = await SimplePriceFeedFactory.deploy(BTCToUSDPrice, 8);
  await BTCToUSDPriceFeed.deployed();

  const WBTCPriceFeedFactory = (await ethers.getContractFactory(
    'WBTCPriceFeed'
  )) as WBTCPriceFeed__factory;
  const WBTCPriceFeed = await WBTCPriceFeedFactory.deploy(
    WBTCToBTCPriceFeed.address,
    BTCToUSDPriceFeed.address,
    8
  );
  await WBTCPriceFeed.deployed();

  return {
    WBTCToBTCPriceFeed,
    BTCToUSDPriceFeed,
    WBTCPriceFeed
  };
}

const testCases = [
  {
    WBTCToBTCPrice: exp(1, 8),
    BTCToUSDPrice: exp(30_000, 8),
    result: exp(30_000, 8)
  },
  {
    WBTCToBTCPrice: exp(2.123456, 8),
    BTCToUSDPrice: exp(31_333.123, 8),
    result: 6653450803308n
  },
  {
    WBTCToBTCPrice: exp(100, 8),
    BTCToUSDPrice: exp(30_000, 8),
    result: exp(3_000_000, 8)
  },
  {
    WBTCToBTCPrice: exp(0.9999, 8),
    BTCToUSDPrice: exp(30_000, 8),
    result: exp(29_997, 8)
  },
  {
    WBTCToBTCPrice: exp(0.987937, 8),
    BTCToUSDPrice: exp(31_947.71623, 8),
    result: 3156233092911n
  },
  {
    WBTCToBTCPrice: exp(0.5, 8),
    BTCToUSDPrice: exp(30_000, 8),
    result: exp(15_000, 8)
  },
  {
    WBTCToBTCPrice: exp(0.00555, 8),
    BTCToUSDPrice: exp(30_000, 8),
    result: exp(166.5, 8)
  },
  {
    WBTCToBTCPrice: exp(0, 8),
    BTCToUSDPrice: exp(30_000, 8),
    result: exp(0, 8)
  },
  {
    WBTCToBTCPrice: exp(1, 8),
    BTCToUSDPrice: exp(0, 8),
    result: exp(0, 8)
  },
  {
    WBTCToBTCPrice: exp(0, 8),
    BTCToUSDPrice: exp(0, 8),
    result: exp(0, 8)
  }
];

describe('WBTC price feed', function() {
  it('reverts if constructed with bad decimals', async () => {
    const SimplePriceFeedFactory = (await ethers.getContractFactory(
      'SimplePriceFeed'
    )) as SimplePriceFeed__factory;
    const WBTCToBTCPriceFeed = await SimplePriceFeedFactory.deploy(exp(1, 8), 8);
    await WBTCToBTCPriceFeed.deployed();

    const BTCToUSDPriceFeed = await SimplePriceFeedFactory.deploy(exp(30_000), 8);
    await BTCToUSDPriceFeed.deployed();

    const WBTCPriceFeedFactory = (await ethers.getContractFactory(
      'WBTCPriceFeed'
    )) as WBTCPriceFeed__factory;
    await expect(
      WBTCPriceFeedFactory.deploy(
        WBTCToBTCPriceFeed.address,
        BTCToUSDPriceFeed.address,
        20 // decimals_ is too high
      )
    ).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  describe('latestRoundData', function() {
    for (const { WBTCToBTCPrice, BTCToUSDPrice, result } of testCases) {
      it(`WBTCToBTCPrice (${WBTCToBTCPrice}), BTCToUSDPrice (${BTCToUSDPrice}) -> ${result}`, async () => {
        const { WBTCPriceFeed } = await makeWBTCPriceFeed({ WBTCToBTCPrice, BTCToUSDPrice });
        const latestRoundData = await WBTCPriceFeed.latestRoundData();
        const price = latestRoundData[1].toBigInt();

        expect(price).to.eq(result);
      });
    }

    it('passes along roundId, startedAt, updatedAt and answeredInRound values from BTC / USD price feed', async () => {
      const { BTCToUSDPriceFeed, WBTCPriceFeed } = await makeWBTCPriceFeed({
        WBTCToBTCPrice: exp(1, 18),
        BTCToUSDPrice: exp(30_000, 18)
      });

      await BTCToUSDPriceFeed.setRoundData(
        exp(15, 18), // roundId_,
        1,           // answer_,
        exp(16, 8),  // startedAt_,
        exp(17, 8),  // updatedAt_,
        exp(18, 18)  // answeredInRound_
      );

      const roundData = await WBTCPriceFeed.latestRoundData();

      expect(roundData[0].toBigInt()).to.eq(exp(15, 18));
      expect(roundData[2].toBigInt()).to.eq(exp(16, 8));
      expect(roundData[3].toBigInt()).to.eq(exp(17, 8));
      expect(roundData[4].toBigInt()).to.eq(exp(18, 18));
    });
  });

  it('getters return correct values', async () => {
    const { WBTCPriceFeed } = await makeWBTCPriceFeed({
      WBTCToBTCPrice: exp(1, 18),
      BTCToUSDPrice: exp(30_000, 18)
    });

    expect(await WBTCPriceFeed.version()).to.eq(1);
    expect(await WBTCPriceFeed.description()).to.eq('Custom price feed for WBTC / USD');
    expect(await WBTCPriceFeed.decimals()).to.eq(8);
  });
});
