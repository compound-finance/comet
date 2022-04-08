import { ethers, event, expect, exp, makeProtocol, portfolio, ReentryAttack, wait } from './helpers';
import { EvilToken, EvilToken__factory } from '../build/types';

describe('supplyTo', function () {
  it('supplies base from sender if the asset is base', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    const i0 = await USDC.allocateTo(bob.address, 100e6);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsBasic();
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const a0 = await wait(baseAsB.approve(comet.address, 100e6));
    const s0 = await wait(cometAsB.supplyTo(alice.address, USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const p1 = await portfolio(protocol, alice.address)
    const q1 = await portfolio(protocol, bob.address)

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

    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase.add(100e6));
    expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(120000);
  });

  it('supplies collateral from sender if the asset is collateral', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { COMP } = tokens;

    const i0 = await COMP.allocateTo(bob.address, 8e8);
    const baseAsB = COMP.connect(bob);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsCollateral(COMP.address);
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const a0 = await wait(baseAsB.approve(comet.address, 8e8));
    const s0 = await wait(cometAsB.supplyTo(alice.address, COMP.address, 8e8));
    const t1 = await comet.totalsCollateral(COMP.address);
    const p1 = await portfolio(protocol, alice.address)
    const q1 = await portfolio(protocol, bob.address)

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

    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.external).to.be.deep.equal({USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n});
    expect(p1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(t1.totalSupplyAsset).to.be.equal(t0.totalSupplyAsset.add(8e8));
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(140000);
  });

  it('calculates base principal correctly', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(bob.address, 100e6);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    let totals0 = await comet.totalsBasic();
    totals0 = Object.assign({}, await comet.totalsBasic(), {
      baseSupplyIndex: 2e15,
    });
    await wait(comet.setTotalsBasic(totals0));
    const alice0 = await portfolio(protocol, alice.address);
    const bob0 = await portfolio(protocol, bob.address);
    const aliceBasic0 = await comet.userBasic(alice.address);

    await wait(baseAsB.approve(comet.address, 100e6));
    await wait(cometAsB.supplyTo(alice.address, USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const alice1 = await portfolio(protocol, alice.address)
    const bob1 = await portfolio(protocol, bob.address)
    const aliceBasic1 = await comet.userBasic(alice.address);

    expect(alice0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(alice0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob0.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(alice1.internal).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(alice1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(bob1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(t1.totalSupplyBase).to.be.equal(totals0.totalSupplyBase.add(50e6)); // 100e6 in present value
    expect(t1.totalBorrowBase).to.be.equal(totals0.totalBorrowBase);
    expect(aliceBasic1.principal).to.be.equal(aliceBasic0.principal.add(50e6)); // 100e6 in present value
  })

  it('reverts if supplying collateral exceeds the supply cap', async () => {
    const protocol = await makeProtocol({assets: {
      COMP: { initial: 1e7, decimals: 18, supplyCap: 0 },
      USDC: { initial: 1e6, decimals: 6 },
    }});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { COMP } = tokens;

    const i0 = await COMP.allocateTo(bob.address, 8e8);
    const baseAsB = COMP.connect(bob);
    const cometAsB = comet.connect(bob);

    const a0 = await wait(baseAsB.approve(comet.address, 8e8));
    await expect(cometAsB.supplyTo(alice.address, COMP.address, 8e8)).to.be.revertedWith("custom error 'SupplyCapExceeded()'");
  });

  it('reverts if the asset is neither collateral nor base', async () => {
    const protocol = await makeProtocol();
    const { comet, users: [alice, bob], unsupportedToken: USUP } = protocol;

    const i0 = await USUP.allocateTo(bob.address, 1);
    const baseAsB = USUP.connect(bob);
    const cometAsB = comet.connect(bob);

    const a0 = await wait(baseAsB.approve(comet.address, 1));
    await expect(cometAsB.supplyTo(alice.address, USUP.address, 1)).to.be.reverted;
  });

  it('reverts if supply is paused', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
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
    const { EVIL } = <{EVIL: EvilToken}>tokens;

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
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    const i0 = await USDC.allocateTo(bob.address, 100e6);
    const baseAsB = USDC.connect(bob);
    const cometAsB = comet.connect(bob);

    const t0 = await comet.totalsBasic();
    const q0 = await portfolio(protocol, bob.address);
    const a0 = await wait(baseAsB.approve(comet.address, 100e6));
    const s0 = await wait(cometAsB.supply(USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const q1 = await portfolio(protocol, bob.address)

    expect(q0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.external).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.internal).to.be.deep.equal({USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
  });

  it('reverts if supply is paused', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, pauseGuardian, users: [alice, bob] } = protocol;
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

    const i0 = await COMP.allocateTo(bob.address, 7);
    const baseAsB = COMP.connect(bob);
    const cometAsB = comet.connect(bob);
    const cometAsC = comet.connect(charlie);

    const a0 = await wait(baseAsB.approve(comet.address, 7));
    const a1 = await wait(cometAsB.allow(charlie.address, true));
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsC.supplyFrom(bob.address, alice.address, COMP.address, 7));
    const p1 = await portfolio(protocol, alice.address)
    const q1 = await portfolio(protocol, bob.address)

    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.external).to.be.deep.equal({USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n});
    expect(p1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
  });

  it('reverts if `from` is specified and sender does not have permission', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, users: [alice, bob, charlie] } = protocol;
    const { COMP } = tokens;

    const i0 = await COMP.allocateTo(bob.address, 7);
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