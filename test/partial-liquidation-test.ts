import { expect, exp, makeConfigurator, ONE, makeProtocol, setTotalsBasic, bumpTotalsCollateral, portfolio, wait, event, factor, defaultAssets, mulPrice } from './helpers';

describe('CometWithPartialLiquidation', function () {
  it('should successfully absorb underwater accounts', async () => {
    const params = {
      supplyInterestRateBase: 0,
      supplyInterestRateSlopeLow: 0,
      supplyInterestRateSlopeHigh: 0,
      borrowInterestRateBase: 0,
      borrowInterestRateSlopeLow: 0,
      borrowInterestRateSlopeHigh: 0,
      assets: defaultAssets({
        borrowCF: factor(1 / 2),
        liquidateCF: factor(2 / 3),
      })
    };
    const protocol = await makeProtocol(params);
    const { comet, tokens, users: [absorber, underwater], priceFeeds } = protocol;
    const { COMP, WETH } = tokens;

    const borrowAmount = exp(4000, 6); // $4k debt
    await setTotalsBasic(comet, { totalBorrowBase: borrowAmount });
    await bumpTotalsCollateral(comet, COMP, exp(1, 18));
    await bumpTotalsCollateral(comet, WETH, exp(1, 18));

    const r0 = await comet.getReserves();

    await comet.setBasePrincipal(underwater.address, -borrowAmount);
    await comet.setCollateralBalance(underwater.address, COMP.address, exp(1, 18));
    await comet.setCollateralBalance(underwater.address, WETH.address, exp(1, 18));

    const pP0 = await portfolio(protocol, comet.address);
    const pA0 = await portfolio(protocol, absorber.address);
    const pU0 = await portfolio(protocol, underwater.address);

    const a0 = await wait(comet.absorb(absorber.address, [underwater.address]));

    const t1 = await comet.totalsBasic();
    const r1 = await comet.getReserves();

    const pP1 = await portfolio(protocol, comet.address);
    const pA1 = await portfolio(protocol, absorber.address);
    const pU1 = await portfolio(protocol, underwater.address);
    const lA1 = await comet.liquidatorPoints(absorber.address);
    const _lU1 = await comet.liquidatorPoints(underwater.address);

    expect(r0).to.be.equal(borrowAmount);
    expect(t1.totalSupplyBase).to.be.equal(0n);
    expect(t1.totalBorrowBase).to.be.equal(0n);
    expect(r1).to.be.equal(0n);

    expect(pP0.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pP0.external).to.be.deep.equal({ COMP: exp(1, 18), USDC: 0n, WBTC: 0n, WETH: exp(1, 18) });
    expect(pA0.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU0.internal).to.be.deep.equal({ COMP: exp(1, 18), USDC: -borrowAmount, WBTC: 0n, WETH: exp(1, 18) });
    expect(pU0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(pP1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pP1.external).to.be.deep.equal({ COMP: exp(1, 18), USDC: 0n, WBTC: 0n, WETH: exp(1, 18) });
    expect(pA1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(lA1.numAbsorbs).to.be.equal(1);
    expect(lA1.numAbsorbed).to.be.equal(1);
    expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));

    const [_a, usdcPrice] = await priceFeeds['USDC'].latestRoundData();
    const [_b, compPrice] = await priceFeeds['COMP'].latestRoundData();
    const [_c, wethPrice] = await priceFeeds['WETH'].latestRoundData();
    const baseScale = await comet.baseScale();
    const compScale = exp(1, await COMP.decimals());
    const wethScale = exp(1, await WETH.decimals());

    expect(event(a0, 0)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater.address,
        asset: COMP.address,
        collateralAbsorbed: exp(1, 18),
        usdValue: mulPrice(exp(1, 18), compPrice, compScale),
      }
    });
    expect(event(a0, 1)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater.address,
        asset: WETH.address,
        collateralAbsorbed: exp(1, 18),
        usdValue: mulPrice(exp(1, 18), wethPrice, wethScale),
      }
    });
    expect(event(a0, 2)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater.address,
        basePaidOut: borrowAmount,
        usdValue: mulPrice(borrowAmount, usdcPrice, baseScale),
      }
    });
  });
// ... existing code ...

