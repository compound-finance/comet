import { ethers, exp, expect } from './helpers';
import {
  SimplePriceFeed__factory,
  SimpleWstETH__factory,
  WstETHPriceFeed__factory
} from '../build/types';

export async function makeWstETH({ stEthPrice, tokensPerStEth }) {
  const SimplePriceFeedFactory = (await ethers.getContractFactory('SimplePriceFeed')) as SimplePriceFeed__factory;
  const stETHpriceFeed = await SimplePriceFeedFactory.deploy(stEthPrice, 8);

  const SimpleWstETHFactory = (await ethers.getContractFactory('SimpleWstETH')) as SimpleWstETH__factory;
  const simpleWstETH = await SimpleWstETHFactory.deploy(tokensPerStEth);

  const wstETHPriceFeedFactory = (await ethers.getContractFactory('WstETHPriceFeed')) as WstETHPriceFeed__factory;
  const wstETHPriceFeed = await wstETHPriceFeedFactory.deploy(
    stETHpriceFeed.address,
    simpleWstETH.address
  );
  await wstETHPriceFeed.deployed();

  return {
    simpleWstETH,
    stETHpriceFeed,
    wstETHPriceFeed
  };
}

const testCases = [
  {
    stEthPrice: exp(1300, 8),
    tokensPerStEth: exp(.9, 18),
    result: 144444444444n
  },
  {
    stEthPrice: exp(1000, 8),
    tokensPerStEth: exp(.9, 18),
    result: 111111111111n
  },
  {
    stEthPrice: exp(1000, 8),
    tokensPerStEth: exp(.2, 18),
    result: exp(5000, 8)
  },
  {
    stEthPrice: exp(1000, 8),
    tokensPerStEth: exp(.5, 18),
    result: exp(2000, 8)
  },
  {
    stEthPrice: exp(1000, 8),
    tokensPerStEth: exp(.8, 18),
    result: exp(1250, 8)
  },
];

describe('wstETH price feed', function () {
  describe('latestRoundData', function () {
    for (const { stEthPrice, tokensPerStEth, result } of testCases) {
      it(`stEthPrice (${stEthPrice}), tokensPerStEth (${tokensPerStEth}) -> ${result}`, async () => {
        const { wstETHPriceFeed } = await makeWstETH({ stEthPrice, tokensPerStEth });
        const latestRoundData = await wstETHPriceFeed.latestRoundData();
        const price = latestRoundData.answer.toBigInt();

        expect(price).to.eq(result);
      });
    }
  });

  it(`getRoundData > always reverts`, async () => {
    const { wstETHPriceFeed } = await makeWstETH({
      stEthPrice: exp(1000, 8),
      tokensPerStEth: exp(.2, 18)
    });

    await expect(
      wstETHPriceFeed.getRoundData(1)
    ).to.be.revertedWith("custom error 'NotImplemented()'");
  });
});
