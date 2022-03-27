import { Comet, ethers, expect, exp, makeProtocol, portfolio, wait } from './helpers';

describe('quoteCollateral', function () {
  it('quotes the collateral correctly for a positive base amount', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0.8, 18),
      targetReserves: 100,
      assets: {
        USDC: {
          initial: 1e6,
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 200,
        },
      }
    });
    const { comet, tokens } = protocol;
    const { USDC, COMP } = tokens;

    const baseAmount = exp(200, 6);
    const q0 = await comet.quoteCollateral(COMP.address, baseAmount);

    // 200 USDC should give 200 * (1/160) COMP
    const assetPriceDiscounted = exp(160, 8);
    const basePrice = exp(1, 8);
    const assetScale = exp(1, 18);
    const assetWeiPerUnitBase = assetScale * basePrice / assetPriceDiscounted;
    const baseScale = exp(1, 6);
    expect(q0).to.be.equal(assetWeiPerUnitBase * baseAmount / baseScale);
    expect(q0).to.be.equal(exp(1.25, 18));
  });

  it('quotes the collateral correctly for a zero base amount', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      targetReserves: 100,
      assets: {
        USDC: {
          initial: 1e6,
          decimals: 6,
          initialPrice: 1,
        },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 200,
        },
      }
    });
    const { comet, tokens } = protocol;
    const { USDC, COMP } = tokens;

    const baseAmount = 0n;
    const q0 = await comet.quoteCollateral(COMP.address, baseAmount);

    expect(q0).to.be.equal(0n);
  });

  it.skip('check for overflow', async () => {
    // XXX
  });

});
