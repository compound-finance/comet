import { Comet, ethers, expect, exp, makeProtocol, wait } from './helpers';

describe('constructor', function () {
  it('sets the baseBorrowMin', async function () {
    // XXX
  });

  it('reverts if baseTokenPriceFeed does not have 8 decimals', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {
            priceFeedDecimals: 18,
          },
        },
      })
    ).to.be.revertedWith('baseTokenPriceFeed.decimals != 8');
  });

  it('reverts if asset has a price feed that does not have 8 decimals', async () => {
    await expect(
      makeProtocol({
        assets: {
          USDC: {},
          COMP: {
            initial: 1e7,
            decimals: 18,
            initialPrice: 1.2345,
            priceFeedDecimals: 18, // too many decimals
          },
        },
      })
    ).to.be.revertedWith('priceFeed.decimals != 8');
  });
});
