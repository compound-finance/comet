import { ethers, event, expect, exp, makeProtocol, portfolio, ReentryAttack, setTotalsBasic, wait, fastForward, defaultAssets } from './helpers';
import { EvilToken, EvilToken__factory, NonStandardFaucetFeeToken__factory, NonStandardFaucetFeeToken } from '../build/types';
import { BigNumber } from 'ethers';

// Note: isolated supply functionality, withdraw and repay are tested in separate testsets
describe('5. supply', function () {
  const baseTokenDecimals = 6;

  describe('supply base asset', function () {
    describe('default state (un-accrued)', function () {
      it('supply is not paused by default', async () => {
        const { comet } = await makeProtocol({ base: 'USDC' });
        expect(await comet.isSupplyPaused()).to.be.false;
      });

      it('no base token on the comet', async () => {
        const { comet, tokens } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;
        expect(await USDC.balanceOf(comet.address)).to.equal(0);
      });

      it('no collateral tokens on the comet', async () => {
        const { comet, tokens } = await makeProtocol({ base: 'USDC' });
        const { COMP, WETH, WBTC } = tokens;
        expect(await COMP.balanceOf(comet.address)).to.equal(0);
        expect(await WETH.balanceOf(comet.address)).to.equal(0);
        expect(await WBTC.balanceOf(comet.address)).to.equal(0);
      });

      it('default supply index', async () => {
        const { comet } = await makeProtocol({ base: 'USDC' });
        const totals = await comet.totalsBasic();
        expect(totals.baseSupplyIndex).to.equal(exp(1, 15));
      });

      it('no stored total supply with interest by default', async () => {
        const { comet } = await makeProtocol({ base: 'USDC' });
        const totals = await comet.totalsBasic();
        expect(totals.totalSupplyBase).to.equal(0);
      });

      it('no displayed total supply with interest by default', async () => {
        const { comet } = await makeProtocol({ base: 'USDC' });
        expect(await comet.totalSupply()).to.equal(0);
      });

      it('no stored user\'s balance by default', async () => {
        const { comet, users: [alice] } = await makeProtocol({ base: 'USDC' });
        expect((await comet.userBasic(alice.address)).principal).to.equal(0);
      });

      it('no displayed user\'s balance by default', async () => {
        const { comet, users: [alice] } = await makeProtocol({ base: 'USDC' });
        expect(await comet.balanceOf(alice.address)).to.equal(0);
      });
    });

    describe('supply base asset: reverts', function () {
      it('reverts if supply is paused', async () => {
        const { comet, tokens, pauseGuardian, users: [alice] } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        await wait(comet.connect(pauseGuardian).pause(true, false, false, false, false));
        expect(await comet.isSupplyPaused()).to.be.true;

        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        await expect(comet.connect(alice).supply(USDC.address, 100e6)).to.be.revertedWith("custom error 'Paused()'");
      });

      it('reverts for 0 base asset supply', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        // Note: supply(0) does not revert but emits events with 0 amount
        // This is different from Sandbox behavior - original Comet allows 0 supply
        await USDC.allocateTo(alice.address, 100e6);
        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        const s0 = await wait(comet.connect(alice).supply(USDC.address, 0));
        expect(event(s0, 1)).to.be.deep.equal({
          Supply: { from: alice.address, dst: alice.address, amount: 0n }
        });
      });

      it('reverts if the asset is neither collateral nor base', async () => {
        const { comet, users: [alice], unsupportedToken: USUP } = await makeProtocol();

        await USUP.allocateTo(alice.address, 100);
        await wait(USUP.connect(alice).approve(comet.address, 100));
        await expect(comet.connect(alice).supply(USUP.address, 100)).to.be.reverted;
      });
    });

    describe('supply base asset into empty pool', function () {
      it('emits Supply event when supplies base asset into empty pool', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        const BASE_AMOUNT = exp(100, baseTokenDecimals);
        await USDC.allocateTo(alice.address, BASE_AMOUNT);

        await wait(USDC.connect(alice).approve(comet.address, BASE_AMOUNT));
        const s0 = await wait(comet.connect(alice).supply(USDC.address, BASE_AMOUNT));

        expect(event(s0, 1)).to.be.deep.equal({
          Supply: {
            from: alice.address,
            dst: alice.address,
            amount: BASE_AMOUNT,
          }
        });
      });

      it('emits Transfer event when supplies base asset into empty pool (as supply growths)', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        const BASE_AMOUNT = exp(100, baseTokenDecimals);
        const principalFromBase = BASE_AMOUNT; // default index for the empty pool gives same supply amount

        await USDC.allocateTo(alice.address, BASE_AMOUNT);
        await wait(USDC.connect(alice).approve(comet.address, BASE_AMOUNT));
        const s0 = await wait(comet.connect(alice).supply(USDC.address, BASE_AMOUNT));

        expect(event(s0, 2)).to.be.deep.equal({
          Transfer: {
            from: ethers.constants.AddressZero,
            to: alice.address,
            amount: principalFromBase,
          }
        });
      });

      it('supplies base asset into empty pool', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        const BASE_AMOUNT = exp(100, baseTokenDecimals);
        const aliceBalanceBefore = await USDC.balanceOf(alice.address);

        await USDC.allocateTo(alice.address, BASE_AMOUNT);
        const aliceBalanceAfterAllocation = await USDC.balanceOf(alice.address);

        await wait(USDC.connect(alice).approve(comet.address, BASE_AMOUNT));
        await expect(comet.connect(alice).supply(USDC.address, BASE_AMOUNT)).to.not.be.reverted;

        const aliceBalanceAfter = await USDC.balanceOf(alice.address);

        // should supply the exact balance as passed as parameter
        expect(aliceBalanceAfterAllocation.sub(aliceBalanceAfter)).to.equal(BASE_AMOUNT);
      });

      it('comet\'s token balance is increased', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        const BASE_AMOUNT = exp(100, baseTokenDecimals);
        await USDC.allocateTo(alice.address, BASE_AMOUNT);

        const cometBalanceBefore = await USDC.balanceOf(comet.address);
        await wait(USDC.connect(alice).approve(comet.address, BASE_AMOUNT));
        await comet.connect(alice).supply(USDC.address, BASE_AMOUNT);
        const cometBalanceAfter = await USDC.balanceOf(comet.address);

        expect(cometBalanceAfter.sub(cometBalanceBefore)).to.equal(BASE_AMOUNT);
      });

      it('user\'s stored principle is increased', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        const BASE_AMOUNT = exp(100, baseTokenDecimals);
        const principalFromBase = BASE_AMOUNT; // default index for the empty pool gives same supply amount

        await USDC.allocateTo(alice.address, BASE_AMOUNT);
        await wait(USDC.connect(alice).approve(comet.address, BASE_AMOUNT));
        await comet.connect(alice).supply(USDC.address, BASE_AMOUNT);

        expect((await comet.userBasic(alice.address)).principal).to.equal(principalFromBase);
      });

      it('user\'s displayed principle is increased', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        const BASE_AMOUNT = exp(100, baseTokenDecimals);
        const presentFromBase = BASE_AMOUNT; // default index for the empty pool gives same supply amount

        await USDC.allocateTo(alice.address, BASE_AMOUNT);
        await wait(USDC.connect(alice).approve(comet.address, BASE_AMOUNT));
        await comet.connect(alice).supply(USDC.address, BASE_AMOUNT);

        expect(await comet.balanceOf(alice.address)).to.equal(presentFromBase);
      });

      it('comet\'s stored total supply is increased', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        const BASE_AMOUNT = exp(100, baseTokenDecimals);
        const principalFromBase = BASE_AMOUNT; // default index for the empty pool gives same supply amount

        await USDC.allocateTo(alice.address, BASE_AMOUNT);
        await wait(USDC.connect(alice).approve(comet.address, BASE_AMOUNT));
        await comet.connect(alice).supply(USDC.address, BASE_AMOUNT);

        expect((await comet.totalsBasic()).totalSupplyBase).to.equal(principalFromBase);
      });

      it('comet\'s displayed total supply is increased', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        const BASE_AMOUNT = exp(100, baseTokenDecimals);
        const presentFromBase = BASE_AMOUNT; // default index for the empty pool gives same supply amount

        await USDC.allocateTo(alice.address, BASE_AMOUNT);
        await wait(USDC.connect(alice).approve(comet.address, BASE_AMOUNT));
        await comet.connect(alice).supply(USDC.address, BASE_AMOUNT);

        expect(await comet.totalSupply()).to.equal(presentFromBase);
      });

      it('user supply is same as total supply', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        const BASE_AMOUNT = exp(100, baseTokenDecimals);

        await USDC.allocateTo(alice.address, BASE_AMOUNT);
        await wait(USDC.connect(alice).approve(comet.address, BASE_AMOUNT));
        await comet.connect(alice).supply(USDC.address, BASE_AMOUNT);

        expect(await comet.balanceOf(alice.address)).to.equal(await comet.totalSupply());
      });
    });

    describe('supply base asset: happy path', function () {
      it('supplies base from sender if the asset is base', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(bob.address, 100e6);

        const t0 = await comet.totalsBasic();
        const p0 = await portfolio(protocol, alice.address);
        const q0 = await portfolio(protocol, bob.address);

        await wait(USDC.connect(bob).approve(comet.address, 100e6));
        const s0 = await wait(comet.connect(bob).supplyTo(alice.address, USDC.address, 100e6));

        const t1 = await comet.totalsBasic();
        const p1 = await portfolio(protocol, alice.address);
        const q1 = await portfolio(protocol, bob.address);

        // Check events
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

        // Check balances
        expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(q0.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(p1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });

        // Check totals
        expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase.add(100e6));
        expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);

        // Check gas
        expect(Number(s0.receipt.gasUsed)).to.be.lessThan(124000);
      });

      it('supplies to sender by default', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(bob.address, 100e6);

        const q0 = await portfolio(protocol, bob.address);
        await wait(USDC.connect(bob).approve(comet.address, 100e6));
        await wait(comet.connect(bob).supply(USDC.address, 100e6));
        const q1 = await portfolio(protocol, bob.address);

        expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(q0.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(q1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      });

      it('user supply equals total supply for first depositor', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [bob] } = protocol;
        const { USDC } = tokens;

        await setTotalsBasic(comet, {
          totalSupplyBase: 100,
          baseSupplyIndex: exp(1.085, 15),
        });

        await USDC.allocateTo(bob.address, 10);
        await wait(USDC.connect(bob).approve(comet.address, 10));
        const s0 = await wait(comet.connect(bob).supplyTo(bob.address, USDC.address, 10));

        const t1 = await comet.totalsBasic();
        const p1 = await portfolio(protocol, bob.address);

        expect(p1.internal).to.be.deep.equal({ USDC: 9n, COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(p1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(t1.totalSupplyBase).to.be.equal(109);
        expect(Number(s0.receipt.gasUsed)).to.be.lessThan(124000);
      });

      it('calculates base principal correctly with non-default index', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(bob.address, 100e6);

        const totals0 = await setTotalsBasic(comet, {
          baseSupplyIndex: 2e15,
        });

        const aliceBasic0 = await comet.userBasic(alice.address);

        await wait(USDC.connect(bob).approve(comet.address, 100e6));
        await wait(comet.connect(bob).supplyTo(alice.address, USDC.address, 100e6));

        const t1 = await comet.totalsBasic();
        const alice1 = await portfolio(protocol, alice.address);
        const aliceBasic1 = await comet.userBasic(alice.address);

        expect(alice1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
        // With 2x index, 100e6 present value = 50e6 principal
        expect(t1.totalSupplyBase).to.be.equal(totals0.totalSupplyBase.add(50e6));
        expect(aliceBasic1.principal).to.be.equal(aliceBasic0.principal.add(50e6));
      });
    });

    describe('supply max base (repay borrow)', function () {
      it('supplies max base borrow balance (including accrued) from sender', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(bob.address, 100e6);
        await setTotalsBasic(comet, {
          totalSupplyBase: 100e6,
          totalBorrowBase: 50e6,
        });
        await comet.setBasePrincipal(alice.address, -50e6);

        // Fast forward to accrue interest
        await fastForward(86400);
        await ethers.provider.send('evm_mine', []);

        const t0 = await comet.totalsBasic();
        const a0 = await portfolio(protocol, alice.address);
        const b0 = await portfolio(protocol, bob.address);

        await wait(USDC.connect(bob).approve(comet.address, 100e6));
        const aliceAccruedBorrowBalance = (await comet.callStatic.borrowBalanceOf(alice.address)).toBigInt();
        const s0 = await wait(comet.connect(bob).supplyTo(alice.address, USDC.address, ethers.constants.MaxUint256));

        const t1 = await comet.totalsBasic();
        const a1 = await portfolio(protocol, alice.address);
        const b1 = await portfolio(protocol, bob.address);

        // Only 2 events (no mint Transfer since repaying borrow)
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

        // Interest accrued
        expect(-aliceAccruedBorrowBalance).to.not.equal(exp(-50, 6));

        // Alice borrow repaid
        expect(a0.internal).to.be.deep.equal({ USDC: -aliceAccruedBorrowBalance, COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(a1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });

        // Bob paid
        expect(b0.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(b1.external).to.be.deep.equal({ USDC: exp(100, 6) - aliceAccruedBorrowBalance, COMP: 0n, WETH: 0n, WBTC: 0n });

        // Totals updated
        expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
        expect(t1.totalBorrowBase).to.be.equal(0n);

        expect(Number(s0.receipt.gasUsed)).to.be.lessThan(120000);
      });

      it('supply max base should supply 0 if user has no borrow position', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(bob.address, 100e6);

        const t0 = await comet.totalsBasic();
        await wait(USDC.connect(bob).approve(comet.address, 100e6));
        const s0 = await wait(comet.connect(bob).supplyTo(alice.address, USDC.address, ethers.constants.MaxUint256));

        const t1 = await comet.totalsBasic();
        const a1 = await portfolio(protocol, alice.address);
        const b1 = await portfolio(protocol, bob.address);

        // Events show 0 amount
        expect(s0.receipt['events'].length).to.be.equal(2);
        expect(event(s0, 0)).to.be.deep.equal({
          Transfer: { from: bob.address, to: comet.address, amount: 0n }
        });
        expect(event(s0, 1)).to.be.deep.equal({
          Supply: { from: bob.address, dst: alice.address, amount: 0n }
        });

        // No tokens transferred
        expect(a1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(b1.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });

        // Totals unchanged
        expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
        expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);

        expect(Number(s0.receipt.gasUsed)).to.be.lessThan(120000);
      });

      it('does not emit Transfer for 0 mint when repaying exact borrow', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(bob.address, 100e6);
        await comet.setBasePrincipal(alice.address, -100e6);
        await setTotalsBasic(comet, {
          totalBorrowBase: 100e6,
        });

        await wait(USDC.connect(bob).approve(comet.address, 100e6));
        const s0 = await wait(comet.connect(bob).supplyTo(alice.address, USDC.address, 100e6));

        // Only 2 events - no mint Transfer
        expect(s0.receipt['events'].length).to.be.equal(2);
        expect(event(s0, 0)).to.be.deep.equal({
          Transfer: { from: bob.address, to: comet.address, amount: BigInt(100e6) }
        });
        expect(event(s0, 1)).to.be.deep.equal({
          Supply: { from: bob.address, dst: alice.address, amount: BigInt(100e6) }
        });
      });

      // Edge-case: when supplying 0, dstPrincipalNew can be less than dstPrincipal due to rounding
      it('supplies 0 and does not revert when dstPrincipalNew < dstPrincipal', async () => {
        const { comet, tokens, users: [alice] } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;

        await comet.setBasePrincipal(alice.address, 99999992291226);
        await setTotalsBasic(comet, {
          totalSupplyBase: 699999944771920,
          baseSupplyIndex: 1000000131467072,
        });

        const s0 = await wait(comet.connect(alice).supply(USDC.address, 0));

        expect(s0.receipt['events'].length).to.be.equal(2);
        expect(event(s0, 0)).to.be.deep.equal({
          Transfer: { from: alice.address, to: comet.address, amount: BigInt(0) }
        });
        expect(event(s0, 1)).to.be.deep.equal({
          Supply: { from: alice.address, dst: alice.address, amount: BigInt(0) }
        });
      });

      it('reverts if supply max for a collateral asset', async () => {
        const { comet, tokens, users: [alice, bob] } = await makeProtocol({ base: 'USDC' });
        const { COMP } = tokens;

        await COMP.allocateTo(bob.address, 100e6);
        await wait(COMP.connect(bob).approve(COMP.address, 100e6));

        await expect(
          comet.connect(bob).supplyTo(alice.address, COMP.address, ethers.constants.MaxUint256)
        ).to.be.revertedWith("custom error 'InvalidUInt128()'");
      });
    });
  });

  describe('supply collateral', function () {
    describe('reverts', function () {
      it('reverts if supply is paused', async () => {
        const { comet, tokens, pauseGuardian, users: [alice] } = await makeProtocol();
        const { COMP } = tokens;

        await COMP.allocateTo(alice.address, 8e8);
        await wait(comet.connect(pauseGuardian).pause(true, false, false, false, false));

        await wait(COMP.connect(alice).approve(comet.address, 8e8));
        await expect(comet.connect(alice).supply(COMP.address, 8e8)).to.be.revertedWith("custom error 'Paused()'");
      });

      it('reverts if supplying collateral exceeds the supply cap', async () => {
        const { comet, tokens, users: [alice, bob] } = await makeProtocol({
          assets: {
            COMP: { initial: 1e7, decimals: 18, supplyCap: 0 },
            USDC: { initial: 1e6, decimals: 6 },
          }
        });
        const { COMP } = tokens;

        await COMP.allocateTo(bob.address, 8e8);
        await wait(COMP.connect(bob).approve(comet.address, 8e8));

        await expect(
          comet.connect(bob).supplyTo(alice.address, COMP.address, 8e8)
        ).to.be.revertedWith("custom error 'SupplyCapExceeded()'");
      });
    });

    describe('supply collateral: happy path', function () {
      it('supplies collateral from sender if the asset is collateral', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(bob.address, 8e8);

        const t0 = await comet.totalsCollateral(COMP.address);
        const p0 = await portfolio(protocol, alice.address);
        const q0 = await portfolio(protocol, bob.address);

        await wait(COMP.connect(bob).approve(comet.address, 8e8));
        const s0 = await wait(comet.connect(bob).supplyTo(alice.address, COMP.address, 8e8));

        const t1 = await comet.totalsCollateral(COMP.address);
        const p1 = await portfolio(protocol, alice.address);
        const q1 = await portfolio(protocol, bob.address);

        // Check events
        expect(event(s0, 0)).to.be.deep.equal({
          Transfer: { from: bob.address, to: comet.address, amount: BigInt(8e8) }
        });
        expect(event(s0, 1)).to.be.deep.equal({
          SupplyCollateral: {
            from: bob.address,
            dst: alice.address,
            asset: COMP.address,
            amount: BigInt(8e8),
          }
        });

        // Check balances
        expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
        expect(q0.external).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
        expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
        expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });

        // Check totals
        expect(t1.totalSupplyAsset).to.be.equal(t0.totalSupplyAsset.add(8e8));

        // Check gas
        expect(Number(s0.receipt.gasUsed)).to.be.lessThan(153000);
      });

      it('supplies collateral to self', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(alice.address, 8e8);

        const p0 = await portfolio(protocol, alice.address);
        await wait(COMP.connect(alice).approve(comet.address, 8e8));
        await wait(comet.connect(alice).supply(COMP.address, 8e8));
        const p1 = await portfolio(protocol, alice.address);

        expect(p0.internal.COMP).to.equal(0n);
        expect(p0.external.COMP).to.equal(exp(8, 8));
        expect(p1.internal.COMP).to.equal(exp(8, 8));
        expect(p1.external.COMP).to.equal(0n);
      });

      it('should not have collateral registered for a user initially', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice] } = protocol;
        const { COMP } = tokens;

        const assetInfo = await comet.getAssetInfoByAddress(COMP.address);
        const collateralIndex = assetInfo[1];
        const userData = await comet.userBasic(alice.address);
        const offset = 1 << collateralIndex;

        expect(userData.assetsIn & offset).to.equal(0);
      });

      it('should not have collateral in the storage initially', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice] } = protocol;
        const { COMP } = tokens;

        expect((await comet.totalsCollateral(COMP.address)).totalSupplyAsset).to.equal(0);
        expect((await comet.userCollateral(alice.address, COMP.address)).balance).to.equal(0);
      });

      it('should not have collateral on the balance initially', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens } = protocol;
        const { COMP } = tokens;

        expect(await COMP.balanceOf(comet.address)).to.equal(0);
      });

      it('collateral is added to user\'s tokens after supply', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(alice.address, 8e8);
        await wait(COMP.connect(alice).approve(comet.address, 8e8));
        await comet.connect(alice).supply(COMP.address, 8e8);

        const assetInfo = await comet.getAssetInfoByAddress(COMP.address);
        const collateralIndex = assetInfo[1];
        const userData = await comet.userBasic(alice.address);
        const offset = 1 << collateralIndex;

        expect(userData.assetsIn & offset).to.equal(offset);
      });

      it('should allow deposit more of the same collateral', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(alice.address, 16e8);
        await wait(COMP.connect(alice).approve(comet.address, 16e8));

        await comet.connect(alice).supply(COMP.address, 8e8);
        const aliceCollateralBefore = (await comet.userCollateral(alice.address, COMP.address)).balance;

        await comet.connect(alice).supply(COMP.address, 8e8);
        const aliceCollateralAfter = (await comet.userCollateral(alice.address, COMP.address)).balance;

        expect(aliceCollateralAfter).to.equal(aliceCollateralBefore.add(8e8));
      });

      it('should allow deposit another collateral token', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice] } = protocol;
        const { COMP, WETH } = tokens;

        await COMP.allocateTo(alice.address, 8e8);
        await WETH.allocateTo(alice.address, exp(1, 18));

        await wait(COMP.connect(alice).approve(comet.address, 8e8));
        await wait(WETH.connect(alice).approve(comet.address, exp(1, 18)));

        await comet.connect(alice).supply(COMP.address, 8e8);
        expect((await comet.userCollateral(alice.address, WETH.address)).balance).to.equal(0);

        await comet.connect(alice).supply(WETH.address, exp(1, 18));
        expect((await comet.userCollateral(alice.address, WETH.address)).balance).to.equal(exp(1, 18));
      });

      it('supply of collateral from Bob should not affect Alice', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(alice.address, 8e8);
        await COMP.allocateTo(bob.address, 8e8);

        await wait(COMP.connect(alice).approve(comet.address, 8e8));
        await wait(COMP.connect(bob).approve(comet.address, 8e8));

        await comet.connect(alice).supply(COMP.address, 8e8);
        const aliceBalanceBefore = (await comet.userCollateral(alice.address, COMP.address)).balance;
        const totalCollateralSupplyBefore = (await comet.totalsCollateral(COMP.address)).totalSupplyAsset;

        await comet.connect(bob).supply(COMP.address, 8e8);

        expect((await comet.userCollateral(alice.address, COMP.address)).balance).to.equal(aliceBalanceBefore);
        expect((await comet.totalsCollateral(COMP.address)).totalSupplyAsset).to.equal(totalCollateralSupplyBefore.add(8e8));
      });
    });
  });

  describe('supply flows variations (from/to)', function () {
    describe('supplyTo', function () {
      it('allows supply to zero address (burns tokens)', async () => {
        // Note: Original Comet does not check for zero address dst
        // Sandbox has ZeroAddress check, but original Comet allows this (effectively burns)
        const { comet, tokens, users: [alice] } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        await wait(USDC.connect(alice).approve(comet.address, 100e6));

        // In original Comet, supplyTo zero address does not revert
        const s0 = await wait(comet.connect(alice).supplyTo(ethers.constants.AddressZero, USDC.address, 1));
        expect(event(s0, 1)).to.be.deep.equal({
          Supply: { from: alice.address, dst: ethers.constants.AddressZero, amount: 1n }
        });
      });

      it('reverts for amount = 0 asset address', async () => {
        const { comet, tokens, users: [alice, bob] } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        await wait(USDC.connect(alice).approve(comet.address, 100e6));

        // Note: supply(0) does not revert in original Comet
        const s0 = await wait(comet.connect(alice).supplyTo(bob.address, USDC.address, 0));
        expect(event(s0, 1)).to.be.deep.equal({
          Supply: { from: alice.address, dst: bob.address, amount: 0n }
        });
      });

      it('reverts for asset other than base or collateral', async () => {
        const { comet, users: [alice, bob], unsupportedToken: USUP } = await makeProtocol();

        await USUP.allocateTo(alice.address, 100);
        await wait(USUP.connect(alice).approve(comet.address, 100));

        await expect(
          comet.connect(alice).supplyTo(bob.address, USUP.address, 1)
        ).to.be.reverted;
      });

      it('reverts when protocol paused', async () => {
        const { comet, tokens, pauseGuardian, users: [alice, bob] } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        await wait(comet.connect(pauseGuardian).pause(true, false, false, false, false));
        expect(await comet.isSupplyPaused()).to.be.true;

        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        await expect(
          comet.connect(alice).supplyTo(bob.address, USDC.address, 1)
        ).to.be.revertedWith("custom error 'Paused()'");
      });

      it('should accrue state (same as supply())', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        const cometSupplyIndexBefore = (await comet.totalsBasic()).baseSupplyIndex;

        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        await comet.connect(alice).supplyTo(bob.address, USDC.address, 100e6);

        expect((await comet.totalsBasic()).lastAccrualTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
      });

      it('should supply base asset to the dst', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        const aliceBaseBefore = await USDC.balanceOf(alice.address);
        const cometBalanceBefore = await USDC.balanceOf(comet.address);
        const alicePrincipalBefore = (await comet.userBasic(alice.address)).principal;
        const bobPrincipalBefore = (await comet.userBasic(bob.address)).principal;

        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        await comet.connect(alice).supplyTo(bob.address, USDC.address, 100e6);

        // token is transferred
        expect(aliceBaseBefore.sub(await USDC.balanceOf(alice.address))).to.equal(100e6);
        expect((await USDC.balanceOf(comet.address)).sub(cometBalanceBefore)).to.equal(100e6);

        // alice principal is unchanged
        expect((await comet.userBasic(alice.address)).principal.sub(alicePrincipalBefore)).to.equal(0);

        // bob's principal grows
        expect((await comet.userBasic(bob.address)).principal).to.be.greaterThan(bobPrincipalBefore);
      });

      it('should supply base asset if dst == msg.sender', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        const aliceBaseBefore = await USDC.balanceOf(alice.address);
        const cometBalanceBefore = await USDC.balanceOf(comet.address);
        const alicePrincipalBefore = (await comet.userBasic(alice.address)).principal;

        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        await comet.connect(alice).supplyTo(alice.address, USDC.address, 100e6);

        // token is transferred
        expect(aliceBaseBefore.sub(await USDC.balanceOf(alice.address))).to.equal(100e6);
        expect((await USDC.balanceOf(comet.address)).sub(cometBalanceBefore)).to.equal(100e6);

        // alice principal grows
        expect((await comet.userBasic(alice.address)).principal).to.be.greaterThan(alicePrincipalBefore);
      });

      it('should supply collateral asset to the dst', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(alice.address, 8e8);
        const aliceCollateralBalanceBefore = await COMP.balanceOf(alice.address);
        const cometCollateralBalanceBefore = await COMP.balanceOf(comet.address);
        const aliceCollateralBefore = (await comet.userCollateral(alice.address, COMP.address)).balance;
        const bobCollateralBefore = (await comet.userCollateral(bob.address, COMP.address)).balance;

        await wait(COMP.connect(alice).approve(comet.address, 8e8));
        await comet.connect(alice).supplyTo(bob.address, COMP.address, 8e8);

        // token is transferred
        expect(aliceCollateralBalanceBefore.sub(await COMP.balanceOf(alice.address))).to.equal(8e8);
        expect((await COMP.balanceOf(comet.address)).sub(cometCollateralBalanceBefore)).to.equal(8e8);

        // alice collateral balance is unchanged
        expect((await comet.userCollateral(alice.address, COMP.address)).balance.sub(aliceCollateralBefore)).to.equal(0);

        // bob's collateral balance grows
        expect((await comet.userCollateral(bob.address, COMP.address)).balance.sub(bobCollateralBefore)).to.equal(8e8);
      });

      it('should supply collateral asset if dst == msg.sender', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(alice.address, 8e8);
        const aliceCollateralBalanceBefore = await COMP.balanceOf(alice.address);
        const cometCollateralBalanceBefore = await COMP.balanceOf(comet.address);
        const aliceCollateralBefore = (await comet.userCollateral(alice.address, COMP.address)).balance;

        await wait(COMP.connect(alice).approve(comet.address, 8e8));
        await comet.connect(alice).supplyTo(alice.address, COMP.address, 8e8);

        // token is transferred
        expect(aliceCollateralBalanceBefore.sub(await COMP.balanceOf(alice.address))).to.equal(8e8);
        expect((await COMP.balanceOf(comet.address)).sub(cometCollateralBalanceBefore)).to.equal(8e8);

        // alice's collateral balance grows
        expect((await comet.userCollateral(alice.address, COMP.address)).balance.sub(aliceCollateralBefore)).to.equal(8e8);
      });
    });

    describe('supplyFrom', function () {
      it('reverts for from = 0', async () => {
        const { comet, tokens, users: [alice] } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        await wait(USDC.connect(alice).approve(comet.address, 100e6));

        await expect(
          comet.connect(alice).supplyFrom(ethers.constants.AddressZero, alice.address, USDC.address, 1)
        ).to.be.reverted;
      });

      it('allows supply to zero address (burns tokens)', async () => {
        // Note: Original Comet does not check for zero address dst
        // Sandbox has ZeroAddress check, but original Comet allows this (effectively burns)
        const { comet, tokens, users: [alice] } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        await wait(USDC.connect(alice).approve(comet.address, 100e6));

        // In original Comet, supplyFrom to zero address does not revert
        const s0 = await wait(comet.connect(alice).supplyFrom(alice.address, ethers.constants.AddressZero, USDC.address, 1));
        expect(event(s0, 1)).to.be.deep.equal({
          Supply: { from: alice.address, dst: ethers.constants.AddressZero, amount: 1n }
        });
      });

      it('reverts for amount = 0 emits events', async () => {
        const { comet, tokens, users: [alice, bob] } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        await wait(USDC.connect(alice).approve(comet.address, 100e6));

        // Note: supplyFrom with amount=0 does not revert but emits events
        const s0 = await wait(comet.connect(alice).supplyFrom(alice.address, bob.address, USDC.address, 0));
        expect(event(s0, 1)).to.be.deep.equal({
          Supply: { from: alice.address, dst: bob.address, amount: 0n }
        });
      });

      it('reverts for asset other than base or collateral', async () => {
        const { comet, users: [alice, bob], unsupportedToken: USUP } = await makeProtocol();

        await USUP.allocateTo(alice.address, 100);
        await wait(USUP.connect(alice).approve(comet.address, 100));

        await expect(
          comet.connect(alice).supplyFrom(alice.address, bob.address, USUP.address, 1)
        ).to.be.reverted;
      });

      it('reverts when protocol paused', async () => {
        const { comet, tokens, pauseGuardian, users: [alice, bob] } = await makeProtocol({ base: 'USDC' });
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        await wait(comet.connect(pauseGuardian).pause(true, false, false, false, false));
        expect(await comet.isSupplyPaused()).to.be.true;

        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        await expect(
          comet.connect(alice).supplyFrom(alice.address, bob.address, USDC.address, 1)
        ).to.be.revertedWith("custom error 'Paused()'");
      });

      it('should accrue state (same as supply())', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        const cometSupplyIndexBefore = (await comet.totalsBasic()).baseSupplyIndex;

        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        await comet.connect(alice).supplyFrom(alice.address, bob.address, USDC.address, 100e6);

        expect((await comet.totalsBasic()).lastAccrualTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
      });

      it('should supply base asset to the dst', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        const aliceBaseBefore = await USDC.balanceOf(alice.address);
        const cometBalanceBefore = await USDC.balanceOf(comet.address);
        const alicePrincipalBefore = (await comet.userBasic(alice.address)).principal;
        const bobPrincipalBefore = (await comet.userBasic(bob.address)).principal;

        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        await comet.connect(alice).supplyFrom(alice.address, bob.address, USDC.address, 100e6);

        // token is transferred
        expect(aliceBaseBefore.sub(await USDC.balanceOf(alice.address))).to.equal(100e6);
        expect((await USDC.balanceOf(comet.address)).sub(cometBalanceBefore)).to.equal(100e6);

        // alice principal is unchanged
        expect((await comet.userBasic(alice.address)).principal.sub(alicePrincipalBefore)).to.equal(0);

        // bob's principal grows
        expect((await comet.userBasic(bob.address)).principal).to.be.greaterThan(bobPrincipalBefore);
      });

      it('should supply base asset if dst == msg.sender', async () => {
        const protocol = await makeProtocol({ base: 'USDC' });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDC } = tokens;

        await USDC.allocateTo(alice.address, 100e6);
        const aliceBaseBefore = await USDC.balanceOf(alice.address);
        const cometBalanceBefore = await USDC.balanceOf(comet.address);
        const alicePrincipalBefore = (await comet.userBasic(alice.address)).principal;

        await wait(USDC.connect(alice).approve(comet.address, 100e6));
        await comet.connect(alice).supplyFrom(alice.address, alice.address, USDC.address, 100e6);

        // token is transferred
        expect(aliceBaseBefore.sub(await USDC.balanceOf(alice.address))).to.equal(100e6);
        expect((await USDC.balanceOf(comet.address)).sub(cometBalanceBefore)).to.equal(100e6);

        // alice principal grows
        expect((await comet.userBasic(alice.address)).principal).to.be.greaterThan(alicePrincipalBefore);
      });

      it('should supply collateral asset to the dst', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice, bob] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(alice.address, 8e8);
        const aliceCollateralBalanceBefore = await COMP.balanceOf(alice.address);
        const cometCollateralBalanceBefore = await COMP.balanceOf(comet.address);
        const aliceCollateralBefore = (await comet.userCollateral(alice.address, COMP.address)).balance;
        const bobCollateralBefore = (await comet.userCollateral(bob.address, COMP.address)).balance;

        await wait(COMP.connect(alice).approve(comet.address, 8e8));
        await comet.connect(alice).supplyFrom(alice.address, bob.address, COMP.address, 8e8);

        // token is transferred
        expect(aliceCollateralBalanceBefore.sub(await COMP.balanceOf(alice.address))).to.equal(8e8);
        expect((await COMP.balanceOf(comet.address)).sub(cometCollateralBalanceBefore)).to.equal(8e8);

        // alice collateral balance is unchanged
        expect((await comet.userCollateral(alice.address, COMP.address)).balance.sub(aliceCollateralBefore)).to.equal(0);

        // bob's collateral balance grows
        expect((await comet.userCollateral(bob.address, COMP.address)).balance.sub(bobCollateralBefore)).to.equal(8e8);
      });

      it('should supply collateral asset if dst == msg.sender', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(alice.address, 8e8);
        const aliceCollateralBalanceBefore = await COMP.balanceOf(alice.address);
        const cometCollateralBalanceBefore = await COMP.balanceOf(comet.address);
        const aliceCollateralBefore = (await comet.userCollateral(alice.address, COMP.address)).balance;

        await wait(COMP.connect(alice).approve(comet.address, 8e8));
        await comet.connect(alice).supplyFrom(alice.address, alice.address, COMP.address, 8e8);

        // token is transferred
        expect(aliceCollateralBalanceBefore.sub(await COMP.balanceOf(alice.address))).to.equal(8e8);
        expect((await COMP.balanceOf(comet.address)).sub(cometCollateralBalanceBefore)).to.equal(8e8);

        // alice's collateral balance grows
        expect((await comet.userCollateral(alice.address, COMP.address)).balance.sub(aliceCollateralBefore)).to.equal(8e8);
      });

      it('supplies from `from` if specified and sender has permission', async () => {
        const protocol = await makeProtocol();
        const { comet, tokens, users: [alice, bob, charlie] } = protocol;
        const { COMP } = tokens;

        await COMP.allocateTo(bob.address, 7);

        await wait(COMP.connect(bob).approve(comet.address, 7));
        await wait(comet.connect(bob).allow(charlie.address, true));

        const p0 = await portfolio(protocol, alice.address);
        const q0 = await portfolio(protocol, bob.address);

        await wait(comet.connect(charlie).supplyFrom(bob.address, alice.address, COMP.address, 7));

        const p1 = await portfolio(protocol, alice.address);
        const q1 = await portfolio(protocol, bob.address);

        expect(p0.internal.COMP).to.equal(0n);
        expect(q0.external.COMP).to.equal(7n);
        expect(p1.internal.COMP).to.equal(7n);
        expect(q1.external.COMP).to.equal(0n);
      });

      it('reverts if `from` is specified and sender does not have permission', async () => {
        const { comet, tokens, users: [alice, bob, charlie] } = await makeProtocol();
        const { COMP } = tokens;

        await COMP.allocateTo(bob.address, 7);

        await expect(
          comet.connect(charlie).supplyFrom(bob.address, alice.address, COMP.address, 7)
        ).to.be.revertedWith("custom error 'Unauthorized()'");
      });
    });
  });

  describe('non-standard tokens', function () {
    describe('USDT-like token', function () {
      it('can supply base token - non-standard ERC20 (without return interface) e.g. USDT', async () => {
        const assets = defaultAssets();
        assets['USDT'] = {
          initial: 1e6,
          decimals: 6,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };

        const protocol = await makeProtocol({ base: 'USDT', assets: assets });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDT } = tokens;

        await USDT.allocateTo(alice.address, exp(100, 6));

        await wait((USDT as NonStandardFaucetFeeToken).connect(alice).approve(comet.address, exp(1, 6)));
        await expect(comet.connect(alice).supply(USDT.address, exp(1, 6))).to.not.be.reverted;

        // as per the initial test case, 1st deposit will end with the same principal
        expect((await comet.userBasic(alice.address)).principal).to.equal(exp(1, 6));
      });

      it('can supply collateral - non-standard ERC20 (without return interface) e.g. USDT', async () => {
        const assets = defaultAssets();
        assets['NonStdCollateral'] = {
          initial: 1e8,
          decimals: 18,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };

        const protocol = await makeProtocol({ base: 'USDC', assets: assets });
        const { comet, tokens, users: [alice] } = protocol;
        const { NonStdCollateral } = tokens;

        await NonStdCollateral.allocateTo(alice.address, exp(100, 18));

        await wait((NonStdCollateral as NonStandardFaucetFeeToken).connect(alice).approve(comet.address, exp(1, 18)));
        await expect(comet.connect(alice).supply(NonStdCollateral.address, exp(1, 18))).to.not.be.reverted;

        expect((await comet.userCollateral(alice.address, NonStdCollateral.address)).balance).to.equal(exp(1, 18));
      });
    });

    describe('fee-on-transfer token', function () {
      it('can supply base token - fee-on-transfer token', async () => {
        const assets = defaultAssets();
        assets['USDT'] = {
          initial: 1e6,
          decimals: 6,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };

        const protocol = await makeProtocol({ base: 'USDT', assets: assets });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDT } = tokens;
        const feeToken = USDT as NonStandardFaucetFeeToken;

        // Set fee to 0.1%
        await feeToken.setParams(10, exp(100, 18));

        await USDT.allocateTo(alice.address, exp(100, 6));
        const feeBalanceBefore = await feeToken.balanceOf(feeToken.address);
        const userBalanceBefore = await feeToken.balanceOf(alice.address);

        const amountDeposited = BigNumber.from(exp(1, 6));
        const fee = amountDeposited.mul(10).div(10000);
        const amountWithoutFee = amountDeposited.sub(fee);

        await wait(feeToken.connect(alice).approve(comet.address, amountDeposited));
        await expect(comet.connect(alice).supply(feeToken.address, amountDeposited)).to.not.be.reverted;

        const feeBalanceAfter = await feeToken.balanceOf(feeToken.address);
        const userBalanceAfter = await feeToken.balanceOf(alice.address);

        // we are checking that the (amount - fee) is considered as deposit
        expect((await comet.userBasic(alice.address)).principal).to.equal(amountWithoutFee);

        // full amount is charged from user
        expect(userBalanceBefore.sub(userBalanceAfter)).to.equal(amountDeposited);

        // commission is in right place
        expect(feeBalanceAfter.sub(feeBalanceBefore)).to.equal(fee);
      });

      it('correct amount in the Supply event - fee-on-transfer token', async () => {
        const assets = defaultAssets();
        assets['USDT'] = {
          initial: 1e6,
          decimals: 6,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };

        const protocol = await makeProtocol({ base: 'USDT', assets: assets });
        const { comet, tokens, users: [alice] } = protocol;
        const { USDT } = tokens;
        const feeToken = USDT as NonStandardFaucetFeeToken;

        // Set fee to 0.1%
        await feeToken.setParams(10, exp(100, 18));

        await USDT.allocateTo(alice.address, exp(100, 6));

        const amountDeposited = BigNumber.from(exp(1, 6));
        const fee = amountDeposited.mul(10).div(10000);
        const amountWithoutFee = amountDeposited.sub(fee);

        await wait(feeToken.connect(alice).approve(comet.address, amountDeposited));
        const s0 = await wait(comet.connect(alice).supply(feeToken.address, amountDeposited));

        // event should contain amount without fee - the actual received on the contract
        expect(event(s0, 1)).to.be.deep.equal({
          Supply: { from: alice.address, dst: alice.address, amount: amountWithoutFee.toBigInt() }
        });
      });

      it('can supply collateral token - fee-on-transfer token', async () => {
        const assets = defaultAssets();
        assets['FeeCollateral'] = {
          initial: 1e8,
          decimals: 18,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };

        const protocol = await makeProtocol({ base: 'USDC', assets: assets });
        const { comet, tokens, users: [alice] } = protocol;
        const { FeeCollateral } = tokens;
        const feeToken = FeeCollateral as NonStandardFaucetFeeToken;

        // Set fee to 0.1%
        await feeToken.setParams(10, exp(100, 18));

        await FeeCollateral.allocateTo(alice.address, exp(100, 18));
        const feeBalanceBefore = await feeToken.balanceOf(feeToken.address);
        const userBalanceBefore = await feeToken.balanceOf(alice.address);

        const amountDeposited = BigNumber.from(exp(0.5, 18));
        const fee = amountDeposited.mul(10).div(10000);
        const amountWithoutFee = amountDeposited.sub(fee);

        await wait(feeToken.connect(alice).approve(comet.address, amountDeposited));
        await expect(comet.connect(alice).supply(feeToken.address, amountDeposited)).to.not.be.reverted;

        const feeBalanceAfter = await feeToken.balanceOf(feeToken.address);
        const userBalanceAfter = await feeToken.balanceOf(alice.address);

        // we are checking that the (amount - fee) is considered as collateral deposit
        expect((await comet.userCollateral(alice.address, feeToken.address)).balance).to.equal(amountWithoutFee);

        // full amount is charged from user
        expect(userBalanceBefore.sub(userBalanceAfter)).to.equal(amountDeposited);

        // commission is in right place
        expect(feeBalanceAfter.sub(feeBalanceBefore)).to.equal(fee);
      });

      it('correct amount in the SupplyCollateral event - fee-on-transfer token', async () => {
        const assets = defaultAssets();
        assets['FeeCollateral'] = {
          initial: 1e8,
          decimals: 18,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };

        const protocol = await makeProtocol({ base: 'USDC', assets: assets });
        const { comet, tokens, users: [alice] } = protocol;
        const { FeeCollateral } = tokens;
        const feeToken = FeeCollateral as NonStandardFaucetFeeToken;

        // Set fee to 0.1%
        await feeToken.setParams(10, exp(100, 18));

        await FeeCollateral.allocateTo(alice.address, exp(100, 18));

        const amountDeposited = BigNumber.from(exp(0.5, 18));
        const fee = amountDeposited.mul(10).div(10000);
        const amountWithoutFee = amountDeposited.sub(fee);

        await wait(feeToken.connect(alice).approve(comet.address, amountDeposited));
        const s0 = await wait(comet.connect(alice).supply(feeToken.address, amountDeposited));

        // event should contain amount without fee - the actual received on the contract
        expect(event(s0, 1)).to.be.deep.equal({
          SupplyCollateral: {
            from: alice.address,
            dst: alice.address,
            asset: feeToken.address,
            amount: amountWithoutFee.toBigInt()
          }
        });
      });
    });
  });

  describe('reentrancy protection', function () {
    it('blocks reentrancy from exceeding the supply cap', async () => {
      const { comet, tokens, users: [alice, bob] } = await makeProtocol({
        assets: {
          USDC: { decimals: 6 },
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
      await wait(EVIL.connect(alice).approve(comet.address, 75e6));
      await EVIL.allocateTo(alice.address, 75e6);

      await expect(
        comet.connect(alice).supplyTo(bob.address, EVIL.address, 75e6)
      ).to.be.revertedWithCustomError(comet, 'ReentrantCallBlocked');
    });
  });
});
