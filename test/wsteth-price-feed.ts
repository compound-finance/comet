import hre, { ethers } from 'hardhat';
import { exp, expect } from './helpers';
import { HttpNetworkConfig } from 'hardhat/types/config';
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
    stEthPrice: exp(1000, 8),
    tokensPerStEth: exp(.2, 18),
    result: exp(200, 8)
  },
  {
    stEthPrice: exp(1000, 8),
    tokensPerStEth: exp(.4, 18),
    result: exp(400, 8)
  },
  {
    stEthPrice: exp(1000, 8),
    tokensPerStEth: exp(.6, 18),
    result: exp(600, 8)
  },
  {
    stEthPrice: exp(1000, 8),
    tokensPerStEth: exp(.8, 18),
    result: exp(800, 8)
  },
];

describe.only('wstETH price feed', function () {
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
    ).to.be.revertedWith('NotImplemented()');
  });
});
