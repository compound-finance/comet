import { ContractTransaction, BigNumber } from 'ethers';
import { event, expect, exp, factor, defaultAssets, makeProtocol, mulPrice, portfolio, totalsAndReserves, wait, bumpTotalsCollateral, setTotalsBasic, makeConfigurator, takeSnapshot, SnapshotRestorer, MAX_ASSETS, divPrice, presentValue, principalValue } from './helpers';
import { ethers } from './helpers';
import { CometExtAssetList, CometProxyAdmin, CometWithExtendedAssetList, Configurator, ConfiguratorProxy, FaucetToken, NonStandardFaucetFeeToken, PriceFeedWithRevert, PriceFeedWithRevert__factory, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('absorb', function () {
  it('reverts if total borrows underflows', async () => {
    const {
      comet,
      users: [absorber, underwater],
    } = await makeProtocol();

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
    const {
      comet,
      priceFeeds,
      users: [absorber, underwater],
    } = protocol;

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
      },
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
    const {
      comet,
      priceFeeds,
      users: [absorber, underwater1, underwater2],
    } = protocol;

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
      },
    });
    expect(event(a0, 1)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater2.address,
        basePaidOut: 700n,
        usdValue: mulPrice(700n, usdcPrice, baseScale),
      },
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
    const {
      comet,
      tokens,
      priceFeeds,
      users: [absorber, underwater1, underwater2, underwater3],
    } = protocol;
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
      WETH: exp(1, 18) + exp(50, 18),
    });
    expect(cTR0.reserves).to.be.deep.equal({ COMP: 0n, USDC: -exp(1e15, 6), WBTC: 0n, WETH: 0n });

    expect(t1.totalSupplyBase).to.be.equal(exp(4e15, 6));
    expect(t1.totalBorrowBase).to.be.equal(exp(3e15, 6) - exp(1, 18) - exp(1, 12) - exp(1, 6));
    expect(cTR1.totals).to.be.deep.equal({ COMP: 0n, USDC: exp(4e15, 6), WBTC: 0n, WETH: 0n });
    expect(cTR1.reserves).to.be.deep.equal({
      COMP: exp(1, 12) + exp(10, 18) + exp(10000, 18),
      USDC: -exp(1e15, 6) - exp(1, 6) - exp(1, 12) - exp(1, 18),
      WBTC: exp(50, 8),
      WETH: exp(1, 18) + exp(50, 18),
    });

    expect(pP0.internal).to.be.deep.equal({ COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n });
    expect(pP0.external).to.be.deep.equal({
      COMP: exp(1, 12) + exp(10, 18) + exp(10000, 18),
      USDC: 0n,
      WBTC: exp(50, 8),
      WETH: exp(1, 18) + exp(50, 18),
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
      WETH: exp(1, 18) + exp(50, 18),
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
      },
    });
    expect(event(a0, 1)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater1.address,
        basePaidOut: exp(1, 6),
        usdValue: mulPrice(exp(1, 6), usdcPrice, baseScale),
      },
    });
    // Underwater account 2
    expect(event(a0, 2)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater2.address,
        asset: COMP.address,
        collateralAbsorbed: exp(10, 18),
        usdValue: mulPrice(exp(10, 18), compPrice, compScale),
      },
    });
    expect(event(a0, 3)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater2.address,
        asset: WETH.address,
        collateralAbsorbed: exp(1, 18),
        usdValue: mulPrice(exp(1, 18), wethPrice, wethScale),
      },
    });
    expect(event(a0, 4)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater2.address,
        basePaidOut: exp(1, 12),
        usdValue: mulPrice(exp(1, 12), usdcPrice, baseScale),
      },
    });
    // Underwater account 3
    expect(event(a0, 5)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater3.address,
        asset: COMP.address,
        collateralAbsorbed: exp(10000, 18),
        usdValue: mulPrice(exp(10000, 18), compPrice, compScale),
      },
    });
    expect(event(a0, 6)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater3.address,
        asset: WETH.address,
        collateralAbsorbed: exp(50, 18),
        usdValue: mulPrice(exp(50, 18), wethPrice, wethScale),
      },
    });
    expect(event(a0, 7)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater3.address,
        asset: WBTC.address,
        collateralAbsorbed: exp(50, 8),
        usdValue: mulPrice(exp(50, 8), wbtcPrice, wbtcScale),
      },
    });
    expect(event(a0, 8)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater3.address,
        basePaidOut: exp(1, 18),
        usdValue: mulPrice(exp(1, 18), usdcPrice, baseScale),
      },
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
      }),
    };
    const protocol = await makeProtocol(params);
    const {
      comet,
      tokens,
      users: [absorber, underwater],
      priceFeeds,
    } = protocol;
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
      },
    });
    expect(event(a0, 1)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater.address,
        asset: WETH.address,
        collateralAbsorbed: exp(1, 18),
        usdValue: mulPrice(exp(1, 18), wethPrice, wethScale),
      },
    });
    expect(event(a0, 2)).to.be.deep.equal({
      AbsorbCollateral: {
        absorber: absorber.address,
        borrower: underwater.address,
        asset: WBTC.address,
        collateralAbsorbed: exp(1, 8),
        usdValue: mulPrice(exp(1, 8), wbtcPrice, wbtcScale),
      },
    });
    expect(event(a0, 3)).to.be.deep.equal({
      AbsorbDebt: {
        absorber: absorber.address,
        borrower: underwater.address,
        basePaidOut: pU1.internal.USDC - startingDebt,
        usdValue: mulPrice(pU1.internal.USDC - startingDebt, usdcPrice, baseScale),
      },
    });
    expect(event(a0, 4)).to.be.deep.equal({
      Transfer: {
        amount: finalDebt,
        from: ethers.constants.AddressZero,
        to: underwater.address,
      },
    });
  });

  it('reverts if an account is not underwater', async () => {
    const {
      comet,
      users: [alice, bob],
    } = await makeProtocol();

    await expect(comet.absorb(alice.address, [bob.address])).to.be.revertedWith("custom error 'NotLiquidatable()'");
  });

  it.skip('reverts if collateral asset value overflows base balance', async () => {
    // XXX
  });

  it('reverts if absorb is paused', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      pauseGuardian,
      users: [alice, bob],
    } = protocol;

    const cometAsB = comet.connect(bob);

    // Pause transfer
    await wait(comet.connect(pauseGuardian).pause(false, false, false, true, false));
    expect(await comet.isAbsorbPaused()).to.be.true;

    await expect(cometAsB.absorb(bob.address, [alice.address])).to.be.revertedWith("custom error 'Paused()'");
  });

  it('updates assetsIn for liquidated account', async () => {
    const {
      comet,
      users: [absorber, underwater],
      tokens,
    } = await makeProtocol();
    const { COMP, WETH } = tokens;

    await bumpTotalsCollateral(comet, COMP, exp(1, 18));
    await bumpTotalsCollateral(comet, WETH, exp(1, 18));

    await comet.setCollateralBalance(underwater.address, COMP.address, exp(1, 18));
    await comet.setCollateralBalance(underwater.address, WETH.address, exp(1, 18));

    expect(await comet.getAssetList(underwater.address)).to.deep.equal([COMP.address, WETH.address]);

    const borrowAmount = exp(4000, 6); // borrow of $4k > collateral of $3k + $175
    await comet.setBasePrincipal(underwater.address, -borrowAmount);
    await setTotalsBasic(comet, { totalBorrowBase: borrowAmount });

    const isLiquidatable = await comet.isLiquidatable(underwater.address);

    expect(isLiquidatable).to.be.true;

    await comet.absorb(absorber.address, [underwater.address]);

    expect(await comet.getAssetList(underwater.address)).to.be.empty;
  });

  it('updates assetsIn for liquidated account in 24 assets', async () => {
    const protocol = await makeProtocol({
      assets: {
        // 24 assets
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 175,
        },
        WETH: {
          initial: 1e4,
          decimals: 18,
          initialPrice: 3000,
        },
        WBTC: {
          initial: 1e3,
          decimals: 8,
          initialPrice: 41000,
        },
        ASSET3: {},
        ASSET4: {},
        ASSET5: {},
        ASSET6: {},
        ASSET7: {},
        ASSET8: {},
        ASSET9: {},
        ASSET10: {},
        ASSET11: {},
        ASSET12: {},
        ASSET13: {},
        ASSET14: {},
        ASSET15: {},
        ASSET16: {},
        ASSET17: {},
        ASSET18: {},
        ASSET19: {},
        ASSET20: {},
        ASSET21: {},
        ASSET22: {},
        ASSET23: {},
        USDC: {
          initial: 1e6,
          decimals: 6,
        },
      },
      reward: 'COMP',
    });
    const {
      cometWithExtendedAssetList: comet,
      tokens: { COMP, WETH },
      users: [absorber, underwater],
    } = protocol;

    await bumpTotalsCollateral(comet, COMP, exp(1, 18));
    await bumpTotalsCollateral(comet, WETH, exp(1, 18));

    await comet.setCollateralBalance(underwater.address, COMP.address, exp(1, 18));
    await comet.setCollateralBalance(underwater.address, WETH.address, exp(1, 18));

    for (let i = 3; i < 24; i++) {
      const asset = `ASSET${i}`;
      await bumpTotalsCollateral(comet, protocol.tokens[asset], exp(1, 18));
      await comet.setCollateralBalance(underwater.address, protocol.tokens[asset].address, exp(1, 18));
    }

    expect(await comet.getAssetList(underwater.address)).to.deep.equal([COMP.address, WETH.address, ...Array.from({ length: 21 }, (_, i) => protocol.tokens[`ASSET${i + 3}`].address)]);

    const borrowAmount = exp(4000, 6); // borrow of $4k > collateral of $3k + $175
    await comet.setBasePrincipal(underwater.address, -borrowAmount);
    await setTotalsBasic(comet, { totalBorrowBase: borrowAmount });

    const isLiquidatable = await comet.isLiquidatable(underwater.address);

    expect(isLiquidatable).to.be.true;

    await comet.absorb(absorber.address, [underwater.address]);

    expect(await comet.getAssetList(underwater.address)).to.be.empty;
  });

  /*
   * Written after the USDM incident, where a removed Chainlink price feed caused absorb to revert
   * while calculating the USD value of seized collateral, freezing liquidations.
   *
   * This suite covers four (LCF, LF) combinations and how each affects absorption:
   *   1. LCF > 0, LF > 0  - active collateral: price fetched, collateral seized at full USD value.
   *   2. LCF > 0, LF = 0  - soft de-list: price still fetched (isLiquidatable counts it), but
   *                          absorbInternal skips seizure; full debt absorbed by reserves.
   *   3. LCF = 0, LF > 0  - worthless seizure: price fetch skipped (assetPrices[i] = 0), collateral
   *                          still seized and moved to reserves but with usdValue = 0.
   *   4. LCF = 0, LF = 0  - full de-list: both price fetch and seizure skipped; asset completely
   *                          ignored during absorption, collateral left stranded in user's account.
   *
   * Also covers edge cases:
   *   - mixed liquidation factors across multiple assets: only assets with LF > 0 are seized.
   *   - price feed paralysis: a reverting price feed freezes isLiquidatable, isBorrowCollateralized,
   *     and absorb; restoring the feed unblocks all three. Governance can also set LCF = 0 to skip
   *     the price fetch entirely, resolving the paralysis without replacing the broken feed.
   */
  describe('absorb semantics across liquidationFactor values', function () {
    // Snapshot
    let snapshot: SnapshotRestorer;

    // Configurator and protocol
    let configurator: Configurator;
    let configuratorProxy: ConfiguratorProxy;
    let proxyAdmin: CometProxyAdmin;
    let cometProxyAddress: string;
    let assetListFactoryAddress: string;
    let comet: CometWithExtendedAssetList;
    let comet24Assets: CometWithExtendedAssetList;
    let configuratorProxy24Assets: Configurator;
    let proxyAdmin24Assets: CometProxyAdmin;
    let cometExt: CometExtAssetList;

    // Tokens
    let baseToken: FaucetToken | NonStandardFaucetFeeToken;
    let compToken: FaucetToken | NonStandardFaucetFeeToken;
    let baseToken24Assets: FaucetToken | NonStandardFaucetFeeToken;
    let tokens24Assets: Record<string, FaucetToken | NonStandardFaucetFeeToken>;

    // Users
    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let underwater24Assets: SignerWithAddress;
    let absorber24Assets: SignerWithAddress;

    // Price feeds
    let compPriceFeed: SimplePriceFeed;
    let priceFeeds24Assets: Record<string, SimplePriceFeed>;

    // Constants
    const aliceCompSupply = exp(1, 18);

    // Liquidation transaction
    let liquidationTx: ContractTransaction;

    // Data before absorption
    let userCollateralBeforeAbsorption: BigNumber;
    let totalsSupplyAssetBeforeAbsorption: BigNumber;
    let totalSupplyBase: BigNumber;
    let totalBorrowBase: BigNumber;
    let expectedUsdValue: bigint;
    let oldBalance: bigint;
    let oldPrincipal: bigint;
    let newPrincipal: bigint;
    let basePrice: BigNumber;
    let baseScale: BigNumber;
    let newBalance: bigint;

    before(async () => {
      const configuratorAndProtocol = await makeConfigurator({
        base: 'USDC',
        storeFrontPriceFactor: exp(0.8, 18),
        assets: {
          USDC: { initial: 1e6, decimals: 6, initialPrice: 1 },
          COMP: {
            initial: 1e7,
            decimals: 18,
            initialPrice: 200,
            liquidationFactor: exp(0.6, 18),
          },
        },
      });
      // Note: Always interact with the proxy address, we'll upgrade implementation later
      cometProxyAddress = configuratorAndProtocol.cometProxy.address;
      comet = configuratorAndProtocol.cometWithExtendedAssetList.attach(cometProxyAddress) as CometWithExtendedAssetList;
      configurator = configuratorAndProtocol.configurator;
      configuratorProxy = configuratorAndProtocol.configuratorProxy;
      proxyAdmin = configuratorAndProtocol.proxyAdmin;
      assetListFactoryAddress = configuratorAndProtocol.assetListFactory.address;
      comet = comet.attach(cometProxyAddress);

      // Tokens
      baseToken = configuratorAndProtocol.tokens.USDC;
      compToken = configuratorAndProtocol.tokens.COMP;

      compPriceFeed = configuratorAndProtocol.priceFeeds.COMP;

      alice = configuratorAndProtocol.users[0];
      bob = configuratorAndProtocol.users[1];

      // Allocate base token to comet
      await baseToken.allocateTo(comet.address, exp(1000, 6));

      // Supply COMP from Alice
      await compToken.allocateTo(alice.address, aliceCompSupply);
      await compToken.connect(alice).approve(comet.address, aliceCompSupply);
      await comet.connect(alice).supply(compToken.address, aliceCompSupply);

      // Borrow COMP from Alice
      await comet.connect(alice).withdraw(baseToken.address, exp(150, 6));

      // Drop COMP price from 200 to 100 to make Alice liquidatable
      await compPriceFeed.setRoundData(
        0, // roundId
        exp(100, 8), // answer
        0, // startedAt
        0, // updatedAt
        0 // answeredInRound
      );

      // Verify Alice is liquidatable
      expect(await comet.isLiquidatable(alice.address)).to.be.true;

      // Save data before absorption
      userCollateralBeforeAbsorption = (await comet.userCollateral(alice.address, compToken.address)).balance;
      totalsSupplyAssetBeforeAbsorption = (await comet.totalsCollateral(compToken.address)).totalSupplyAsset;

      configurator = configurator.attach(configuratorProxy.address);
      const CometExtAssetList = await (
        await ethers.getContractFactory('CometExtAssetList')
      ).deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('BASE'),
        },
        assetListFactoryAddress
      );
      await CometExtAssetList.deployed();
      await configurator.setExtensionDelegate(cometProxyAddress, CometExtAssetList.address);
      // 2) switch factory to CometFactoryWithExtendedAssetList
      const CometFactoryWithExtendedAssetList = await (await ethers.getContractFactory('CometFactoryWithExtendedAssetList')).deploy();
      await CometFactoryWithExtendedAssetList.deployed();
      await configurator.setFactory(cometProxyAddress, CometFactoryWithExtendedAssetList.address);

      /*//////////////////////////////////////////////////////////////
                            24 ASSETS COMET
      //////////////////////////////////////////////////////////////*/
      const collaterals = Object.fromEntries(
        Array.from({ length: MAX_ASSETS }, (_, j) => [
          `ASSET${j}`,
          {
            decimals: 18,
            initialPrice: 200,
          },
        ])
      );
      // Create protocol with configurator so we can update liquidationFactor later
      const configuratorAndProtocol24Assets = await makeConfigurator({ assets: { USDC: { decimals: 6, initialPrice: 1 }, ...collaterals }});
      comet24Assets = configuratorAndProtocol24Assets.cometWithExtendedAssetList.attach(configuratorAndProtocol24Assets.cometProxy.address) as CometWithExtendedAssetList;
      underwater24Assets = configuratorAndProtocol24Assets.users[0];
      absorber24Assets = configuratorAndProtocol24Assets.users[1];
      tokens24Assets = configuratorAndProtocol24Assets.tokens;
      priceFeeds24Assets = configuratorAndProtocol24Assets.priceFeeds;
      configuratorProxy24Assets = configuratorAndProtocol24Assets.configurator.attach(configuratorAndProtocol24Assets.configuratorProxy.address);
      proxyAdmin24Assets = configuratorAndProtocol24Assets.proxyAdmin;

      const CometExtAssetList24Assets = await (
        await ethers.getContractFactory('CometExtAssetList')
      ).deploy(
        {
          name32: ethers.utils.formatBytes32String('Compound Comet'),
          symbol32: ethers.utils.formatBytes32String('BASE'),
        },
        configuratorAndProtocol24Assets.assetListFactory.address
      );
      await CometExtAssetList24Assets.deployed();
      await configuratorProxy24Assets.setExtensionDelegate(configuratorAndProtocol24Assets.cometProxy.address, CometExtAssetList24Assets.address);
      await configuratorProxy24Assets.setFactory(configuratorAndProtocol24Assets.cometProxy.address, CometFactoryWithExtendedAssetList.address);
      await configuratorAndProtocol24Assets.proxyAdmin.deployAndUpgradeTo(configuratorAndProtocol24Assets.configuratorProxy.address, configuratorAndProtocol24Assets.cometProxy.address);

      baseToken24Assets = configuratorAndProtocol24Assets.tokens['USDC'];

      cometExt = (await ethers.getContractAt('CometExtAssetList', comet.address)) as CometExtAssetList;
      const totalBasics = await cometExt.totalsBasic();
      oldPrincipal = (await comet.userBasic(alice.address)).principal.toBigInt();
      totalSupplyBase = totalBasics.totalSupplyBase;
      totalBorrowBase = totalBasics.totalBorrowBase;
      oldBalance = presentValue(oldPrincipal, totalBasics.baseSupplyIndex, totalBasics.baseBorrowIndex);
      basePrice = await comet.getPrice(await comet.baseTokenPriceFeed());
      baseScale = await comet.baseScale();

      snapshot = await takeSnapshot();
    });

    describe('asset can be liquidated with positive liquidation collateral factor and liquidation factor', function () {
      /*
       * normal "active collateral" state.
       *
       * Key factor roles in absorption:
       *   - LCF > 0: the asset counts toward the account's liquidation threshold in isLiquidatable;
       *              its price is fetched and stored in assetPrices[i].
       *   - LF  > 0: absorbInternal seizes the collateral, reads assetPrices[i], and uses the
       *              USD value to offset the absorbed debt.
       *   - borrowCF: governs only isBorrowCollateralized (new-borrow gate); irrelevant to
       *               isLiquidatable and absorb.
       *
       * Flow:
       *    With LCF > 0 and LF > 0:
       *    - Collateral is seized: Alice's COMP collateral is transferred to protocol reserves
       *    - AbsorbCollateral event is emitted with the seized amount and its USD value
       *    - User collateral balance is set to 0
       *    - totalsCollateral.totalSupplyAsset is reduced to 0
       *    - User's assetsIn is reset to 0
       *    - User principal is updated by the USD value of the seized collateral
       *    - AbsorbDebt event is emitted with the base amount paid out to the absorber
       *    - Total borrow base is reduced by the repay amount
       *    - Transfer event is NOT emitted (new principal clamps to 0, no supply side created)
       */
      it('absorbs undercollateralized account', async () => {
        liquidationTx = await comet.connect(bob).absorb(bob.address, [alice.address]);

        expect(liquidationTx).to.not.be.reverted;
      });

      it('emits AbsorbCollateral event', async () => {
        const assetInfo = await comet.getAssetInfoByAddress(compToken.address);
        const [_, price] = await compPriceFeed.latestRoundData();
        expectedUsdValue = mulPrice(aliceCompSupply, price, assetInfo.scale);

        expect(liquidationTx).to.emit(comet, 'AbsorbCollateral').withArgs(bob.address, alice.address, compToken.address, aliceCompSupply, expectedUsdValue);
      });

      it('reduces totals supply of the asset for seized asset', async () => {
        const totals = await comet.totalsCollateral(compToken.address);
        expect(totals.totalSupplyAsset).to.equal(0);
      });

      it('sets user collateral balance to 0', async () => {
        expect((await comet.userCollateral(alice.address, compToken.address)).balance).to.equal(0);
      });

      it('reset user assetsIn to 0', async () => {
        expect((await comet.userBasic(alice.address)).assetsIn).to.equal(0);
        expect((await comet.userBasic(alice.address))._reserved).to.equal(0);
      });

      it('updates totals correctly after absorption', async () => {
        // Calculate expected totals
        const deltaBalance = divPrice(expectedUsdValue, basePrice, baseScale);
        const totalsBasic = await cometExt.totalsBasic();

        newBalance = oldBalance + deltaBalance;
        if (newBalance < 0) newBalance = 0n;
        newPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

        // Check that user principal is updated correctly
        expect((await comet.userBasic(alice.address)).principal).to.equal(newPrincipal);
        // Calculate repay and supply amounts
        // We expect that new principal is greater than old principal
        expect(newPrincipal > oldPrincipal).to.be.true;
        // New principal becomes zero as we check before, thus we go strongly in case `newPrincipal <= 0`
        expect(newPrincipal <= 0).to.be.true;
        const repayAmount = newPrincipal - oldPrincipal;
        const supplyAmount = 0n;

        const newTotalsBasic = await cometExt.totalsBasic();
        expect(newTotalsBasic.totalSupplyBase).to.equal(totalSupplyBase.toBigInt() + supplyAmount);
        expect(newTotalsBasic.totalBorrowBase).to.equal(totalBorrowBase.toBigInt() - repayAmount);
      });

      it('updates user principal correctly after absorption', async () => {
        expect((await comet.userBasic(alice.address)).principal).to.equal(newPrincipal);

        await snapshot.restore();
      });

      it('emits AbsorbDebt event', async () => {
        const basePaidOut = newBalance - oldBalance;
        const valueOfBasePaidOut = mulPrice(basePaidOut, basePrice, baseScale);
        expect(liquidationTx).to.emit(comet, 'AbsorbDebt').withArgs(bob.address, alice.address, basePaidOut, valueOfBasePaidOut);
      });

      it('Transfer event is not emitted', async () => {
        // Transfer event emits only when new principal is greater than 0
        expect(newPrincipal).to.equal(0);
        expect(liquidationTx).to.not.emit(comet, 'Transfer');
      });
    });

    describe('skips liquidation for asset with liquidationF = 0 and liquidateCF > 0', function () {
      /*
       * "soft de-list" state.
       *
       * Key factor roles in absorption:
       *   - LCF > 0: the asset still counts toward the account's liquidation threshold;
       *              its price is fetched and stored in assetPrices[i].
       *   - LF  = 0: absorbInternal skips seizure for this asset entirely — no collateral
       *              transfer, assetPrices[i] is not used to offset debt.
       *   - borrowCF: governs only isBorrowCollateralized (new-borrow gate); irrelevant to
       *               isLiquidatable and absorb.
       *
       * Flow:
       *    When LF = 0 and LCF still > 0:
       *    - Collateral is NOT seized: Alice's COMP collateral remains untouched
       *    - AbsorbCollateral event is NOT emitted (asset is skipped during absorption)
       *    - User collateral balance remains unchanged (same as before absorption)
       *    - totalsCollateral.totalSupplyAsset remains unchanged
       *    - User principal is still updated (debt is absorbed, but no collateral value is applied)
       *    - AbsorbDebt event is still emitted (debt absorption occurs, but with 0 base paid out)
       *    - Total borrow base is still reduced (debt is repaid)
       *    - Transfer event is NOT emitted (since new principal becomes 0)
       */
      it('liquidation factor can be updated to 0', async () => {
        await configurator.updateAssetLiquidationFactor(cometProxyAddress, compToken.address, exp(0, 18));
        await proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxyAddress);
      });

      it('liquidation factor becomes 0 after upgrade', async () => {
        expect((await comet.getAssetInfoByAddress(compToken.address)).liquidationFactor).to.equal(0);
      });

      it('absorbs undercollateralized account with 0 liquidation factor on asset', async () => {
        liquidationTx = await comet.connect(bob).absorb(bob.address, [alice.address]);

        expect(liquidationTx).to.not.be.reverted;
      });

      it('does not emit AbsorbCollateral event', async () => {
        expect(liquidationTx).to.not.emit(comet, 'AbsorbCollateral');
      });

      it('does not affect user collateral balance', async () => {
        expect((await comet.userCollateral(alice.address, compToken.address)).balance).to.equal(userCollateralBeforeAbsorption);
      });

      it('does not affect totals supply of the asset', async () => {
        expect((await comet.totalsCollateral(compToken.address)).totalSupplyAsset).to.equal(totalsSupplyAssetBeforeAbsorption);
      });

      it('updates totals correctly after absorption', async () => {
        // Expected USD value is 0 because of skipping absorption of the asset
        expectedUsdValue = 0n;

        // Calculate expected totals
        const deltaBalance = divPrice(expectedUsdValue, basePrice, baseScale);
        const totalsBasic = await cometExt.totalsBasic();

        let newBalance = oldBalance + deltaBalance;
        if (newBalance < 0) newBalance = 0n;
        newPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

        // Check that user principal is updated correctly
        expect((await comet.userBasic(alice.address)).principal).to.equal(newPrincipal);
        // Calculate repay and supply amounts
        // We expect that new principal is greater than old principal
        expect(newPrincipal > oldPrincipal).to.be.true;
        // New principal becomes zero as we check before, thus we go strongly in case `newPrincipal <= 0`
        expect(newPrincipal <= 0).to.be.true;
        const repayAmount = newPrincipal - oldPrincipal;
        const supplyAmount = 0n;

        const newTotalsBasic = await cometExt.totalsBasic();
        expect(newTotalsBasic.totalSupplyBase).to.equal(totalSupplyBase.toBigInt() + supplyAmount);
        expect(newTotalsBasic.totalBorrowBase).to.equal(totalBorrowBase.toBigInt() - repayAmount);
      });

      it('updates user principal correctly after absorption', async () => {
        expect((await comet.userBasic(alice.address)).principal).to.equal(newPrincipal);
      });

      it('emits AbsorbDebt event', async () => {
        const basePaidOut = newBalance - oldBalance;
        const valueOfBasePaidOut = mulPrice(basePaidOut, basePrice, baseScale);
        expect(liquidationTx).to.emit(comet, 'AbsorbDebt').withArgs(bob.address, alice.address, basePaidOut, valueOfBasePaidOut);
      });

      it('Transfer event is not emitted', async () => {
        // Transfer event emits only when new principal is greater than 0
        expect(newPrincipal).to.equal(0);
        expect(liquidationTx).to.not.emit(comet, 'Transfer');
      });
    });

    describe('asset abosorbs with zero value when liquidateCF > 0 and liquidationF is positive', function () {
      /*
       * the collateral is still seizable but treated as worthless.
       *
       * Key factor roles in absorption:
       *   - LCF = 0: isLiquidatableInternal skips price fetching for this asset,
       *              so assetPrices[i] stays 0; the asset contributes no coverage.
       *   - LF  > 0: absorbInternal seizes the collateral but uses assetPrices[i] = 0 —
       *              the collateral moves to reserves with zero USD value offset.
       *   - borrowCF: governs only isBorrowCollateralized (new-borrow gate); irrelevant to
       *               isLiquidatable and absorb.
       *
       * Flow:
       *    When LCF = 0 and LF > 0:
       *    - Collateral IS seized: Alice's COMP collateral is transferred to protocol reserves
       *    - AbsorbCollateral event IS emitted but with usdValue = 0 (assetPrices[i] = 0 since
       *      isLiquidatableInternal skipped price fetching for this LCF = 0 asset)
       *    - User collateral balance is set to 0
       *    - totalsCollateral.totalSupplyAsset is reduced to 0
       *    - User's assetsIn is reset to 0
       *    - User principal is not offset by collateral value — deltaBalance = 0, full debt remains
       *    - New balance is clamped to 0; debt is fully absorbed by protocol reserves
       *    - AbsorbDebt event is emitted (full debt absorbed by reserves)
       *    - Total borrow base is reduced by the repay amount
       *    - Transfer event is NOT emitted (new principal clamps to 0, no supply side created)
       *    - Comet ERC20 collateral balance is unchanged (tokens stay locked in comet)
       *    - Collateral reserves increase by the seized amount
       */
      let cometBaseTokenBalanceBefore: BigNumber;
      let cometCompBalanceBefore: BigNumber;
      let cometCompReservesBefore: BigNumber;
      let computedDeltaBalance: bigint;
      let computedNewBalance: bigint;
      let computedRepayAmount: bigint;

      before(async () => {
        await snapshot.restore();
        cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
        cometCompBalanceBefore = await compToken.balanceOf(comet.address);
        cometCompReservesBefore = await comet.getCollateralReserves(compToken.address);
      });

      it('borrowCollateralFactor and liquidateCollateralFactor updated to 0', async () => {
        await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, compToken.address, 0n);
        await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, compToken.address, 0n);
        await proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxyAddress);
      });

      it('liquidateCollateralFactor is 0 after upgrade', async () => {
        expect((await comet.getAssetInfoByAddress(compToken.address)).liquidateCollateralFactor).to.equal(0);
      });

      it('liquidationFactor remains non-zero after upgrade', async () => {
        expect((await comet.getAssetInfoByAddress(compToken.address)).liquidationFactor).to.be.gt(0);
      });

      it('alice is liquidatable with zero liquidateCollateralFactor', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.be.true;
      });

      it('absorbs undercollateralized account', async () => {
        liquidationTx = await comet.connect(bob).absorb(bob.address, [alice.address]);
        expect(liquidationTx).to.not.be.reverted;
      });

      it('emits AbsorbCollateral event with usdValue of 0', async () => {
        // assetPrices[i] stays 0 because isLiquidatableInternal skips LCF=0 assets before calling getPrice()
        // value = mulPrice(seizeAmount, 0, scale) = 0
        expect(liquidationTx).to.emit(comet, 'AbsorbCollateral').withArgs(bob.address, alice.address, compToken.address, aliceCompSupply, 0n);
      });

      it('reduces totals supply of the asset for seized asset', async () => {
        const totals = await comet.totalsCollateral(compToken.address);
        expect(totals.totalSupplyAsset).to.equal(0);
      });

      it('sets user collateral balance to 0', async () => {
        expect((await comet.userCollateral(alice.address, compToken.address)).balance).to.equal(0);
      });

      it('resets user assetsIn to 0', async () => {
        expect((await comet.userBasic(alice.address)).assetsIn).to.equal(0);
        expect((await comet.userBasic(alice.address))._reserved).to.equal(0);
      });

      it('deltaBalance is 0 when deltaValue is 0', () => {
        // assetPrices[i] = 0 for LCF = 0 assets → deltaValue = 0 → deltaBalance = divPrice(0, price, scale) = 0
        computedDeltaBalance = divPrice(0n, basePrice, baseScale);
        expect(computedDeltaBalance).to.equal(0n);
      });

      it('new balance is clamped to 0 from the negative old borrow balance', () => {
        // oldBalance < 0, deltaBalance = 0 → unclamped = oldBalance (still negative) → clamped to 0
        const unclamped = oldBalance + computedDeltaBalance;
        expect(unclamped < 0).to.be.true;
        computedNewBalance = 0n;
      });

      it('new principal is 0 and matches stored principal', async () => {
        const totalsBasic = await cometExt.totalsBasic();
        newPrincipal = principalValue(computedNewBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
        expect(newPrincipal).to.equal(0n);
        expect((await comet.userBasic(alice.address)).principal).to.equal(0n);
      });

      it('repay amount equals the absorbed borrow', () => {
        // repayAmount = newPrincipal - oldPrincipal = 0 - oldPrincipal = -oldPrincipal > 0
        computedRepayAmount = newPrincipal - oldPrincipal;
        expect(computedRepayAmount > 0n).to.be.true;
      });

      it('supply amount is 0 since new principal does not exceed 0', () => {
        // supplyAmount = 0 when newPrincipal <= 0 (see repayAndSupplyAmount)
        expect(newPrincipal <= 0n).to.be.true;
      });

      it('totalSupplyBase is unchanged after absorption', async () => {
        const current = await cometExt.totalsBasic();
        expect(current.totalSupplyBase).to.equal(totalSupplyBase);
      });

      it('totalBorrowBase is reduced by repay amount after absorption', async () => {
        const current = await cometExt.totalsBasic();
        expect(current.totalBorrowBase).to.equal(totalBorrowBase.toBigInt() - computedRepayAmount);
      });

      it('emits AbsorbDebt event', async () => {
        // basePaidOut = computedNewBalance - oldBalance = 0 - oldBalance = -oldBalance (full debt absorbed by reserves)
        const basePaidOut = computedNewBalance - oldBalance;
        const valueOfBasePaidOut = mulPrice(basePaidOut, basePrice, baseScale);
        expect(liquidationTx).to.emit(comet, 'AbsorbDebt').withArgs(bob.address, alice.address, basePaidOut, valueOfBasePaidOut);
      });

      it('Transfer event is not emitted', async () => {
        expect(liquidationTx).to.not.emit(comet, 'Transfer');
      });

      it('comet base token ERC20 balance is unchanged after absorption', async () => {
        // absorb does not transfer base tokens; debt absorption is an accounting change only
        expect(await baseToken.balanceOf(comet.address)).to.equal(cometBaseTokenBalanceBefore);
      });

      it('comet collateral token ERC20 balance is unchanged after absorption', async () => {
        // seized tokens remain locked in the comet contract; they are reclassified to reserves, not transferred out
        expect(await compToken.balanceOf(comet.address)).to.equal(cometCompBalanceBefore);
      });

      it('comet collateral reserves increase by the seized amount', async () => {
        // getCollateralReserves = balanceOf(comet) - totalsCollateral.totalSupplyAsset
        // after seizure: totalSupplyAsset = 0, balanceOf unchanged → reserves grow by aliceCompSupply
        expect(await comet.getCollateralReserves(compToken.address)).to.equal(cometCompReservesBefore.add(aliceCompSupply));
      });
    });

    describe('asset ignored during absorption when liquidateCF = 0 and liquidationF = 0', function () {
      /*
       * Full de-listing: both liquidateCF and liquidationFactor are zero.
       *
       * Key factor roles in absorption (borrowCollateralFactor plays no role here):
       *   - LCF = 0: the asset contributes no coverage; isLiquidatableInternal skips price
       *              fetching, so assetPrices[i] stays 0.
       *   - LF  = 0: absorbInternal skips seizure entirely — no price lookup, no collateral
       *              transfer; the balance remains in the user's protocol account.
       *   - borrowCF: governs only isBorrowCollateralized (new-borrow gate); irrelevant to
       *               isLiquidatable and absorb.
       *
       * Flow:
       *    When LCF = 0 and LF = 0:
       *    - Collateral is NOT seized: Alice's COMP collateral remains in the user's protocol account
       *    - AbsorbCollateral event is NOT emitted (asset is skipped entirely during absorption)
       *    - User collateral balance remains unchanged (same as before absorption)
       *    - totalsCollateral.totalSupplyAsset remains unchanged
       *    - User's assetsIn is reset to 0 even though collateral was not seized
       *    - User principal is not offset by collateral value — deltaBalance = 0, full debt remains
       *    - New balance is clamped to 0; debt is fully absorbed by protocol reserves
       *    - AbsorbDebt event is emitted (full debt absorbed by reserves)
       *    - Total borrow base is reduced by the repay amount
       *    - Transfer event is NOT emitted (new principal clamps to 0, no supply side created)
       *    - Comet ERC20 collateral balance is unchanged (tokens stay locked in comet)
       *    - Collateral reserves unchanged (no seizure occurred)
       */
      let cometBaseTokenBalanceBefore: BigNumber;
      let cometCompBalanceBefore: BigNumber;
      let cometCompReservesBefore: BigNumber;
      let computedDeltaBalance: bigint;
      let computedNewBalance: bigint;
      let computedRepayAmount: bigint;

      before(async () => {
        await snapshot.restore();
        cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
        cometCompBalanceBefore = await compToken.balanceOf(comet.address);
        cometCompReservesBefore = await comet.getCollateralReserves(compToken.address);
      });

      it('borrowCollateralFactor, liquidateCollateralFactor and liquidationFactor can be updated to 0', async () => {
        await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, compToken.address, 0n);
        await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, compToken.address, 0n);
        await configurator.updateAssetLiquidationFactor(cometProxyAddress, compToken.address, 0n);
        await proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxyAddress);
      });

      it('liquidateCollateralFactor is 0 after upgrade', async () => {
        expect((await comet.getAssetInfoByAddress(compToken.address)).liquidateCollateralFactor).to.equal(0);
      });

      it('liquidationFactor is 0 after upgrade', async () => {
        expect((await comet.getAssetInfoByAddress(compToken.address)).liquidationFactor).to.equal(0);
      });

      it('alice is liquidatable with zero liquidateCollateralFactor and zero liquidationFactor', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.be.true;
      });

      it('absorbs is successful', async () => {
        liquidationTx = await comet.connect(bob).absorb(bob.address, [alice.address]);
        expect(liquidationTx).to.not.be.reverted;
      });

      it('does not emit AbsorbCollateral event', async () => {
        expect(liquidationTx).to.not.emit(comet, 'AbsorbCollateral');
      });

      it('does not affect user collateral balance', async () => {
        expect((await comet.userCollateral(alice.address, compToken.address)).balance).to.equal(userCollateralBeforeAbsorption);
      });

      it('does not affect totals supply of the asset', async () => {
        expect((await comet.totalsCollateral(compToken.address)).totalSupplyAsset).to.equal(totalsSupplyAssetBeforeAbsorption);
      });

      it('resets user assetsIn to 0 even though collateral was not seized', async () => {
        // absorbInternal always resets assetsIn regardless of liquidationFactor
        expect((await comet.userBasic(alice.address)).assetsIn).to.equal(0);
        expect((await comet.userBasic(alice.address))._reserved).to.equal(0);
      });

      it('deltaBalance is 0 when deltaValue is 0', () => {
        // asset skipped in absorbInternal (LF = 0) → deltaValue = 0 → deltaBalance = divPrice(0, price, scale) = 0
        computedDeltaBalance = divPrice(0n, basePrice, baseScale);
        expect(computedDeltaBalance).to.equal(0n);
      });

      it('new balance is clamped to 0 from the negative old borrow balance', () => {
        // oldBalance < 0, deltaBalance = 0 → unclamped = oldBalance (still negative) → clamped to 0
        const unclamped = oldBalance + computedDeltaBalance;
        expect(unclamped < 0).to.be.true;
        computedNewBalance = 0n;
      });

      it('new principal is 0 and matches stored principal', async () => {
        const totalsBasic = await cometExt.totalsBasic();
        newPrincipal = principalValue(computedNewBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
        expect(newPrincipal).to.equal(0n);
        expect((await comet.userBasic(alice.address)).principal).to.equal(0n);
      });

      it('repay amount equals the absorbed borrow', () => {
        // repayAmount = newPrincipal - oldPrincipal = 0 - oldPrincipal = -oldPrincipal > 0
        computedRepayAmount = newPrincipal - oldPrincipal;
        expect(computedRepayAmount > 0n).to.be.true;
      });

      it('supply amount is 0 since new principal does not exceed 0', () => {
        // supplyAmount = 0 when newPrincipal <= 0 (see repayAndSupplyAmount)
        expect(newPrincipal <= 0n).to.be.true;
      });

      it('totalSupplyBase is unchanged after absorption', async () => {
        const current = await cometExt.totalsBasic();
        expect(current.totalSupplyBase).to.equal(totalSupplyBase);
      });

      it('totalBorrowBase is reduced by repay amount after absorption', async () => {
        const current = await cometExt.totalsBasic();
        expect(current.totalBorrowBase).to.equal(totalBorrowBase.toBigInt() - computedRepayAmount);
      });

      it('emits AbsorbDebt event', async () => {
        // basePaidOut = computedNewBalance - oldBalance = 0 - oldBalance = -oldBalance (full debt absorbed by reserves)
        const basePaidOut = computedNewBalance - oldBalance;
        const valueOfBasePaidOut = mulPrice(basePaidOut, basePrice, baseScale);
        expect(liquidationTx).to.emit(comet, 'AbsorbDebt').withArgs(bob.address, alice.address, basePaidOut, valueOfBasePaidOut);
      });

      it('Transfer event is not emitted', async () => {
        expect(liquidationTx).to.not.emit(comet, 'Transfer');
      });

      it('comet base token ERC20 balance is unchanged after absorption', async () => {
        // absorb does not transfer base tokens; debt absorption is an accounting change only
        expect(await baseToken.balanceOf(comet.address)).to.equal(cometBaseTokenBalanceBefore);
      });

      it('comet collateral token ERC20 balance is unchanged after absorption', async () => {
        // collateral was not seized; tokens remain in the protocol account, still locked in comet
        expect(await compToken.balanceOf(comet.address)).to.equal(cometCompBalanceBefore);
      });

      it('comet collateral reserves are unchanged after absorption', async () => {
        // no seizure occurred; getCollateralReserves = balanceOf(comet) - totalSupplyAsset remains the same
        expect(await comet.getCollateralReserves(compToken.address)).to.equal(cometCompReservesBefore);
      });
    });

    describe('24 collateral assets', function () {
      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`skips absorption of asset ${i - 1} with liquidation factor = 0 with collaterals ${i}`, async () => {
        /**
         * This parameterized test verifies that absorb skips assets with liquidation factor = 0.
         * For each iteration (i = 1 to 24), it tests asset i-1 in a protocol with i total collaterals.
         * The test: (1) supplies collateral and borrows to make the account liquidatable,
         * (2) sets the target asset's liquidation factor to 0, (3) calls absorb, and
         * (4) verifies that the target asset is skipped (user collateral balance and totalsCollateral totalSupplyAsset remain unchanged).
         */

          const targetSymbol = `ASSET${i - 1}`;
          const targetToken = tokens24Assets[targetSymbol];

          // Supply, borrow, and make liquidatable
          const supplyAmount = exp(1, 18);
          await targetToken.allocateTo(underwater24Assets.address, supplyAmount);
          await targetToken.connect(underwater24Assets).approve(comet24Assets.address, supplyAmount);
          await comet24Assets.connect(underwater24Assets).supply(targetToken.address, supplyAmount);

          const borrowAmount = exp(150, 6);
          await baseToken24Assets.allocateTo(comet24Assets.address, borrowAmount);
          await comet24Assets.connect(underwater24Assets).withdraw(baseToken24Assets.address, borrowAmount);

          // Drop price of token to make liquidatable
          await priceFeeds24Assets[targetSymbol].setRoundData(0, 100, 0, 0, 0);

          expect(await comet24Assets.isLiquidatable(underwater24Assets.address)).to.be.true;

          // Step 3: Update liquidationFactor to 0 for target asset
          await configuratorProxy24Assets.updateAssetLiquidationFactor(comet24Assets.address, targetToken.address, exp(0, 18));

          // Upgrade proxy again after updating liquidationFactor
          await proxyAdmin24Assets.deployAndUpgradeTo(configuratorProxy24Assets.address, comet24Assets.address);

          // Verify liquidationFactor is 0
          expect((await comet24Assets.getAssetInfoByAddress(targetToken.address)).liquidationFactor).to.equal(0);

          // Step 4: Save balances before absorb
          const userCollateralBefore = (await comet24Assets.userCollateral(underwater24Assets.address, targetToken.address)).balance;
          const totalsBefore = (await comet24Assets.totalsCollateral(targetToken.address)).totalSupplyAsset;

          expect(userCollateralBefore).to.equal(supplyAmount);
          expect(totalsBefore).to.equal(supplyAmount);

          // Step 5: Absorb should skip this asset (no seizure) and balances remain unchanged
          await comet24Assets.connect(absorber24Assets).absorb(absorber24Assets.address, [underwater24Assets.address]);

          // Verify balances remain unchanged
          expect((await comet24Assets.userCollateral(underwater24Assets.address, targetToken.address)).balance).to.equal(userCollateralBefore);
          expect((await comet24Assets.totalsCollateral(targetToken.address)).totalSupplyAsset).to.equal(totalsBefore);
        });
      }
    });

    describe('edge cases', function () {
      it('absorbs with mixed liquidation factors and skips zeroed assets', async () => {
        /**
         * This test checks that when there are five collateral assets with mixed liquidation factors,
         * the absorb function only seizes (liquidates) those assets whose liquidationFactor is nonzero,
         * and skips assets whose liquidationFactor is zero (leaving their balances unchanged after absorb).
         * It sets up the protocol, configures various assets, updates some to have zero liquidation factor,
         * and verifies that 'absorb' seizes only the correct collateral, without affecting those set to be skipped.
         */
  
        await snapshot.restore();
  
        // Supply, borrow, and make liquidatable
        const supplyAmount = exp(1, 18);
        const targetSymbols = ['ASSET0', 'ASSET1', 'ASSET2', 'ASSET3', 'ASSET4'];
        for (const sym of targetSymbols) {
          const token = tokens24Assets[sym];
          await token.allocateTo(underwater24Assets.address, supplyAmount);
          await token.connect(underwater24Assets).approve(comet24Assets.address, supplyAmount);
          await comet24Assets.connect(underwater24Assets).supply(token.address, supplyAmount);
        }
  
        const borrowAmount = exp(500, 6);
        await baseToken24Assets.allocateTo(comet24Assets.address, borrowAmount);
        await comet24Assets.connect(underwater24Assets).withdraw(baseToken24Assets.address, borrowAmount);
  
        // Drop price of all tokens to make liquidatable
        for (const sym of targetSymbols) {
          await priceFeeds24Assets[sym].setRoundData(0, 100, 0, 0, 0);
        }
  
        expect(await comet24Assets.isLiquidatable(underwater24Assets.address)).to.be.true;
  
        // Update liquidationFactor to 0 for three assets (ASSET1, ASSET3, ASSET4)
        const zeroLfSymbols = ['ASSET1', 'ASSET3', 'ASSET4'];
        for (const sym of zeroLfSymbols) {
          await configuratorProxy24Assets.updateAssetLiquidationFactor(comet24Assets.address, tokens24Assets[sym].address, exp(0, 18));
        }
  
        // Upgrade proxy again after updating liquidationFactor
        await proxyAdmin24Assets.deployAndUpgradeTo(configuratorProxy24Assets.address, comet24Assets.address);
  
        // Save balances before absorb for two categories
        // - Should be seized: ASSET0, ASSET2
        // - Should be skipped (unchanged): ASSET1, ASSET3, ASSET4
        const userBefore: Record<string, BigNumber> = {} as any;
        const totalsBefore: Record<string, BigNumber> = {} as any;
        for (const sym of ['ASSET0', 'ASSET1', 'ASSET2', 'ASSET3', 'ASSET4']) {
          userBefore[sym] = (await comet24Assets.userCollateral(underwater24Assets.address, tokens24Assets[sym].address)).balance;
          totalsBefore[sym] = (await comet24Assets.totalsCollateral(tokens24Assets[sym].address)).totalSupplyAsset;
          expect(userBefore[sym]).to.equal(supplyAmount);
          expect(totalsBefore[sym]).to.equal(supplyAmount);
        }
  
        // Absorb - should skip assets with LF = 0
        await comet24Assets.connect(absorber24Assets).absorb(absorber24Assets.address, [underwater24Assets.address]);
  
        // Verify skipped assets remain unchanged
        for (const sym of ['ASSET1', 'ASSET3', 'ASSET4']) {
          expect((await comet24Assets.userCollateral(underwater24Assets.address, tokens24Assets[sym].address)).balance).to.equal(userBefore[sym]);
          expect((await comet24Assets.totalsCollateral(tokens24Assets[sym].address)).totalSupplyAsset).to.equal(totalsBefore[sym]);
        }
  
        // Verify seized assets set user balance to 0 and reduce totals
        for (const sym of ['ASSET0', 'ASSET2']) {
          expect((await comet24Assets.userCollateral(underwater24Assets.address, tokens24Assets[sym].address)).balance).to.equal(0);
          expect((await comet24Assets.totalsCollateral(tokens24Assets[sym].address)).totalSupplyAsset).to.equal(0);
        }
      });
    });

    describe('revert on price feed side', function () {
      /*
       * This test suite reproduces the "price feed paralysis" edge case on top of the
       * Comet/Configurator deployment and user positions that are already set up in the
       * outer `before` block.
       *
       * At the point we enter this `describe`, Alice already has a borrow position that is
       * liquidatable under normal (non-reverting) price feeds; this suite does NOT open that
       * position, it just reuses it.
       *
       * The tests then walk through the problematic sequence:
       * 1. Assert that Alice is liquidatable with the normal COMP price feed.
       * 2. Have governance update COMP's price feed to `PriceFeedWithRevert`, which always
       *    reverts on `latestRoundData`, and verify that the feed address on Comet changed.
       * 3. Show that any call that needs the COMP price (`isLiquidatable`, `isBorrowCollateralized`,
       *    or `absorb`) now reverts with the `Reverted` custom error, effectively freezing
       *    liquidations for that collateral.
       * 4. Finally, revert the price feed back to the normal implementation and verify that
       *    the same calls succeed again, demonstrating that the paralysis is solely due to
       *    the reverting price feed.
       *
       * Each `it` in this `describe` advances the shared state one step on top of the common
       * baseline snapshot: from "liquidatable and working normally" → "paralyzed by a reverting
       * price feed" → "recovered after restoring a healthy feed".
       */
      let priceFeedWithRevert: PriceFeedWithRevert;
      before(async () => {
        // Start from the common baseline state for this suite
        await snapshot.restore();

        const PriceFeedWithRevert = await ethers.getContractFactory('PriceFeedWithRevert') as PriceFeedWithRevert__factory;
        priceFeedWithRevert = await PriceFeedWithRevert.deploy(100, 8);
        await priceFeedWithRevert.deployed();
      });

      it('alice is liquidable', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.be.true;
      });

      it('governance updates price feed to reverting implementation', async () => {
        await configurator.updateAssetPriceFeed(cometProxyAddress, compToken.address, priceFeedWithRevert.address);
        await proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxyAddress);
      });

      it('price feed updated to reverting implementation', async () => {
        expect((await comet.getAssetInfoByAddress(compToken.address)).priceFeed).to.equal(priceFeedWithRevert.address);
      });

      it('isLiquidatable now reverts due to reverting price feed', async () => {
        await expect(comet.isLiquidatable(alice.address)).to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
      });

      it('isBorrowCollateralized now reverts due to reverting price feed', async () => {
        await expect(comet.isBorrowCollateralized(alice.address)).to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
      });

      it('absorb reverts when collateral price cannot be fetched', async () => {
        await expect(
          comet.connect(bob).absorb(bob.address, [alice.address])
        ).to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
      });

      it('governance updates price feed to normal implementation', async () => {
        await configurator.updateAssetPriceFeed(cometProxyAddress, compToken.address, compPriceFeed.address);
        await proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxyAddress);
      });

      it('price feed updated to normal implementation', async () => {
        expect((await comet.getAssetInfoByAddress(compToken.address)).priceFeed).to.equal(compPriceFeed.address);
      });

      it('isLiquidatable now does not revert', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.not.be.reverted;
      });

      it('isBorrowCollateralized now does not revert', async () => {
        expect(await comet.isBorrowCollateralized(alice.address)).to.not.be.reverted;
      });

      it('absorb does not revert', async () => {
        await expect(comet.connect(bob).absorb(bob.address, [alice.address])).to.not.be.reverted;
      });
    });
  });
});
