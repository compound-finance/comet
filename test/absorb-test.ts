import { ethers } from 'ethers';
import { event, expect, exp, factor, defaultAssets, makeProtocol, mulPrice, portfolio, totalsAndReserves, wait, bumpTotalsCollateral, setTotalsBasic } from './helpers';

describe('absorb', function () {
  it('reverts if total borrows underflows', async () => {
    const { comet, users: [absorber, underwater] } = await makeProtocol();

    const _f0 = await comet.setBasePrincipal(underwater.address, -100);
    await expect(comet.absorb(absorber.address, [underwater.address])).to.be.revertedWith('code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
  });

  it('absorbs 1 account and pays out the absorber', async () => {
    const params = {
      supplyInterestRateBase: 0,
      supplyInterestRateSlopeLow: 0,
      supplyInterestRateSlopeHigh: 0,
      borrowInterestRateBase: 0,
      borrowInterestRateSlopeLow: 0,
      borrowInterestRateSlopeHigh: 0,
    };
    const protocol = await makeProtocol(params);
    const { comet, priceFeeds, users: [absorber, underwater] } = protocol;

    await setTotalsBasic(comet, { totalBorrowBase: 100n });

    await comet.setBasePrincipal(underwater.address, -100);

    const r0 = await comet.getReserves();

    const pA0 = await portfolio(protocol, absorber.address);
    const pU0 = await portfolio(protocol, underwater.address);

    const a0 = await wait(comet.absorb(absorber.address, [underwater.address]));

    const t1 = await comet.totalsBasic();
    const r1 = await comet.getReserves();

    const pA1 = await portfolio(protocol, absorber.address);
    const pU1 = await portfolio(protocol, underwater.address);
    const lA1 = await comet.liquidatorPoints(absorber.address);
    const lU1 = await comet.liquidatorPoints(underwater.address);

    expect(r0).to.be.equal(100);

    expect(t1.totalSupplyBase).to.be.equal(0);
    expect(t1.totalBorrowBase).to.be.equal(0);
    expect(r1).to.be.equal(0);

    expect(pA0.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU0.internal).to.be.deep.equal({ COMP: 0n, USDC: -100n, WBTC: 0n, WETH: 0n });
    expect(pU0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(pA1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(lA1.numAbsorbs).to.be.equal(1);
    expect(lA1.numAbsorbed).to.be.equal(1);
    //expect(lA1.approxSpend).to.be.equal(1672498842684n);
    expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));

    expect(lU1.numAbsorbs).to.be.equal(0);
    expect(lU1.numAbsorbed).to.be.equal(0);
    expect(lU1.approxSpend).to.be.equal(0);

    const [_, usdcPrice] = await priceFeeds['USDC'].latestRoundData();
    const baseScale = await comet.baseScale();
    expect(event(a0, 0)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater.address,
        basePaidOut: 100n,
        usdValue: mulPrice(100n, usdcPrice, baseScale),
      }
    });
  });

  it('absorbs 2 accounts and pays out the absorber', async () => {
    const params = {
      supplyInterestRateBase: 0,
      supplyInterestRateSlopeLow: 0,
      supplyInterestRateSlopeHigh: 0,
      borrowInterestRateBase: 0,
      borrowInterestRateSlopeLow: 0,
      borrowInterestRateSlopeHigh: 0,
    };
    const protocol = await makeProtocol(params);
    const { comet, priceFeeds, users: [absorber, underwater1, underwater2] } = protocol;

    await setTotalsBasic(comet, { totalBorrowBase: 2000n });

    const r0 = await comet.getReserves();

    await comet.setBasePrincipal(underwater1.address, -100);
    await comet.setBasePrincipal(underwater2.address, -700);

    const pA0 = await portfolio(protocol, absorber.address);
    const pU1_0 = await portfolio(protocol, underwater1.address);
    const pU2_0 = await portfolio(protocol, underwater2.address);

    const a0 = await wait(comet.absorb(absorber.address, [underwater1.address, underwater2.address]));

    const t1 = await comet.totalsBasic();
    const r1 = await comet.getReserves();

    const pA1 = await portfolio(protocol, absorber.address);
    const pU1_1 = await portfolio(protocol, underwater1.address);
    const pU2_1 = await portfolio(protocol, underwater2.address);
    const lA1 = await comet.liquidatorPoints(absorber.address);
    const _lU1_1 = await comet.liquidatorPoints(underwater1.address);
    const _lU2_1 = await comet.liquidatorPoints(underwater2.address);

    expect(r0).to.be.equal(2000);

    expect(t1.totalSupplyBase).to.be.equal(0n);
    expect(t1.totalBorrowBase).to.be.equal(1200n);
    expect(r1).to.be.equal(1200);

    expect(pA0.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1_0.internal).to.be.deep.equal({ COMP: 0n, USDC: -100n, WBTC: 0n, WETH: 0n });
    expect(pU1_0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU2_0.internal).to.be.deep.equal({ COMP: 0n, USDC: -700n, WBTC: 0n, WETH: 0n });
    expect(pU2_0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(pA1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1_1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1_1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU2_1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU2_1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(lA1.numAbsorbs).to.be.equal(1);
    expect(lA1.numAbsorbed).to.be.equal(2);
    //expect(lA1.approxSpend).to.be.equal(459757131288n);
    expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));

    const [_, usdcPrice] = await priceFeeds['USDC'].latestRoundData();
    const baseScale = await comet.baseScale();
    expect(event(a0, 0)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater1.address,
        basePaidOut: 100n,
        usdValue: mulPrice(100n, usdcPrice, baseScale),
      }
    });
    expect(event(a0, 1)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater2.address,
        basePaidOut: 700n,
        usdValue: mulPrice(700n, usdcPrice, baseScale),
      }
    });
  });

  it('absorbs 3 accounts with collateral and pays out the absorber', async () => {
    const params = {
      supplyInterestRateBase: 0,
      supplyInterestRateSlopeLow: 0,
      supplyInterestRateSlopeHigh: 0,
      borrowInterestRateBase: 0,
      borrowInterestRateSlopeLow: 0,
      borrowInterestRateSlopeHigh: 0,
    };
    const protocol = await makeProtocol(params);
    const { comet, tokens, priceFeeds, users: [absorber, underwater1, underwater2, underwater3] } = protocol;
    const { COMP, WBTC, WETH } = tokens;

    await setTotalsBasic(comet, {
      totalBorrowBase: exp(3e15, 6),
      totalSupplyBase: exp(4e15, 6),
    });
    await bumpTotalsCollateral(comet, COMP, exp(1e-6, 18) + exp(10, 18) + exp(10000, 18));
    await bumpTotalsCollateral(comet, WETH, exp(1, 18) + exp(50, 18));
    await bumpTotalsCollateral(comet, WBTC, exp(50, 8));

    await comet.setBasePrincipal(underwater1.address, -exp(1, 6));
    await comet.setCollateralBalance(underwater1.address, COMP.address, exp(1e-6, 18));

    await comet.setBasePrincipal(underwater2.address, -exp(1, 12));
    await comet.setCollateralBalance(underwater2.address, COMP.address, exp(10, 18));
    await comet.setCollateralBalance(underwater2.address, WETH.address, exp(1, 18));

    await comet.setBasePrincipal(underwater3.address, -exp(1, 18));
    await comet.setCollateralBalance(underwater3.address, COMP.address, exp(10000, 18));
    await comet.setCollateralBalance(underwater3.address, WETH.address, exp(50, 18));
    await comet.setCollateralBalance(underwater3.address, WBTC.address, exp(50, 8));

    const pP0 = await portfolio(protocol, comet.address);
    const pA0 = await portfolio(protocol, absorber.address);
    const pU1_0 = await portfolio(protocol, underwater1.address);
    const pU2_0 = await portfolio(protocol, underwater2.address);
    const pU3_0 = await portfolio(protocol, underwater3.address);
    const cTR0 = await totalsAndReserves(protocol);

    const a0 = await wait(comet.absorb(absorber.address, [underwater1.address, underwater2.address, underwater3.address]));

    const t1 = await comet.totalsBasic();

    const pP1 = await portfolio(protocol, comet.address);
    const pA1 = await portfolio(protocol, absorber.address);
    const pU1_1 = await portfolio(protocol, underwater1.address);
    const pU2_1 = await portfolio(protocol, underwater2.address);
    const pU3_1 = await portfolio(protocol, underwater3.address);
    const lA1 = await comet.liquidatorPoints(absorber.address);
    const _lU1_1 = await comet.liquidatorPoints(underwater1.address);
    const _lU2_1 = await comet.liquidatorPoints(underwater2.address);
    const _lU3_1 = await comet.liquidatorPoints(underwater3.address);
    const cTR1 = await totalsAndReserves(protocol);

    expect(cTR0.totals).to.be.deep.equal({
      COMP: exp(1, 12) + exp(10, 18) + exp(10000, 18),
      USDC: exp(4e15, 6),
      WBTC: exp(50, 8),
      WETH: exp(1, 18) + exp(50, 18)
    });
    expect(cTR0.reserves).to.be.deep.equal({ COMP: 0n, USDC: -exp(1e15, 6), WBTC: 0n, WETH: 0n });

    expect(t1.totalSupplyBase).to.be.equal(exp(4e15, 6));
    expect(t1.totalBorrowBase).to.be.equal(exp(3e15, 6) - exp(1, 18) - exp(1, 12) - exp(1, 6));
    expect(cTR1.totals).to.be.deep.equal({ COMP: 0n, USDC: exp(4e15, 6), WBTC: 0n, WETH: 0n });
    expect(cTR1.reserves).to.be.deep.equal({
      COMP: exp(1, 12) + exp(10, 18) + exp(10000, 18),
      USDC: -exp(1e15, 6) - exp(1, 6) - exp(1, 12) - exp(1, 18),
      WBTC: exp(50, 8),
      WETH: exp(1, 18) + exp(50, 18)
    });

    expect(pP0.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pP0.external).to.be.deep.equal({
      COMP: exp(1, 12) + exp(10, 18) + exp(10000, 18),
      USDC: 0n,
      WBTC: exp(50, 8),
      WETH: exp(1, 18) + exp(50, 18)
    });
    expect(pA0.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1_0.internal).to.be.deep.equal({ COMP: exp(1, 12), USDC: -exp(1, 6), WBTC: 0n, WETH: 0n });
    expect(pU1_0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU2_0.internal).to.be.deep.equal({ COMP: exp(10, 18), USDC: -exp(1, 12), WBTC: 0n, WETH: exp(1, 18) });
    expect(pU2_0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU3_0.internal).to.be.deep.equal({ COMP: exp(10000, 18), USDC: -exp(1, 18), WBTC: exp(50, 8), WETH: exp(50, 18) });
    expect(pU3_0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(pP1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pP1.external).to.be.deep.equal({
      COMP: exp(1, 12) + exp(10, 18) + exp(10000, 18),
      USDC: 0n,
      WBTC: exp(50, 8),
      WETH: exp(1, 18) + exp(50, 18)
    });
    expect(pA1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1_1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1_1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU2_1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU2_1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU3_1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU3_1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(lA1.numAbsorbs).to.be.equal(1);
    expect(lA1.numAbsorbed).to.be.equal(3);
    //expect(lA1.approxSpend).to.be.equal(130651238630n);
    expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));

    const [_a, usdcPrice] = await priceFeeds['USDC'].latestRoundData();
    const [_b, compPrice] = await priceFeeds['COMP'].latestRoundData();
    const [_c, wbtcPrice] = await priceFeeds['WBTC'].latestRoundData();
    const [_d, wethPrice] = await priceFeeds['WETH'].latestRoundData();
    const baseScale = await comet.baseScale();
    const compScale = exp(1, await COMP.decimals());
    const wbtcScale = exp(1, await WBTC.decimals());
    const wethScale = exp(1, await WETH.decimals());
    // Underwater account 1
    expect(event(a0, 0)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater1.address,
        asset: COMP.address,
        collateralAbsorbed: exp(1, 12),
        usdValue: mulPrice(exp(1, 12), compPrice, compScale),
      }
    });
    expect(event(a0, 1)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater1.address,
        basePaidOut: exp(1, 6),
        usdValue: mulPrice(exp(1, 6), usdcPrice, baseScale),
      }
    });
    // Underwater account 2
    expect(event(a0, 2)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater2.address,
        asset: COMP.address,
        collateralAbsorbed: exp(10, 18),
        usdValue: mulPrice(exp(10, 18), compPrice, compScale),
      }
    });
    expect(event(a0, 3)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater2.address,
        asset: WETH.address,
        collateralAbsorbed: exp(1, 18),
        usdValue: mulPrice(exp(1, 18), wethPrice, wethScale),
      }
    });
    expect(event(a0, 4)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater2.address,
        basePaidOut: exp(1, 12),
        usdValue: mulPrice(exp(1, 12), usdcPrice, baseScale),
      }
    });
    // Underwater account 3
    expect(event(a0, 5)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater3.address,
        asset: COMP.address,
        collateralAbsorbed: exp(10000, 18),
        usdValue: mulPrice(exp(10000, 18), compPrice, compScale),
      }
    });
    expect(event(a0, 6)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater3.address,
        asset: WETH.address,
        collateralAbsorbed: exp(50, 18),
        usdValue: mulPrice(exp(50, 18), wethPrice, wethScale),
      }
    });
    expect(event(a0, 7)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater3.address,
        asset: WBTC.address,
        collateralAbsorbed: exp(50, 8),
        usdValue: mulPrice(exp(50, 8), wbtcPrice, wbtcScale),
      }
    });
    expect(event(a0, 8)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater3.address,
        basePaidOut: exp(1, 18),
        usdValue: mulPrice(exp(1, 18), usdcPrice, baseScale),
      }
    });
  });

  it('absorbs an account with more than enough collateral to still cover debt', async () => {
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
    const { COMP, WBTC, WETH } = tokens;

    const finalDebt = 1n;
    const startingDebt = finalDebt - (exp(41000, 6) + exp(3000, 6) + exp(175, 6));
    await setTotalsBasic(comet, {
      totalBorrowBase: -startingDebt,
    });
    await bumpTotalsCollateral(comet, COMP, exp(1, 18));
    await bumpTotalsCollateral(comet, WETH, exp(1, 18));
    await bumpTotalsCollateral(comet, WBTC, exp(1, 8));

    const r0 = await comet.getReserves();

    await comet.setBasePrincipal(underwater.address, startingDebt);
    await comet.setCollateralBalance(underwater.address, COMP.address, exp(1, 18));
    await comet.setCollateralBalance(underwater.address, WETH.address, exp(1, 18));
    await comet.setCollateralBalance(underwater.address, WBTC.address, exp(1, 8));

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

    expect(r0).to.be.equal(-startingDebt);
    expect(t1.totalSupplyBase).to.be.equal(finalDebt);
    expect(t1.totalBorrowBase).to.be.equal(0);
    expect(r1).to.be.equal(-finalDebt);

    expect(pP0.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pP0.external).to.be.deep.equal({ COMP: exp(1, 18), USDC: 0n, WBTC: exp(1, 8), WETH: exp(1, 18) });
    expect(pA0.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU0.internal).to.be.deep.equal({ COMP: exp(1, 18), USDC: startingDebt, WBTC: exp(1, 8), WETH: exp(1, 18) });
    expect(pU0.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(pP1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pP1.external).to.be.deep.equal({ COMP: exp(1, 18), USDC: 0n, WBTC: exp(1, 8), WETH: exp(1, 18) });
    expect(pA1.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pA1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pU1.internal).to.be.deep.equal({ COMP: 0n, USDC: 1n, WBTC: 0n, WETH: 0n });
    expect(pU1.external).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });

    expect(lA1.numAbsorbs).to.be.equal(1);
    expect(lA1.numAbsorbed).to.be.equal(1);
    //expect(lA1.approxSpend).to.be.equal(1672498842684n);
    expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));

    const [_a, usdcPrice] = await priceFeeds['USDC'].latestRoundData();
    const [_b, compPrice] = await priceFeeds['COMP'].latestRoundData();
    const [_c, wbtcPrice] = await priceFeeds['WBTC'].latestRoundData();
    const [_d, wethPrice] = await priceFeeds['WETH'].latestRoundData();
    const baseScale = await comet.baseScale();
    const compScale = exp(1, await COMP.decimals());
    const wbtcScale = exp(1, await WBTC.decimals());
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
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater.address,
        asset: WBTC.address,
        collateralAbsorbed: exp(1, 8),
        usdValue: mulPrice(exp(1, 8), wbtcPrice, wbtcScale),
      }
    });
    expect(event(a0, 3)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater.address,
        basePaidOut: pU1.internal.USDC - startingDebt,
        usdValue: mulPrice(pU1.internal.USDC - startingDebt, usdcPrice, baseScale),
      }
    });
    expect(event(a0, 4)).to.be.deep.equal({
      Transfer: {
        amount: finalDebt,
        from: ethers.constants.AddressZero,
        to: underwater.address,
      }
    });
  });

  it('reverts if an account is not underwater', async () => {
    const { comet, users: [alice, bob] } = await makeProtocol();

    await expect(comet.absorb(alice.address, [bob.address])).to.be.revertedWith("custom error 'NotLiquidatable()'");
  });

  it.skip('reverts if collateral asset value overflows base balance', async () => {
    // XXX
  });

  it('reverts if absorb is paused', async () => {
    const protocol = await makeProtocol();
    const { comet, pauseGuardian, users: [alice, bob] } = protocol;

    const cometAsB = comet.connect(bob);

    // Pause transfer
    await wait(comet.connect(pauseGuardian).pause(false, false, false, true, false));
    expect(await comet.isAbsorbPaused()).to.be.true;

    await expect(cometAsB.absorb(bob.address, [alice.address])).to.be.revertedWith("custom error 'Paused()'");
  });

  it('updates assetsIn for liquidated account', async () => {
    const { comet, users: [absorber, underwater], tokens } = await makeProtocol();
    const { COMP, WETH } = tokens;

    await bumpTotalsCollateral(comet, COMP, exp(1, 18));
    await bumpTotalsCollateral(comet, WETH, exp(1, 18));

    await comet.setCollateralBalance(underwater.address, COMP.address, exp(1, 18));
    await comet.setCollateralBalance(underwater.address, WETH.address, exp(1, 18));

    expect(await comet.getAssetList(underwater.address)).to.deep.equal([
      COMP.address,
      WETH.address,
    ]);

    const borrowAmount = exp(4000, 6); // borrow of $4k > collateral of $3k + $175
    await comet.setBasePrincipal(underwater.address, -borrowAmount);
    await setTotalsBasic(comet, { totalBorrowBase: borrowAmount });

    const isLiquidatable = await comet.isLiquidatable(underwater.address);

    expect(isLiquidatable).to.be.true;

    await comet.absorb(absorber.address, [underwater.address]);

    expect(await comet.getAssetList(underwater.address)).to.be.empty;
  });
});