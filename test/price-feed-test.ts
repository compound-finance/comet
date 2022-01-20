import { expect, ethers, makeProtocol } from './helpers';
import { getDefaultProviderURL } from '../hardhat.config';

describe('getPrice', function () {
  beforeEach(async () => {
    // test against a hardhat network forked from mainnet, so that ChainLink
    // contracts exist
    await ethers.provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: getDefaultProviderURL('mainnet'),
        },
      },
    ]);
  });

  afterEach(async () => {
    await ethers.provider.send('hardhat_reset', []);
  });

  it('returns price data for assets', async () => {
    const { comet } = await makeProtocol();

    const [_asset, _borrowCollateralFactor, _liquidateCollateralFactor, _supplyCap, priceFeed] =
      await comet.getAssetInfo(0);

    const price = await comet.getPrice(priceFeed);

    const decimalizedPrice = price.toNumber() * 10 ** -8;

    expect(decimalizedPrice).to.be.greaterThan(0);
    expect(decimalizedPrice).to.be.lessThan(2000);
  });

  it('reverts if given a bad priceFeed address', async () => {
    const { comet } = await makeProtocol({
      assets: {
        USDC: {},
        COMP: {
          initial: 1e7,
          decimals: 18,
          priceFeed: '0xc00e94cb662c3520282e6f5717214004a7f26888', // COMP on mainnet (not a legit price feed address)
        },
      },
    });

    const [_asset, _borrowCollateralFactor, _liquidateCollateralFactor, _supplyCap, priceFeed] =
      await comet.getAssetInfo(0);

    await expect(comet.getPrice(priceFeed)).to.be.reverted;
  });
});
