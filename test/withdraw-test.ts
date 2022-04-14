import { EvilToken, EvilToken__factory, FaucetToken } from '../build/types';
import { baseBalanceOf, ethers, event, expect, exp, makeProtocol, portfolio, ReentryAttack, setTotalsBasic, wait } from './helpers';

describe('withdrawTo', function () {
  it('withdraws base from sender if the asset is base', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    const i0 = await USDC.allocateTo(comet.address, 100e6);
    const t0 = await setTotalsBasic(comet, {
      totalSupplyBase: 100e6,
    });

    const i1 = await comet.setBasePrincipal(bob.address, 100e6);
    const cometAsB = comet.connect(bob);

    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const s0 = await wait(cometAsB.withdrawTo(alice.address, USDC.address, 100e6));
    const t1 = await comet.totalsBasic();
    const p1 = await portfolio(protocol, alice.address)
    const q1 = await portfolio(protocol, bob.address)

    expect(event(s0, 0)).to.be.deep.equal({
      Transfer: {
        from: comet.address,
        to: alice.address,
        amount: BigInt(100e6),
      }
    });
    expect(event(s0, 1)).to.be.deep.equal({
      Withdraw: {
        src: bob.address,
        to: alice.address,
        amount: BigInt(100e6),
      }
    });
    expect(event(s0, 2)).to.be.deep.equal({
      Transfer: {
        from: bob.address,
        to: ethers.constants.AddressZero,
        amount: BigInt(100e6),
      }
    });

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
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(100000);
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

    expect(event(s0, 0)).to.be.deep.equal({
      Transfer: {
        from: comet.address,
        to: alice.address,
        amount: BigInt(8e8),
      }
    });
    expect(event(s0, 1)).to.be.deep.equal({
      WithdrawCollateral: {
        src: bob.address,
        to: alice.address,
        asset: COMP.address,
        amount: BigInt(8e8),
      }
    });

    expect(p0.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q0.internal).to.be.deep.equal({USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n});
    expect(q0.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(p1.external).to.be.deep.equal({USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n});
    expect(q1.internal).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(q1.external).to.be.deep.equal({USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n});
    expect(t1.totalSupplyAsset).to.be.equal(0n);
    expect(Number(s0.receipt.gasUsed)).to.be.lessThan(80000);
  });

  it('calculates base principal correctly', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    await USDC.allocateTo(comet.address, 100e6);
    const totals0 = await setTotalsBasic(comet, {
      baseSupplyIndex: 2e15,
      totalSupplyBase: 50e6, // 100e6 in present value
    });

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

    await expect(cometAsB.withdrawTo(alice.address, USDC.address, 1)).to.be.revertedWith("custom error 'Paused()'");
  });

  it('borrows to withdraw if necessary/possible', async () => {
    const { comet, tokens, users: [alice, bob] } = await makeProtocol();
    const { WETH, USDC } = tokens;

    await USDC.allocateTo(comet.address, 1e6);
    await comet.setCollateralBalance(alice.address, WETH.address, exp(1,18));

    let t0 = await comet.totalsBasic();
    t0 = await setTotalsBasic(comet, {
      baseBorrowIndex: t0.baseBorrowIndex.mul(2),
    });

    await comet.connect(alice).withdrawTo(bob.address, USDC.address, 1e6);

    const t1 = await comet.totalsBasic();
    const baseIndexScale = await comet.baseIndexScale();

    expect(await baseBalanceOf(comet, alice.address)).to.eq(BigInt(-1e6));
    expect(await USDC.balanceOf(bob.address)).to.eq(1e6);
  });
});

