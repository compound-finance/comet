import { expect, makeProtocol } from './helpers';

describe('getPrice', function () {
  it('returns price data for assets, with 8 decimals', async () => {
    const { comet, priceFeeds } = await makeProtocol({
      assets: {
        USDC: {},
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1.2345,
        },
      },
    });

    const price = await comet.getPrice(priceFeeds.COMP.address);

    expect(price.toNumber()).to.equal(123450000);
  });

  it('reverts if given a bad priceFeed address', async () => {
    const { comet } = await makeProtocol();

    // COMP on mainnet (not a legit price feed address)
    const invalidPriceFeedAddress = '0xc00e94cb662c3520282e6f5717214004a7f26888';

    await expect(comet.getPrice(invalidPriceFeedAddress)).to.be.reverted;
  });

  it('reverts if price feed returns negative value', async () => {
    const { comet, priceFeeds } = await makeProtocol({
      assets: {
        USDC: {},
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: -1,
        },
      },
    });

    await expect(comet.getPrice(priceFeeds.COMP.address)).to.be.revertedWith("custom error 'BadPrice()'");
  });
});