it('should demonstrate partial liquidation with excessive collateral', async () => {
  const params = {
    supplyInterestRateBase: 0,
    supplyInterestRateSlopeLow: 0,
    supplyInterestRateSlopeHigh: 0,
    borrowInterestRateBase: 0,
    borrowInterestRateSlopeLow: 0,
    borrowInterestRateSlopeHigh: 0,
    assets: {
      COMP: {
        initial: 1e7,
        decimals: 18,
        initialPrice: 0.1, // Low price to make liquidation possible
      },
      WETH: {
        initial: 1e4,
        decimals: 18,
        initialPrice: 50.0, // Low price to make liquidation possible
      },
      USDC: {
        initial: 1e6,
        decimals: 6,
      },
    },
    reward: 'COMP',
  };
  const protocol = await makeProtocol(params);
  const { comet, tokens, users: [absorber, underwater], priceFeeds } = protocol;
  const { COMP, WETH } = protocol.tokens;

  const borrowAmount = exp(1000, 6); // $1000 debt
  await setTotalsBasic(comet, { totalBorrowBase: borrowAmount });
  await bumpTotalsCollateral(comet, COMP, exp(5, 18));
  await bumpTotalsCollateral(comet, WETH, exp(2, 18));

  const r0 = await comet.getReserves();

  await comet.setBasePrincipal(underwater.address, -borrowAmount);
  await comet.setCollateralBalance(underwater.address, COMP.address, exp(5, 18));
  await comet.setCollateralBalance(underwater.address, WETH.address, exp(2, 18));

  // Verify account is liquidatable
  expect(await comet.isLiquidatable(underwater.address)).to.be.true;

  const pP0 = await portfolio(protocol, comet.address);
  const pA0 = await portfolio(protocol, absorber.address);
  const pU0 = await portfolio(protocol, underwater.address);

  const a0 = await wait(comet.absorb(absorber.address, [underwater.address]));

  const t1 = await comet.totalsBasic();
  const r1 = await comet.getReserves();

  const pP1 = await portfolio(protocol, comet.address);
  const pA1 = await portfolio(protocol, absorber.address);
  const pU1 = await portfolio(protocol, underwater.address);
  const lA1 = await comet.liquidatorPoints(absorber.address);
  const _lU1 = await comet.liquidatorPoints(underwater.address);

  expect(r0).to.be.equal(borrowAmount);
  expect(t1.totalSupplyBase).to.be.equal(0n);
  expect(t1.totalBorrowBase).to.be.equal(0n);
  expect(r1).to.be.equal(0n);

  // Check that portfolio objects have the expected structure
  expect(pP0.internal).to.have.property('COMP');
  expect(pP0.internal).to.have.property('USDC');
  expect(pP0.internal).to.have.property('WETH');
  expect(pP0.external).to.have.property('COMP');
  expect(pP0.external).to.have.property('WETH');

  expect(pA0.internal).to.have.property('COMP');
  expect(pA0.internal).to.have.property('USDC');
  expect(pA0.internal).to.have.property('WETH');
  expect(pA0.external).to.have.property('COMP');
  expect(pA0.external).to.have.property('WETH');

  expect(pU0.internal).to.have.property('COMP');
  expect(pU0.internal).to.have.property('USDC');
  expect(pU0.internal).to.have.property('WETH');
  expect(pU0.external).to.have.property('COMP');
  expect(pU0.external).to.have.property('WETH');

  // Check specific values
  expect(pU0.internal.COMP).to.be.equal(exp(5, 18));
  expect(pU0.internal.USDC).to.be.equal(-borrowAmount);
  expect(pU0.internal.WETH).to.be.equal(exp(2, 18));

  expect(pU1.internal.COMP).to.be.equal(0n);
  expect(pU1.internal.USDC).to.be.equal(0n);
  expect(pU1.internal.WETH).to.be.equal(0n);

  expect(lA1.numAbsorbs).to.be.equal(1);
  expect(lA1.numAbsorbed).to.be.equal(1);
  expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));

  const [_a, usdcPrice] = await priceFeeds['USDC'].latestRoundData();
  const [_b, compPrice] = await priceFeeds['COMP'].latestRoundData();
  const [_c, wethPrice] = await priceFeeds['WETH'].latestRoundData();
  const baseScale = await comet.baseScale();
  const compScale = exp(1, await COMP.decimals());
  const wethScale = exp(1, await WETH.decimals());

  expect(event(a0, 0)).to.be.deep.equal({
    AbsorbCollateral: {
      absorber: absorber.address,
      borrower: underwater.address,
      asset: COMP.address,
      collateralAbsorbed: exp(5, 18),
      usdValue: mulPrice(exp(5, 18), compPrice, compScale),
    }
  });
  expect(event(a0, 1)).to.be.deep.equal({
    AbsorbCollateral: {
      absorber: absorber.address,
      borrower: underwater.address,
      asset: WETH.address,
      collateralAbsorbed: exp(2, 18),
      usdValue: mulPrice(exp(2, 18), wethPrice, wethScale),
    }
  });
  expect(event(a0, 2)).to.be.deep.equal({
    AbsorbDebt: {
      absorber: absorber.address,
      borrower: underwater.address,
      basePaidOut: borrowAmount,
      usdValue: mulPrice(borrowAmount, usdcPrice, baseScale),
    }
  });
});
});