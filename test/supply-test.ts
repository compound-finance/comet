import { ethers, event, expect, exp, makeProtocol, portfolio, ReentryAttack, setTotalsBasic, wait, fastForward } from './helpers';
import { EvilToken, EvilToken__factory } from '../build/types';

describe('supplyTo', function () {
  it('supplies base from sender if the asset is base', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    const _i0 = await USDC.allocateTo(bob.address, 100e6);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsBasic();
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const _a0 = await wait(baseAsB.approve(comet.address, 100e6));
    const s0 = await wait(cometAsB.supplyTo(alice.address, USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const p1 = await portfolio(protocol, alice.address);
    const q1 = await portfolio(protocol, bob.address);

    expect(event(s0, 0)).to.be.deep.equal({
      Transfer: {
        from: bob.address,
        to: comet.address,
        amount: BigInt(100e6),
      }
    });
    expect(event(s0, 1)).to.be.deep.equal({
      Supply: {
        from: bob.address,
        dst: alice.address,
        amount: BigInt(100e6),
      }
    });
    expect(event(s0, 2)).to.be.deep.equal({
      Transfer: {
        from: ethers.constants.AddressZero,
        to: alice.address,
        amount: BigInt(100e6),
      }
    });

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase.add(100e6));
    expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(120000);
  });

  it('supplies max base borrow balance (including accrued) from sender if the asset is base', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(bob.address, 100e6);
    await setTotalsBasic(comet, {
      totalSupplyBase: 100e6,
      totalBorrowBase: 50e6, // non-zero borrow to accrue interest
    });
    await comet.setBasePrincipal(alice.address, -50e6);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    // Fast forward to accrue some interest
    await fastForward(86400);
    await ethers.provider.send('evm_mine', []);

    const t0 = await comet.totalsBasic();
    const a0 = await portfolio(protocol, alice.address);
    const b0 = await portfolio(protocol, bob.address);
    await wait(baseAsB.approve(comet.address, 100e6));
    const aliceAccruedBorrowBalance = (await comet.callStatic.borrowBalanceOf(alice.address)).toBigInt();
    const s0 = await wait(cometAsB.supplyTo(alice.address, USDC.address, ethers.constants.MaxUint256));
    const t1 = await comet.totalsBasic();
    const a1 = await portfolio(protocol, alice.address);
    const b1 = await portfolio(protocol, bob.address);

    expect(s0.receipt['events'].length).to.be.equal(2);
    expect(event(s0, 0)).to.be.deep.equal({
      Transfer: {
        from: bob.address,
        to: comet.address,
        amount: aliceAccruedBorrowBalance,
      }
    });
    expect(event(s0, 1)).to.be.deep.equal({
      Supply: {
        from: bob.address,
        dst: alice.address,
        amount: aliceAccruedBorrowBalance,
      }
    });

    expect(-aliceAccruedBorrowBalance).to.not.equal(exp(-50, 6));
    expect(a0.internal).to.be.deep.equal({ USDC: -aliceAccruedBorrowBalance, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(a0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(b0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(b0.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(a1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(a1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(b1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(b1.external).to.be.deep.equal({ USDC: exp(100, 6) - aliceAccruedBorrowBalance, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
    expect(t1.totalBorrowBase).to.be.equal(0n);
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(120000);
  });

  it('supply max base should supply 0 if user has no borrow position', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(bob.address, 100e6);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsBasic();
    const a0 = await portfolio(protocol, alice.address);
    const b0 = await portfolio(protocol, bob.address);
    await wait(baseAsB.approve(comet.address, 100e6));
    const s0 = await wait(cometAsB.supplyTo(alice.address, USDC.address, ethers.constants.MaxUint256));
    const t1 = await comet.totalsBasic();
    const a1 = await portfolio(protocol, alice.address);
    const b1 = await portfolio(protocol, bob.address);

    expect(s0.receipt['events'].length).to.be.equal(2);
    expect(event(s0, 0)).to.be.deep.equal({
      Transfer: {
        from: bob.address,
        to: comet.address,
        amount: 0n,
      }
    });
    expect(event(s0, 1)).to.be.deep.equal({
      Supply: {
        from: bob.address,
        dst: alice.address,
        amount: 0n,
      }
    });

    expect(a0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(a0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(b0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(b0.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(a1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(a1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(b1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(b1.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
    expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(120000);
  });

  it('does not emit Transfer for 0 mint', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(bob.address, 100e6);
    await comet.setBasePrincipal(alice.address, -100e6);
    await setTotalsBasic(comet, {
      totalBorrowBase: 100e6,
    });

    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    const _a0 = await wait(baseAsB.approve(comet.address, 100e6));
    const s0 = await wait(cometAsB.supplyTo(alice.address, USDC.address, 100e6));
    expect(s0.receipt['events'].length).to.be.equal(2);
    expect(event(s0, 0)).to.be.deep.equal({
      Transfer: {
        from: bob.address,
        to: comet.address,
        amount: BigInt(100e6),
      }
    });
    expect(event(s0, 1)).to.be.deep.equal({
      Supply: {
        from: bob.address,
        dst: alice.address,
        amount: BigInt(100e6),
      }
    });
  });

  // This is an edge-case that can occur when a user supplies 0 base.
  // When `amount=0` in `supplyBase`, `dstPrincipalNew = principalValue(presentValue(dstPrincipal))`
  // In some cases, `dstPrincipalNew` can actually be less than `dstPrincipal` due to the fact
  // that the principal value and present value functions round down. This breaks our assumption
  // in `repayAndSupplyAmount` that `newPrincipal >= oldPrincipal` MUST be true. In the old code,
  // this would cause `supplyAmount` to be an extremely large number (uint104(-1)), which would
  // later cause an overflow during an addition operation. The new code now explicitly checks
  // this assumption and sets both `repayAmount` and `supplyAmount` to 0 if the assumption is
  // violated.
  it('supplies 0 and does not revert when dstPrincipalNew < dstPrincipal', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, users: [alice] } = protocol;
    const { USDC } = tokens;

    await comet.setBasePrincipal(alice.address, 99999992291226);
    await setTotalsBasic(comet, {
      totalSupplyBase: 699999944771920,
      baseSupplyIndex: 1000000131467072,
    });

    const s0 = await wait(comet.connect(alice).supply(USDC.address, 0));

    expect(s0.receipt['events'].length).to.be.equal(2);
    expect(event(s0, 0)).to.be.deep.equal({
      Transfer: {
        from: alice.address,
        to: comet.address,
        amount: BigInt(0),
      }
    });
    expect(event(s0, 1)).to.be.deep.equal({
      Supply: {
        from: alice.address,
        dst: alice.address,
        amount: BigInt(0),
      }
    });
  });

  it('user supply is same as total supply', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, users: [bob] } = protocol;
    const { USDC } = tokens;

    await setTotalsBasic(comet, {
      totalSupplyBase: 100,
      baseSupplyIndex: exp(1.085, 15),
    });

    const _i0 = await USDC.allocateTo(bob.address, 10);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsBasic();
    const p0 = await portfolio(protocol, bob.address);
    const _a0 = await wait(baseAsB.approve(comet.address, 10));
    const s0 = await wait(cometAsB.supplyTo(bob.address, USDC.address, 10));
    const t1 = await comet.totalsBasic();
    const p1 = await portfolio(protocol, bob.address);

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p0.external).to.be.deep.equal({ USDC: 10n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: 9n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyBase).to.be.equal(109);
    expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(120000);
  });

  it('supplies collateral from sender if the asset is collateral', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { COMP } = tokens;

    const _i0 = await COMP.allocateTo(bob.address, 8e8);
    const baseAsB = COMP.connect(bob);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsCollateral(COMP.address);
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const _a0 = await wait(baseAsB.approve(comet.address, 8e8));
    const s0 = await wait(cometAsB.supplyTo(alice.address, COMP.address, 8e8));
    const t1 = await comet.totalsCollateral(COMP.address);
    const p1 = await portfolio(protocol, alice.address);
    const q1 = await portfolio(protocol, bob.address);

    expect(event(s0, 0)).to.be.deep.equal({
      Transfer: {
        from: bob.address,
        to: comet.address,
        amount: BigInt(8e8),
      }
    });
    expect(event(s0, 1)).to.be.deep.equal({
      SupplyCollateral: {
        from: bob.address,
        dst: alice.address,
        asset: COMP.address,
        amount: BigInt(8e8),
      }
    });

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.external).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
    expect(p1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyAsset).to.be.equal(t0.totalSupplyAsset.add(8e8));
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(140000);
  });

  it('calculates base principal correctly', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(bob.address, 100e6);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    const totals0 = await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
    });

    const alice0 = await portfolio(protocol, alice.address);
    const bob0 = await portfolio(protocol, bob.address);
    const aliceBasic0 = await comet.userBasic(alice.address);

    await wait(baseAsB.approve(comet.address, 100e6));
    await wait(cometAsB.supplyTo(alice.address, USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const alice1 = await portfolio(protocol, alice.address);
    const bob1 = await portfolio(protocol, bob.address);
    const aliceBasic1 = await comet.userBasic(alice.address);

    expect(alice0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(alice0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(bob0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(bob0.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(alice1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(alice1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(bob1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(bob1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(t1.totalSupplyBase).to.be.equal(totals0.totalSupplyBase.add(50e6)); // 100e6 in present value
    expect(t1.totalBorrowBase).to.be.equal(totals0.totalBorrowBase);
    expect(aliceBasic1.principal).to.be.equal(aliceBasic0.principal.add(50e6)); // 100e6 in present value
  });

  it('reverts if supplying collateral exceeds the supply cap', async () => {
    const protocol = await makeProtocol({
      assets: {
        COMP: { initial: 1e7, decimals: 18, supplyCap: 0 },
        USDC: { initial: 1e6, decimals: 6 },
      }
    });
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { COMP } = tokens;

    const _i0 = await COMP.allocateTo(bob.address, 8e8);
    const baseAsB = COMP.connect(bob);
    const cometAsB = comet.connect(bob);

    const _a0 = await wait(baseAsB.approve(comet.address, 8e8));
    await expect(cometAsB.supplyTo(alice.address, COMP.address, 8e8)).to.be.revertedWith("custom error 'SupplyCapExceeded()'");
  });

  it('reverts if the asset is neither collateral nor base', async () => {
    const protocol = await makeProtocol();
    const { comet, users: [alice, bob], unsupportedToken: USUP } = protocol;

    const _i0 = await USUP.allocateTo(bob.address, 1);
    const baseAsB = USUP.connect(bob);
    const cometAsB = comet.connect(bob);

    const _a0 = await wait(baseAsB.approve(comet.address, 1));
    await expect(cometAsB.supplyTo(alice.address, USUP.address, 1)).to.be.reverted;
  });

  it('reverts if supply is paused', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, pauseGuardian, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(bob.address, 1);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    // Pause supply
    await wait(comet.connect(pauseGuardian).pause(true, false, false, false, false));
    expect(await comet.isSupplyPaused()).to.be.true;

    await wait(baseAsB.approve(comet.address, 1));
    await expect(cometAsB.supplyTo(alice.address, USDC.address, 1)).to.be.revertedWith("custom error 'Paused()'");
  });

  it('reverts if supply max for a collateral asset', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { COMP } = tokens;

    await COMP.allocateTo(bob.address, 100e6);
    const baseAsB = COMP.connect(bob);
    const cometAsB = comet.connect(bob);

    await wait(baseAsB.approve(COMP.address, 100e6));
    await expect(cometAsB.supplyTo(alice.address, COMP.address, ethers.constants.MaxUint256)).to.be.revertedWith("custom error 'InvalidUInt128()'");
  });

  it.skip('supplies the correct amount in a fee-like situation', async () => {
    // Note: fee-tokens are not currently supported (for efficiency) and should not be added
  });

  it('prevents exceeding the supply cap via re-entrancy', async () => {
    const { comet, tokens, users: [alice, bob] } = await makeProtocol({
      assets: {
        USDC: {
          decimals: 6
        },
        EVIL: {
          decimals: 6,
          initialPrice: 2,
          factory: await ethers.getContractFactory('EvilToken') as EvilToken__factory,
          supplyCap: 100e6
        }
      }
    });
    const { EVIL } = <{ EVIL: EvilToken }>tokens;

    const attack = Object.assign({}, await EVIL.getAttack(), {
      attackType: ReentryAttack.SupplyFrom,
      source: alice.address,
      destination: bob.address,
      asset: EVIL.address,
      amount: 75e6,
      maxCalls: 1
    });
    await EVIL.setAttack(attack);

    await comet.connect(alice).allow(EVIL.address, true);

    await expect(
      comet.connect(alice).supplyTo(bob.address, EVIL.address, 75e6)
    ).to.be.revertedWith("custom error 'SupplyCapExceeded()'");
  });
});

describe('supply', function () {
  it('supplies to sender by default', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, users: [bob] } = protocol;
    const { USDC } = tokens;

    const _i0 = await USDC.allocateTo(bob.address, 100e6);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    const _t0 = await comet.totalsBasic();
    const q0 = await portfolio(protocol, bob.address);
    const _a0 = await wait(baseAsB.approve(comet.address, 100e6));
    const _s0 = await wait(cometAsB.supply(USDC.address, 100e6));
    const _t1 = await comet.totalsBasic();
    const q1 = await portfolio(protocol, bob.address);

    expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  });

  it('reverts if supply is paused', async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    const { comet, tokens, pauseGuardian, users: [bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(bob.address, 100e6);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    // Pause supply
    await wait(comet.connect(pauseGuardian).pause(true, false, false, false, false));
    expect(await comet.isSupplyPaused()).to.be.true;

    await wait(baseAsB.approve(comet.address, 100e6));
    await expect(cometAsB.supply(USDC.address, 100e6)).to.be.revertedWith("custom error 'Paused()'");
  });
});

describe('supplyFrom', function () {
  it('supplies from `from` if specified and sender has permission', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, users: [alice, bob, charlie] } = protocol;
    const { COMP } = tokens;

    const _i0 = await COMP.allocateTo(bob.address, 7);
    const baseAsB = COMP.connect(bob);
    const cometAsB = comet.connect(bob);
    const cometAsC = comet.connect(charlie);

    const _a0 = await wait(baseAsB.approve(comet.address, 7));
    const _a1 = await wait(cometAsB.allow(charlie.address, true));
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const _s0 = await wait(cometAsC.supplyFrom(bob.address, alice.address, COMP.address, 7));
    const p1 = await portfolio(protocol, alice.address);
    const q1 = await portfolio(protocol, bob.address);

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(p0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.external).to.be.deep.equal({ USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n });
    expect(p1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  });

  it('reverts if `from` is specified and sender does not have permission', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, users: [alice, bob, charlie] } = protocol;
    const { COMP } = tokens;

    const _i0 = await COMP.allocateTo(bob.address, 7);
    const cometAsC = comet.connect(charlie);

    await expect(cometAsC.supplyFrom(bob.address, alice.address, COMP.address, 7))
      .to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('reverts if supply is paused', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, pauseGuardian, users: [alice, bob, charlie] } = protocol;
    const { COMP } = tokens;

    await COMP.allocateTo(bob.address, 7);
    const baseAsB = COMP.connect(bob);
    const cometAsB = comet.connect(bob);
    const cometAsC = comet.connect(charlie);

    // Pause supply
    await wait(comet.connect(pauseGuardian).pause(true, false, false, false, false));
    expect(await comet.isSupplyPaused()).to.be.true;

    await wait(baseAsB.approve(comet.address, 7));
    await wait(cometAsB.allow(charlie.address, true));
    await expect(cometAsC.supplyFrom(bob.address, alice.address, COMP.address, 7)).to.be.revertedWith("custom error 'Paused()'");
  });
});