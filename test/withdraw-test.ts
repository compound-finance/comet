import { Comet, ethers, expect, exp, makeProtocol, portfolio, wait } from './helpers';

describe('withdrawTo', function () {
  it('withdraws base from sender if the asset is base', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    const i0 = await USDC.allocateTo(comet.address, 100e6);
    const t0 = Object.assign({}, await comet.totalsBasic(), {
      totalSupplyBase: 100e6,
    });
    const b0 = await wait(comet.setTotalsBasic(t0));

    const i1 = await comet.setBasePrincipal(bob.address, 100e6);
    const cometAsB = comet.connect(bob);

    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsB.withdrawTo(alice.address, USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const p1 = await portfolio(protocol, alice.address)
    const q1 = await portfolio(protocol, bob.address)

    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.internal).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(t1.totalSupplyBase).to.be.equal(0n);
    expect(t1.totalBorrowBase).to.be.equal(0n);
    // XXX disable during coverage?
    //expect(Number(s0.receipt.gasUsed)).to.be.lessThan(80000);
  });

  it('withdraws collateral from sender if the asset is collateral', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { COMP } = tokens;

    const i0 = await COMP.allocateTo(comet.address, 8e8);
    const t0 = Object.assign({}, await comet.totalsCollateral(COMP.address), {
      totalSupplyAsset: 8e8,
    });
    const b0 = await wait(comet.setTotalsCollateral(COMP.address, t0));

    const i1 = await comet.setCollateralBalance(bob.address, COMP.address, 8e8);
    const cometAsB = comet.connect(bob);

    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsB.withdrawTo(alice.address, COMP.address, 8e8));
    const t1 = await comet.totalsCollateral(COMP.address);
    const p1 = await portfolio(protocol, alice.address)
    const q1 = await portfolio(protocol, bob.address)

    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.internal).to.be.deep.equal({USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n});
    expect(q0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.external).to.be.deep.equal({USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n});
    expect(q1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(t1.totalSupplyAsset).to.be.equal(0n);
    // XXX disable during coverage?
    //expect(Number(s0.receipt.gasUsed)).to.be.lessThan(60000);
  });

  it('calculates base principal correctly', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(comet.address, 100e6);
    const totals0 = Object.assign({}, await comet.totalsBasic(), {
      baseSupplyIndex: 2e15,
      totalSupplyBase: 50e6, // 100e6 in present value
    });
    await wait(comet.setTotalsBasic(totals0));

    await comet.setBasePrincipal(bob.address, 50e6); // 100e6 in present value
    const cometAsB = comet.connect(bob);

    const alice0 = await portfolio(protocol, alice.address);
    const bob0 = await portfolio(protocol, bob.address);

    await wait(cometAsB.withdrawTo(alice.address, USDC.address, 100e6));
    const totals1 = await comet.totalsBasic();
    const alice1 = await portfolio(protocol, alice.address)
    const bob1 = await portfolio(protocol, bob.address)

    expect(alice0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(alice0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob0.internal).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(alice1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(alice1.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(totals1.totalSupplyBase).to.be.equal(0n);
    expect(totals1.totalBorrowBase).to.be.equal(0n);
  });

  it('reverts if withdrawing base exceeds the total supply', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    const i0 = await USDC.allocateTo(comet.address, 100e6);
    const i1 = await comet.setBasePrincipal(bob.address, 100e6);
    const cometAsB = comet.connect(bob);

    await expect(cometAsB.withdrawTo(alice.address, USDC.address, 100e6)).to.be.reverted;
  });

  it('reverts if withdrawing collateral exceeds the total supply', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { COMP } = tokens;

    const i0 = await COMP.allocateTo(comet.address, 8e8);
    const i1 = await comet.setCollateralBalance(bob.address, COMP.address, 8e8);
    const cometAsB = comet.connect(bob);

    await expect(cometAsB.withdrawTo(alice.address, COMP.address, 8e8)).to.be.reverted;
  });

  it('reverts if the asset is neither collateral nor base', async () => {
    const protocol = await makeProtocol();
    const { comet, users: [alice, bob], unsupportedToken: USUP } = protocol;

    const i0 = await USUP.allocateTo(comet.address, 1);
    const cometAsB = comet.connect(bob);

    await expect(cometAsB.withdrawTo(alice.address, USUP.address, 1)).to.be.reverted;
  });

  it('reverts if withdraw is paused', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, pauseGuardian, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(comet.address, 1);
    const cometAsB = comet.connect(bob);

    // Pause withdraw
    await wait(comet.connect(pauseGuardian).pause(false, false, true, false, false));
    expect(await comet.isWithdrawPaused()).to.be.true;

    await expect(cometAsB.withdrawTo(alice.address, USDC.address, 1)).to.be.revertedWith('withdraw is paused');
  });

  it.skip('borrows to withdraw if necessary/possible', async () => {
    // XXX
  });

  it.skip('is not broken by malicious re-entrancy', async () => {
    // XXX
  });
});

