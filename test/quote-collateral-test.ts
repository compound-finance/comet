import { expect, exp, makeProtocol } from './helpers';

describe('quoteCollateral', function () {
  it('quotes the collateral correctly for a positive base amount', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0.5, 18),
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
          liquidationFactor: exp(0.6, 18),
        },
      }
    });
    const { comet, tokens } = protocol;
    const { COMP } = tokens;

    const baseAmount = exp(200, 6);
    const q0 = await comet.quoteCollateral(COMP.address, baseAmount);

    // Store front discount is 0.5 * (1 - 0.6) = 0.2 = 20%
    // Discounted COMP price is 200 * 0.8 = 160
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
    const { COMP } = tokens;

    const baseAmount = 0n;
    const q0 = await comet.quoteCollateral(COMP.address, baseAmount);

    expect(q0).to.be.equal(0n);
  });

  it('quotes the collateral at market price when storeFrontPriceFactor is 0%', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0, 18),
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
          liquidationFactor: exp(0.6, 18),
        },
      }
    });
    const { comet, tokens } = protocol;
    const { COMP } = tokens;

    const baseAmount = exp(200, 6);
    const q0 = await comet.quoteCollateral(COMP.address, baseAmount);

    // Store front discount is 0 * (1 - 0.6) = 0 = 0%
    // Discounted COMP price is 200 * 1 = 200
    // 200 USDC should give 200 * (1/200) COMP
    const assetPriceDiscounted = exp(200, 8);
    const basePrice = exp(1, 8);
    const assetScale = exp(1, 18);
    const assetWeiPerUnitBase = assetScale * basePrice / assetPriceDiscounted;
    const baseScale = exp(1, 6);
    expect(q0).to.be.equal(assetWeiPerUnitBase * baseAmount / baseScale);
    expect(q0).to.be.equal(exp(1, 18));
  });

  // Should fail before PR 303
  it('properly calculates price without truncating integer during intermediate calculations', async () => {
    const protocol = await makeProtocol({
      base: 'USDC',
      storeFrontPriceFactor: exp(0.5, 18),
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
          initialPrice: 9,
          liquidationFactor: exp(0.8, 18),
        },
      }
    });
    const { comet, tokens } = protocol;
    const { COMP } = tokens;

    const baseAmount = exp(810, 6);
    const q0 = await comet.quoteCollateral(COMP.address, baseAmount);

    // Store front discount is 0.5 * (1 - 0.8) = 0.1 = 10%
    // Discounted COMP price is 9 * 0.9 = 8.1
    // 810 USDC should give 810 / (0.9 * 9) = 100 COMP
    expect(q0).to.be.equal(exp(100, 18));
  });

  it('does not overflow for large amounts', async () => {
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
          liquidationFactor: exp(0.75, 18),
        },
      }
    });
    const { comet, tokens } = protocol;
    const { COMP } = tokens;

    const baseAmount = exp(1e15, 6); // 1 quadrillion USDC
    const q0 = await comet.quoteCollateral(COMP.address, baseAmount);

    // Store front discount is 0.8 * (1 - 0.75) = 0.2 = 20%
    // Discounted COMP price is 200 * 0.8 = 160
    // 1e18 USDC should give 1e15 / (0.8 * 200) = 6.25e12 COMP
    expect(q0).to.be.equal(exp(6.25, 12 + 18));
  });
});
