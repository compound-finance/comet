import { ethers, exp, expect } from './helpers';
import {
  SimplePriceFeed__factory,
  SimpleWstETH__factory,
  WstETHPriceFeed__factory
} from '../build/types';

export async function makeWstETH({ stEthPrice, tokensPerStEth }) {
  const SimplePriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
  const stETHPriceFeed = await SimplePriceFeedFactory.deploy(stEthPrice, 18);

  const SimpleWstETHFactory = (await ethers.getContractFactory('SimpleWstETH')) as SimpleWstETH__factory;
  const simpleWstETH = await SimpleWstETHFactory.deploy(tokensPerStEth);

  const wstETHPriceFeedFactory = (await ethers.getContractFactory('WstETHPriceFeed')) as WstETHPriceFeed__factory;
  const wstETHPriceFeed = await wstETHPriceFeedFactory.deploy(
    stETHPriceFeed.address,
    simpleWstETH.address,
    8
  );
  await wstETHPriceFeed.deployed();

  return {
    simpleWstETH,
    stETHPriceFeed,
    wstETHPriceFeed
  };
}

const testCases = [
  {
    stEthPrice: exp(1300, 18),
    tokensPerStEth: exp(.9, 18),
    result: 144444444444n
  },
  {
    stEthPrice: exp(1000, 18),
    tokensPerStEth: exp(.9, 18),
    result: 111111111111n
  },
  {
    stEthPrice: exp(1000, 18),
    tokensPerStEth: exp(.2, 18),
    result: exp(5000, 8)
  },
  {
    stEthPrice: exp(1000, 18),
    tokensPerStEth: exp(.5, 18),
    result: exp(2000, 8)
  },
  {
    stEthPrice: exp(1000, 18),
    tokensPerStEth: exp(.8, 18),
    result: exp(1250, 8)
  },
  {
    stEthPrice: exp(-1000, 18),
    tokensPerStEth: exp(.8, 18),
    result: exp(-1250, 8)
  },
];

describe('wstETH price feed', function () {
  it('reverts if constructed with bad decimals', async () => {
    const SimplePriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
    const stETHPriceFeed = await SimplePriceFeedFactory.deploy(exp(1, 18), 18);

    const SimpleWstETHFactory = (await ethers.getContractFactory('SimpleWstETH')) as SimpleWstETH__factory;
    const simpleWstETH = await SimpleWstETHFactory.deploy(exp(0.9, 18));

    const wstETHPriceFeedFactory = (await ethers.getContractFactory('WstETHPriceFeed')) as WstETHPriceFeed__factory;
    await expect(wstETHPriceFeedFactory.deploy(
      stETHPriceFeed.address,
      simpleWstETH.address,
      20 // decimals_ is too high
    )).to.be.revertedWith("custom error 'BadDecimals()'");
  });

  describe('latestRoundData', function () {
    for (const { stEthPrice, tokensPerStEth, result } of testCases) {
      it(`stEthPrice (${stEthPrice}), tokensPerStEth (${tokensPerStEth}) -> ${result}`, async () => {
        const { wstETHPriceFeed } = await makeWstETH({ stEthPrice, tokensPerStEth });
        const latestRoundData = await wstETHPriceFeed.latestRoundData();
        const price = latestRoundData.answer.toBigInt();

        expect(price).to.eq(result);
      });
    }

    it('passes along roundId, startedAt, updatedAt and answeredInRound values from stETH price feed', async () => {
      const { stETHPriceFeed, wstETHPriceFeed } = await makeWstETH({
        stEthPrice: exp(1000, 18),
        tokensPerStEth: exp(.8, 18),
      });

      await stETHPriceFeed.setRoundData(
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
      } = await wstETHPriceFeed.latestRoundData();

      expect(roundId.toBigInt()).to.eq(exp(15, 18));
      expect(startedAt.toBigInt()).to.eq(exp(16, 8));
      expect(updatedAt.toBigInt()).to.eq(exp(17, 8));
      expect(answeredInRound.toBigInt()).to.eq(exp(18, 18));
    });
  });
});