describe('withdraw', function () {
  it('withdraws to sender by default', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    const i0 = await USDC.allocateTo(comet.address, 100e6);
    const t0 = Object.assign({}, await comet.totalsBasic(), {
      totalSupplyBase: 100e6,
    });
    const b0 = await wait(comet.setTotalsBasic(t0));

    const i1 = await comet.setBasePrincipal(bob.address, 100e6);
    const cometAsB = comet.connect(bob);

    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsB.withdraw(USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const q1 = await portfolio(protocol, bob.address)

    expect(q0.internal).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
  });

  it('reverts if withdraw is paused', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, pauseGuardian, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(comet.address, 100e6);
    const cometAsB = comet.connect(bob);

    // Pause withdraw
    await wait(comet.connect(pauseGuardian).pause(false, false, true, false, false));
    expect(await comet.isWithdrawPaused()).to.be.true;

    await expect(cometAsB.withdraw(USDC.address, 100e6)).to.be.revertedWith('withdraw is paused');
  });
});

describe('withdrawFrom', function () {
  it('withdraws from src if specified and sender has permission', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, users: [alice, bob, charlie] } = protocol;
    const { COMP } = tokens;

    const i0 = await COMP.allocateTo(comet.address, 7);
    const t0 = Object.assign({}, await comet.totalsCollateral(COMP.address), {
      totalSupplyAsset: 7,
    });
    const b0 = await wait(comet.setTotalsCollateral(COMP.address, t0));

    const i1 = await comet.setCollateralBalance(bob.address, COMP.address, 7);

    const cometAsB = comet.connect(bob);
    const cometAsC = comet.connect(charlie);

    const a1 = await wait(cometAsB.allow(charlie.address, true));
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsC.withdrawFrom(bob.address, alice.address, COMP.address, 7));
    const p1 = await portfolio(protocol, alice.address)
    const q1 = await portfolio(protocol, bob.address)

    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.internal).to.be.deep.equal({USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n});
    expect(q0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.external).to.be.deep.equal({USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n});
    expect(q1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
  });

  it('reverts if src is specified and sender does not have permission', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, users: [alice, bob, charlie] } = protocol;
    const { COMP } = tokens;

    const cometAsC = comet.connect(charlie);

    await expect(cometAsC.withdrawFrom(bob.address, alice.address, COMP.address, 7))
      .to.be.revertedWith('operator not permitted');
  });

  it('reverts if withdraw is paused', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, pauseGuardian, users: [alice, bob, charlie] } = protocol;
    const { COMP } = tokens;

    await COMP.allocateTo(comet.address, 7);
    const cometAsB = comet.connect(bob);
    const cometAsC = comet.connect(charlie);

    // Pause withdraw
    await wait(comet.connect(pauseGuardian).pause(false, false, true, false, false));
    expect(await comet.isWithdrawPaused()).to.be.true;

    await wait(cometAsB.allow(charlie.address, true));
    await expect(cometAsC.withdrawFrom(bob.address, alice.address, COMP.address, 7)).to.be.revertedWith('withdraw is paused');
  });
});