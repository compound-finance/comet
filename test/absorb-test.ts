import { Comet, ethers, expect, exp, factor, defaultAssets, makeProtocol, portfolio, wait } from './helpers';

describe('absorb', function () {
  it('reverts if total borrows underflows', async () => {
    const { comet, users: [absorber, underwater] } = await makeProtocol();

    const f0 = await comet.setBasePrincipal(underwater.address, -100);
    await expect(comet.absorb(absorber.address, [underwater.address])).to.be.revertedWith('code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
  });

  it('absorbs 1 account and pays out the absorber', async () => {
    const params = {
      interestRateBase: 0,
      interestRateSlopeLow: 0,
      interestRateSlopeHigh: 0,
    };
    const protocol = await makeProtocol(params);
    const { comet, users: [absorber, underwater] } = protocol;

    const t0 = Object.assign({}, await comet.totalsBasic(), {
      totalBorrowBase: 100n,
    });
    await wait(comet.setTotalsBasic(t0));

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

    expect(pA0.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU0.internal).to.be.deep.equal({COMP: 0n, USDC: -100n, WBTC: 0n, WETH: 0n});
    expect(pU0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});

    expect(pA1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});

    expect(lA1.numAbsorbs).to.be.equal(1);
    expect(lA1.numAbsorbed).to.be.equal(1);
    //expect(lA1.approxSpend).to.be.equal(1672498842684n);
    expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));

    expect(lU1.numAbsorbs).to.be.equal(0);
    expect(lU1.numAbsorbed).to.be.equal(0);
    expect(lU1.approxSpend).to.be.equal(0);
  });

  it('absorbs 2 accounts and pays out the absorber', async () => {
    const params = {
      interestRateBase: 0,
      interestRateSlopeLow: 0,
      interestRateSlopeHigh: 0,
    };
    const protocol = await makeProtocol(params);
    const { comet, users: [absorber, underwater1, underwater2] } = protocol;

    const t0 = Object.assign({}, await comet.totalsBasic(), {
      totalBorrowBase: 2000n,
    });
    await wait(comet.setTotalsBasic(t0));

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
    const lU1_1 = await comet.liquidatorPoints(underwater1.address);
    const lU2_1 = await comet.liquidatorPoints(underwater2.address);

    expect(r0).to.be.equal(2000);

    expect(t1.totalSupplyBase).to.be.equal(0n);
    expect(t1.totalBorrowBase).to.be.equal(1200n);
    expect(r1).to.be.equal(1200);

    expect(pA0.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU1_0.internal).to.be.deep.equal({COMP: 0n, USDC: -100n, WBTC: 0n, WETH: 0n});
    expect(pU1_0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU2_0.internal).to.be.deep.equal({COMP: 0n, USDC: -700n, WBTC: 0n, WETH: 0n});
    expect(pU2_0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});

    expect(pA1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU1_1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU1_1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU2_1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU2_1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});

    expect(lA1.numAbsorbs).to.be.equal(1);
    expect(lA1.numAbsorbed).to.be.equal(2);
    //expect(lA1.approxSpend).to.be.equal(459757131288n);
    expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));
  });

  it('absorbs 3 accounts with collateral and pays out the absorber', async () => {
    const params = {
      interestRateBase: 0,
      interestRateSlopeLow: 0,
      interestRateSlopeHigh: 0,
    };
    const protocol = await makeProtocol(params);
    const { comet, tokens, users: [absorber, underwater1, underwater2, underwater3] } = protocol;
    const { COMP, USDC, WBTC, WETH } = tokens;

    const t0 = Object.assign({}, await comet.totalsBasic(), {
      totalBorrowBase: exp(3e15, 6),
      totalSupplyBase: exp(4e15, 6),
    });
    await wait(comet.setTotalsBasic(t0));

    const r0 = await comet.getReserves();

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

    const a0 = await wait(comet.absorb(absorber.address, [underwater1.address, underwater2.address, underwater3.address]));

    const t1 = await comet.totalsBasic();
    const r1 = await comet.getReserves();

    const pP1 = await portfolio(protocol, comet.address);
    const pA1 = await portfolio(protocol, absorber.address);
    const pU1_1 = await portfolio(protocol, underwater1.address);
    const pU2_1 = await portfolio(protocol, underwater2.address);
    const pU3_1 = await portfolio(protocol, underwater3.address);
    const lA1 = await comet.liquidatorPoints(absorber.address);
    const lU1_1 = await comet.liquidatorPoints(underwater1.address);
    const lU2_1 = await comet.liquidatorPoints(underwater2.address);
    const lU3_1 = await comet.liquidatorPoints(underwater3.address);

    expect(r0).to.be.equal(-exp(1e15, 6));

    expect(t1.totalSupplyBase).to.be.equal(exp(4e15, 6));
    expect(t1.totalBorrowBase).to.be.equal(exp(3e15, 6) - exp(1, 18) - exp(1, 12) - exp(1, 6));
    expect(r1).to.be.equal(-exp(1e15, 6) - exp(1, 6) - exp(1, 12) - exp(1, 18));

    expect(pP0.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pP0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA0.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU1_0.internal).to.be.deep.equal({COMP: exp(1, 12), USDC: -exp(1, 6), WBTC: 0n, WETH: 0n});
    expect(pU1_0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU2_0.internal).to.be.deep.equal({COMP: exp(10, 18), USDC: -exp(1, 12), WBTC: 0n, WETH: exp(1, 18)});
    expect(pU2_0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU3_0.internal).to.be.deep.equal({COMP: exp(10000, 18), USDC: -exp(1, 18), WBTC: exp(50, 8), WETH: exp(50, 18)});
    expect(pU3_0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});

    expect(pP1.internal).to.be.deep.equal({
      COMP: exp(1, 12) + exp(10, 18) + exp(10000, 18),
      USDC: 0n,
      WBTC: exp(50, 8),
      WETH: exp(1, 18) + exp(50, 18)
    });
    expect(pP1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU1_1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU1_1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU2_1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU2_1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU3_1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU3_1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});

    expect(lA1.numAbsorbs).to.be.equal(1);
    expect(lA1.numAbsorbed).to.be.equal(3);
    //expect(lA1.approxSpend).to.be.equal(130651238630n);
    expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));
  });

  it('absorbs an account with more than enough collateral to still cover debt', async () => {
    const params = {
      interestRateBase: 0,
      interestRateSlopeLow: 0,
      interestRateSlopeHigh: 0,
      assets: defaultAssets({
        borrowCF: factor(1/2),
        liquidateCF: factor(2/3),
      })
    };
    const protocol = await makeProtocol(params);
    const { comet, tokens, users: [absorber, underwater] } = protocol;
    const { COMP, USDC, WBTC, WETH } = tokens;

    const debt = 1n - (exp(41000, 6) + exp(3000, 6) + exp(175, 6));
    const t0 = Object.assign({}, await comet.totalsBasic(), {
      totalBorrowBase: -debt,
    });
    await wait(comet.setTotalsBasic(t0));

    const r0 = await comet.getReserves();

    await comet.setBasePrincipal(underwater.address, debt);
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
    const lU1 = await comet.liquidatorPoints(underwater.address);

    expect(r0).to.be.equal(-debt);
    expect(t1.totalSupplyBase).to.be.equal(1);
    expect(t1.totalBorrowBase).to.be.equal(0);
    expect(r1).to.be.equal(-1);

    expect(pP0.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pP0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA0.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU0.internal).to.be.deep.equal({COMP: exp(1, 18), USDC: debt, WBTC: exp(1, 8), WETH: exp(1, 18)});
    expect(pU0.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});

    expect(pP1.internal).to.be.deep.equal({COMP: exp(1, 18), USDC: 0n, WBTC: exp(1, 8), WETH: exp(1, 18)});
    expect(pP1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA1.internal).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pA1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});
    expect(pU1.internal).to.be.deep.equal({COMP: 0n, USDC: 1n, WBTC: 0n, WETH: 0n});
    expect(pU1.external).to.be.deep.equal({COMP: 0n, USDC: 0n, WBTC: 0n, WETH: 0n});

    expect(lA1.numAbsorbs).to.be.equal(1);
    expect(lA1.numAbsorbed).to.be.equal(1);
    //expect(lA1.approxSpend).to.be.equal(1672498842684n);
    expect(lA1.approxSpend).to.be.lt(a0.receipt.gasUsed.mul(a0.receipt.effectiveGasPrice));
  });

  it('reverts if an account is not underwater', async () => {
    const { comet, users: [alice, bob] } = await makeProtocol();

    await expect(comet.absorb(alice.address, [bob.address])).to.be.revertedWith("account is not underwater");
  });

  it.skip('reverts if collateral asset value overflows base balance', async () => {
    // XXX
  });

  it('reverts if absorb is paused', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, pauseGuardian, users: [alice, bob] } = protocol;
    const { COMP } = tokens;

    const cometAsB = comet.connect(bob);

    // Pause transfer
    await wait(comet.connect(pauseGuardian).pause(false, false, false, true, false));
    expect(await comet.isAbsorbPaused()).to.be.true;

    await expect(cometAsB.absorb(bob.address, [alice.address])).to.be.revertedWith('absorb is paused');
  });
});