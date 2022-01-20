import { expect, makeProtocol } from './helpers';

describe('getPrice', function () {
  it('returns price data for assets', async () => {
    const { comet } = await makeProtocol();

    const [_asset, _borrowCollateralFactor, _liquidateCollateralFactor, priceFeed] =
      await comet.getAssetInfo(0);

    const price = await comet.getPrice(priceFeed);

    const decimalizedPrice = price.toNumber() * 10 ** -8;

    expect(decimalizedPrice).to.be.greaterThan(0);
    expect(decimalizedPrice).to.be.lessThan(2000);
  });

  it('reverts if given a bad priceFeed address', async () => {
    const { comet } = await makeProtocol({
      base: 'USDC',
      assets: {
        USDC: {
          initial: 1e6,
          decimals: 6,
        },
        COMP: {
          initial: 1e7,
          decimals: 18,
          priceFeed: '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP on mainnet (not a legit price feed address)
        },
      },
    });

    const [_asset, _borrowCollateralFactor, _liquidateCollateralFactor, priceFeed] =
      await comet.getAssetInfo(0);

    await expect(comet.getPrice(priceFeed)).to.be.reverted;
  });
});