describe('withdraw', function () {
  it('withdraws to sender by default', async () => {
    const protocol = await makeProtocol({base: 'USDC'});
    const { comet, tokens, users: [alice, bob] } = protocol;
    const { USDC } = tokens;

    const i0 = await USDC.allocateTo(comet.address, 100e6);
    const t0 = await setTotalsBasic(comet, {
      totalSupplyBase: 100e6,
    });

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

    await expect(cometAsB.withdraw(USDC.address, 100e6)).to.be.revertedWith("custom error 'Paused()'");
  });

  it('reverts if withdraw amount is less than baseBorrowMin', async () => {
    const { comet, tokens, users: [alice, bob] } = await makeProtocol({
      baseBorrowMin: exp(1,6)
    });
    const { USDC } = tokens;

    await expect(
      comet.connect(alice).withdraw(USDC.address, exp(.5, 6))
    ).to.be.revertedWith("custom error 'BorrowTooSmall()'");
  });

  it('reverts if base withdraw amount is not collateralzed', async () => {
    const { comet, tokens, users: [alice, bob] } = await makeProtocol();
    const { USDC } = tokens;

    await expect(
      comet.connect(alice).withdraw(USDC.address, exp(1, 6))
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
  });

  it('reverts if collateral withdraw amount is not collateralized', async () => {
    const { comet, tokens, users: [alice] } = await makeProtocol();
    const { WETH } = tokens;

    const totalsCollateral = Object.assign({}, await comet.totalsCollateral(WETH.address), {
      totalSupplyAsset: exp(1,18),
    });
    await wait(comet.setTotalsCollateral(WETH.address, totalsCollateral));

    // user has a borrow, but with collateral to cover
    await comet.setBasePrincipal(alice.address, -100e6);
    await comet.setCollateralBalance(alice.address, WETH.address, exp(1,18));

    // reverts if withdraw would leave borrow uncollateralized
    await expect(
      comet.connect(alice).withdraw(WETH.address, exp(1, 18))
    ).to.be.revertedWith("custom error 'NotCollateralized()'");
  });

  describe('reentrancy', function() {
    it('is not broken by malicious reentrancy transferFrom', async () => {
      const { comet, tokens, users: [alice, bob] } = await makeProtocol({
        assets: {
          USDC: {
            decimals: 6
          },
          EVIL: {
            decimals: 6,
            initialPrice: 2,
            factory: await ethers.getContractFactory('EvilToken') as EvilToken__factory,
          }
        }
      });
      const { USDC, EVIL } = <{USDC: FaucetToken, EVIL: EvilToken}>tokens;

      await USDC.allocateTo(comet.address, 100e6);

      const attack = Object.assign({}, await EVIL.getAttack(), {
        attackType: ReentryAttack.TransferFrom,
        destination: bob.address,
        asset: USDC.address,
        amount: 1e6
      });
      await EVIL.setAttack(attack);

      const totalsCollateral = Object.assign({}, await comet.totalsCollateral(EVIL.address), {
        totalSupplyAsset: 100e6,
      });
      await comet.setTotalsCollateral(EVIL.address, totalsCollateral);

      await comet.setCollateralBalance(alice.address, EVIL.address, exp(1,6));
      await comet.connect(alice).allow(EVIL.address, true);

      // in callback, EVIL token calls transferFrom(alice.address, bob.address, 1e6)
      await expect(
        comet.connect(alice).withdraw(EVIL.address, 1e6)
      ).to.be.revertedWith("custom error 'NotCollateralized()'");

      // no USDC transferred
      expect(await USDC.balanceOf(comet.address)).to.eq(100e6);
      // expect(await comet.baseBalanceOf(alice.address)).to.eq(0);
      expect(await USDC.balanceOf(alice.address)).to.eq(0);
      // expect(await comet.baseBalanceOf(bob.address)).to.eq(0);
      expect(await USDC.balanceOf(bob.address)).to.eq(0);
    });

    it('is not broken by malicious reentrancy withdrawFrom', async () => {
      const { comet, tokens, users: [alice, bob] } = await makeProtocol({
        assets: {
          USDC: {
            decimals: 6
          },
          EVIL: {
            decimals: 6,
            initialPrice: 2,
            factory: await ethers.getContractFactory('EvilToken') as EvilToken__factory,
          }
        }
      });
      const { USDC, EVIL } = <{USDC: FaucetToken, EVIL: EvilToken}>tokens;

      await USDC.allocateTo(comet.address, 100e6);

      const attack = Object.assign({}, await EVIL.getAttack(), {
        attackType: ReentryAttack.WithdrawFrom,
        destination: bob.address,
        asset: USDC.address,
        amount: 1e6
      });
      await EVIL.setAttack(attack);

      const totalsCollateral = Object.assign({}, await comet.totalsCollateral(EVIL.address), {
        totalSupplyAsset: 100e6,
      });
      await comet.setTotalsCollateral(EVIL.address, totalsCollateral);

      await comet.setCollateralBalance(alice.address, EVIL.address, exp(1,6));

      await comet.connect(alice).allow(EVIL.address, true);

      // in callback, EvilToken attempts to withdraw USDC to bob's address
      await expect(
        comet.connect(alice).withdraw(EVIL.address, 1e6)
      ).to.be.revertedWith("custom error 'NotCollateralized()'");

      // no USDC transferred
      expect(await USDC.balanceOf(comet.address)).to.eq(100e6);
      // expect(await comet.baseBalanceOf(alice.address)).to.eq(0);
      expect(await USDC.balanceOf(alice.address)).to.eq(0);
      // expect(await comet.baseBalanceOf(bob.address)).to.eq(0);
      expect(await USDC.balanceOf(bob.address)).to.eq(0);
    });
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
      .to.be.revertedWith("custom error 'Unauthorized()'");
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
    await expect(cometAsC.withdrawFrom(bob.address, alice.address, COMP.address, 7)).to.be.revertedWith("custom error 'Paused()'");
  });
});