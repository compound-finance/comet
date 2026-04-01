import { ethers, expect, exp, makeProtocol, defaultAssets, ReentryAttack, setTotalsBasic, fastForward, baseBalanceOf, takeSnapshot, SnapshotRestorer, MAX_ASSETS } from './helpers';
import { EvilToken, EvilToken__factory, NonStandardFaucetFeeToken__factory, NonStandardFaucetFeeToken, CometHarnessInterface, FaucetToken, CometHarnessInterfaceExtendedAssetList, SimplePriceFeed } from '../build/types';
import { BigNumber, ContractTransaction } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

describe('withdraw', function () {
  const baseTokenDecimals = 6;

  let comet: CometHarnessInterfaceExtendedAssetList;
  let baseToken: FaucetToken;
  let collaterals: { [symbol: string]: FaucetToken };
  let priceFeeds: { [symbol: string]: SimplePriceFeed };
  let unsupportedToken: FaucetToken;

  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let pauseGuardian: SignerWithAddress;

  let baseSnapshot: SnapshotRestorer;

  before(async function () {
    const protocol = await makeProtocol({ base: 'USDC' });

    comet = protocol.cometWithExtendedAssetList;
    baseToken = protocol.tokens[protocol.base] as FaucetToken;
    collaterals = Object.fromEntries(
      Object.entries(protocol.tokens).filter(([_symbol, token]) => token.address !== baseToken.address)
    ) as { [symbol: string]: FaucetToken };
    priceFeeds = protocol.priceFeeds;
    pauseGuardian = protocol.pauseGuardian;
    unsupportedToken = protocol.unsupportedToken;

    alice = protocol.users[0];
    bob = protocol.users[1];

    await baseToken.allocateTo(alice.address, exp(1e10, baseTokenDecimals));
    await baseToken.allocateTo(bob.address, exp(1e10, baseTokenDecimals));

    baseSnapshot = await takeSnapshot();
  });

  describe('withdraw base asset', function () {
    describe('reverts', function () {
      const COLLATERAL_AMOUNT = exp(100, 6);
      const SUPPLY_AMOUNT = exp(100, 6);
      const BORROW_AMOUNT = exp(80, 6);
      const COLLATERAL_SUPPLY = exp(1, 18);

      it('reverts if withdraw is paused', async () => {
        await comet.connect(pauseGuardian).pause(false, false, true, false, false);
        expect(await comet.isWithdrawPaused()).to.be.true;

        await expect(comet.connect(alice).withdraw(baseToken.address, 1)).to.be.revertedWithCustomError(comet, 'Paused');
        await comet.connect(pauseGuardian).pause(false, false, false, false, false);
      });

      it('reverts if withdrawing more than available liquidity', async () => {
        const snapshot = await takeSnapshot();
        
        await baseToken.connect(alice).approve(comet.address, SUPPLY_AMOUNT);
        await comet.connect(alice).supply(baseToken.address, SUPPLY_AMOUNT);

        await collaterals['WETH'].allocateTo(bob.address, COLLATERAL_SUPPLY);
        await collaterals['WETH'].connect(bob).approve(comet.address, COLLATERAL_SUPPLY);
        await comet.connect(bob).supply(collaterals['WETH'].address, COLLATERAL_SUPPLY);
        await comet.connect(bob).withdraw(baseToken.address, BORROW_AMOUNT);

        await expect(
          comet.connect(alice).withdraw(baseToken.address, SUPPLY_AMOUNT)
        ).to.be.revertedWith('ERC20: transfer amount exceeds balance');
        
        await snapshot.restore();
      });

      it('reverts if withdraw max for a collateral asset', async () => {
        const snapshot = await takeSnapshot();
        
        const collateral = collaterals['COMP'];
        await collateral.allocateTo(bob.address, COLLATERAL_AMOUNT);

        await expect(
          comet.connect(bob).withdraw(collateral.address, ethers.constants.MaxUint256)
        ).to.be.revertedWithCustomError(comet, 'InvalidUInt128');
        
        await snapshot.restore();
      });

      it('reverts if asset is neither collateral nor base (arithmetic underflow)', async () => {
        await expect(
          comet.connect(alice).withdraw(unsupportedToken.address, 1)
        ).to.be.revertedWithPanic(0x11); // Arithmetic underflow
      });

      it('reverts if borrow amount exceeds collateral backing', async () => {
        await expect(
          comet.connect(alice).withdraw(baseToken.address, exp(1000, baseTokenDecimals))
        ).to.be.revertedWithCustomError(comet, 'NotCollateralized');
      });

      it('reverts if lender withdraw is paused (extended pause)', async () => {
        const snapshot = await takeSnapshot();

        await baseToken.connect(bob).approve(comet.address, exp(100, baseTokenDecimals));
        await comet.connect(bob).supply(baseToken.address, exp(100, baseTokenDecimals));

        await comet.connect(pauseGuardian).pauseLendersWithdraw(true);
        expect(await comet.isLendersWithdrawPaused()).to.be.true;

        await expect(
          comet.connect(bob).withdraw(baseToken.address, exp(50, baseTokenDecimals))
        ).to.be.revertedWithCustomError(comet, 'LendersWithdrawPaused');

        await comet.connect(pauseGuardian).pauseLendersWithdraw(false);
        await snapshot.restore();
      });
    });

    describe('withdraw base: happy path', function () {
      const SUPPLY_AMOUNT: bigint = exp(100, baseTokenDecimals);
      let withdrawTx: ContractTransaction;
      let bobTokenBalanceBefore: bigint;
      let bobCometBalanceBefore: bigint;
      let totalSupplyBaseBefore: bigint;

      before(async () => {
        await baseSnapshot.restore();
        
        await baseToken.connect(bob).approve(comet.address, SUPPLY_AMOUNT);
        await comet.connect(bob).supply(baseToken.address, SUPPLY_AMOUNT);

        bobTokenBalanceBefore = (await baseToken.balanceOf(bob.address)).toBigInt();
        bobCometBalanceBefore = (await comet.balanceOf(bob.address)).toBigInt();
        totalSupplyBaseBefore = (await comet.totalsBasic()).totalSupplyBase.toBigInt();

        withdrawTx = await comet.connect(bob).withdraw(baseToken.address, SUPPLY_AMOUNT);
      });

      it('bob comet balance before withdraw equals supply amount', async () => {
        expect(bobCometBalanceBefore).to.equal(SUPPLY_AMOUNT);
      });

      it('total supply base before withdraw equals supply amount', async () => {
        expect(totalSupplyBaseBefore).to.equal(SUPPLY_AMOUNT);
      });

      it('withdraw tx does not revert', async () => {
        await expect(withdrawTx).to.not.be.reverted;
      });

      it('emits Transfer event (ERC20)', async () => {
        await expect(withdrawTx)
          .to.emit(baseToken, 'Transfer')
          .withArgs(comet.address, bob.address, SUPPLY_AMOUNT);
      });

      it('emits Withdraw event', async () => {
        await expect(withdrawTx)
          .to.emit(comet, 'Withdraw')
          .withArgs(bob.address, bob.address, SUPPLY_AMOUNT);
      });

      it('emits Transfer event (Comet burn)', async () => {
        await expect(withdrawTx)
          .to.emit(comet, 'Transfer')
          .withArgs(bob.address, ethers.constants.AddressZero, SUPPLY_AMOUNT);
      });

      it('bob comet balance is zero after full withdrawal', async () => {
        expect(await comet.balanceOf(bob.address)).to.equal(0);
      });

      it('bob receives withdrawn tokens', async () => {
        expect(await baseToken.balanceOf(bob.address)).to.equal(bobTokenBalanceBefore + SUPPLY_AMOUNT);
      });

      it('total supply base is zero after full withdrawal', async () => {
        expect((await comet.totalsBasic()).totalSupplyBase).to.equal(0n);
      });

      it('total borrow base is zero', async () => {
        expect((await comet.totalsBasic()).totalBorrowBase).to.equal(0n);
      });

      it('gas used is within limit', async () => {
        const receipt = await withdrawTx.wait();
        expect(Number(receipt.gasUsed)).to.be.lessThan(106000);
      });
    });

    describe('max withdraw + full accrued balance', function () {
      const BOB_SUPPLY_AMOUNT = exp(100, 6);
      const ALICE_COLLATERAL_AMOUNT = exp(10, 18);
      const ALICE_BORROW_AMOUNT = exp(50, 6);
      const TIME_FORWARD_SECONDS = 86400; // 24 hours

      let accrualSnapshot: SnapshotRestorer;

      before(async () => {
        await baseSnapshot.restore();

        await baseToken.connect(bob).approve(comet.address, BOB_SUPPLY_AMOUNT);
        await comet.connect(bob).supply(baseToken.address, BOB_SUPPLY_AMOUNT);

        await collaterals['WETH'].allocateTo(alice.address, ALICE_COLLATERAL_AMOUNT);
        await collaterals['WETH'].connect(alice).approve(comet.address, ALICE_COLLATERAL_AMOUNT);
        await comet.connect(alice).supply(collaterals['WETH'].address, ALICE_COLLATERAL_AMOUNT);
        await comet.connect(alice).withdraw(baseToken.address, ALICE_BORROW_AMOUNT);

        accrualSnapshot = await takeSnapshot();
      });

      describe('withdraw max base with accrued interest', function () {
        let withdrawTx: ContractTransaction;
        let bobAccruedBalance: bigint;
        let aliceBalanceBefore: bigint;

        before(async () => {
          await accrualSnapshot.restore();

          await baseToken.allocateTo(comet.address, exp(60, 6));

          await fastForward(TIME_FORWARD_SECONDS);
          await ethers.provider.send('evm_mine', []);

          bobAccruedBalance = (await comet.callStatic.balanceOf(bob.address)).toBigInt();
          aliceBalanceBefore = (await baseToken.balanceOf(alice.address)).toBigInt();

          withdrawTx = await comet.connect(bob).withdrawTo(alice.address, baseToken.address, ethers.constants.MaxUint256);
        });

        it('bob balance after accrual is greater than supplied amount', async () => {
          expect(bobAccruedBalance).to.be.gt(BOB_SUPPLY_AMOUNT);
        });

        it('withdraw tx does not revert', async () => {
          await expect(withdrawTx).to.not.be.reverted;
        });

        it('bob comet balance is zero after max withdrawal', async () => {
          expect(await comet.balanceOf(bob.address)).to.equal(0);
        });

        it('alice receives full accrued balance', async () => {
          expect(await baseToken.balanceOf(alice.address)).to.equal(aliceBalanceBefore + bobAccruedBalance);
        });
      });

      describe('user can withdraw full accrued balance (interest test)', function () {
        let balanceAfterAccrual: bigint;

        before(async () => {
          await accrualSnapshot.restore();

          await fastForward(TIME_FORWARD_SECONDS);
          await ethers.provider.send('evm_mine', []);

          balanceAfterAccrual = (await comet.callStatic.balanceOf(bob.address)).toBigInt();

          await baseToken.allocateTo(alice.address, exp(60, 6));
          await baseToken.connect(alice).approve(comet.address, exp(60, 6));
          await comet.connect(alice).supply(baseToken.address, exp(60, 6));

          await comet.connect(bob).withdraw(baseToken.address, balanceAfterAccrual);
        });

        it('balance after accrual is >= supplied amount', async () => {
          expect(balanceAfterAccrual).to.be.gte(BOB_SUPPLY_AMOUNT);
        });

        it('bob final comet balance is zero', async () => {
          const finalBalance = await comet.callStatic.balanceOf(bob.address);
          expect(finalBalance).to.be.equal(0);
        });
      });

      describe('withdraw to different recipient after interest accrual', function () {
        let balanceAfterAccrual: bigint;

        before(async () => {
          await accrualSnapshot.restore();

          await fastForward(TIME_FORWARD_SECONDS);
          await ethers.provider.send('evm_mine', []);

          balanceAfterAccrual = (await comet.callStatic.balanceOf(bob.address)).toBigInt();

          await baseToken.allocateTo(alice.address, exp(60, 6));
          await baseToken.connect(alice).approve(comet.address, exp(60, 6));
          await comet.connect(alice).supply(baseToken.address, exp(60, 6));
        });

        it('bob accrued balance is >= supplied amount', async () => {
          expect(balanceAfterAccrual).to.be.gte(BOB_SUPPLY_AMOUNT);
        });

        it('alice receives full accrued balance and bob comet balance is zero', async () => {
          const aliceBalanceBefore = await baseToken.balanceOf(alice.address);
          await comet.connect(bob).withdrawTo(alice.address, baseToken.address, balanceAfterAccrual);

          expect(await baseToken.balanceOf(alice.address)).to.equal(aliceBalanceBefore.add(balanceAfterAccrual));
          expect(await comet.balanceOf(bob.address)).to.equal(0);
        });
      });
    });

    describe('withdraw max base with borrow position (edge case)', function () {
      const ALICE_SUPPLY_AMOUNT = exp(200, 6);
      const BOB_COLLATERAL_AMOUNT = exp(1, 18);
      const BOB_BORROW_AMOUNT = exp(100, 6);

      let withdrawTx: ContractTransaction;
      let aliceBalanceBefore: bigint;

      before(async () => {
        await baseSnapshot.restore();

        await baseToken.connect(alice).approve(comet.address, ALICE_SUPPLY_AMOUNT);
        await comet.connect(alice).supply(baseToken.address, ALICE_SUPPLY_AMOUNT);

        await collaterals['WETH'].allocateTo(bob.address, BOB_COLLATERAL_AMOUNT);
        await collaterals['WETH'].connect(bob).approve(comet.address, BOB_COLLATERAL_AMOUNT);
        await comet.connect(bob).supply(collaterals['WETH'].address, BOB_COLLATERAL_AMOUNT);
        await comet.connect(bob).withdraw(baseToken.address, BOB_BORROW_AMOUNT);

        aliceBalanceBefore = (await baseToken.balanceOf(alice.address)).toBigInt();

        withdrawTx = await comet.connect(bob).withdrawTo(alice.address, baseToken.address, ethers.constants.MaxUint256);
      });

      it('emits Transfer event with 0 amount (no tokens transferred)', async () => {
        await expect(withdrawTx)
          .to.emit(baseToken, 'Transfer')
          .withArgs(comet.address, alice.address, 0);
      });

      it('emits Withdraw event with 0 amount', async () => {
        await expect(withdrawTx)
          .to.emit(comet, 'Withdraw')
          .withArgs(bob.address, alice.address, 0);
      });

      it('alice balance unchanged', async () => {
        expect(await baseToken.balanceOf(alice.address)).to.equal(aliceBalanceBefore);
      });

      it('gas used is within limit', async () => {
        const receipt = await withdrawTx.wait();
        expect(Number(receipt.gasUsed)).to.be.lessThan(121000);
      });
    });

    describe('edge cases', function () {
      describe('borrow without base supply (no Transfer burn event)', function () {
        const ALICE_SUPPLY_AMOUNT = exp(110, 6);
        const BOB_COLLATERAL_AMOUNT = exp(1, 18);
        const BORROW_AMOUNT = exp(1, 6);

        let withdrawTx: ContractTransaction;

        before(async () => {
          await baseSnapshot.restore();

          await baseToken.connect(alice).approve(comet.address, ALICE_SUPPLY_AMOUNT);
          await comet.connect(alice).supply(baseToken.address, ALICE_SUPPLY_AMOUNT);

          await collaterals['WETH'].allocateTo(bob.address, BOB_COLLATERAL_AMOUNT);
          await collaterals['WETH'].connect(bob).approve(comet.address, BOB_COLLATERAL_AMOUNT);
          await comet.connect(bob).supply(collaterals['WETH'].address, BOB_COLLATERAL_AMOUNT);

          withdrawTx = await comet.connect(bob).withdrawTo(alice.address, baseToken.address, BORROW_AMOUNT);
        });

        it('emits exactly 2 events (no Transfer burn)', async () => {
          const receipt = await withdrawTx.wait();
          expect(receipt.events.length).to.be.equal(2);
        });

        it('emits Transfer event (ERC20)', async () => {
          await expect(withdrawTx)
            .to.emit(baseToken, 'Transfer')
            .withArgs(comet.address, alice.address, BORROW_AMOUNT);
        });

        it('emits Withdraw event', async () => {
          await expect(withdrawTx)
            .to.emit(comet, 'Withdraw')
            .withArgs(bob.address, alice.address, BORROW_AMOUNT);
        });
      });

      describe('rounding quirk - withdraw 0 emits Transfer of 1 (harness)', function () {
        let withdrawTx: ContractTransaction;

        before(async () => {
          await baseSnapshot.restore();

          // Harness required: This tests a specific rounding edge case where withdrawing 0 tokens
          // causes the principal to round down by 1 due to integer division in presentValue/principalValue.
          // These exact values (principal=99999992291226, index=1000000131467072) were found to
          // trigger this edge case. Cannot be achieved through natural supply/borrow flows.
          await comet.setBasePrincipal(alice.address, 99999992291226);
          await setTotalsBasic(comet, {
            totalSupplyBase: 699999944771920,
            baseSupplyIndex: 1000000131467072,
          });

          withdrawTx = await comet.connect(alice).withdraw(baseToken.address, 0);
        });

        it('emits exactly 3 events', async () => {
          const receipt = await withdrawTx.wait();
          expect(receipt.events.length).to.be.equal(3);
        });

        it('emits Transfer event with 0 amount (ERC20)', async () => {
          await expect(withdrawTx)
            .to.emit(baseToken, 'Transfer')
            .withArgs(comet.address, alice.address, 0);
        });

        it('emits Withdraw event with 0 amount', async () => {
          await expect(withdrawTx)
            .to.emit(comet, 'Withdraw')
            .withArgs(alice.address, alice.address, 0);
        });

        it('emits Transfer burn event with amount 1 (rounding)', async () => {
          await expect(withdrawTx)
            .to.emit(comet, 'Transfer')
            .withArgs(alice.address, ethers.constants.AddressZero, 1);
        });
      });

      describe('withdraw 0 with collateral only position', function () {
        const COLLATERAL_AMOUNT = exp(1, 18);

        it('withdraws 0 base with only collateral position (no base supplied)', async () => {
          await baseSnapshot.restore();
          
          await collaterals['WETH'].allocateTo(alice.address, COLLATERAL_AMOUNT);
          await collaterals['WETH'].connect(alice).approve(comet.address, COLLATERAL_AMOUNT);
          await comet.connect(alice).supply(collaterals['WETH'].address, COLLATERAL_AMOUNT);

          const tx = await comet.connect(alice).withdraw(baseToken.address, 0);

          await expect(tx)
            .to.emit(baseToken, 'Transfer')
            .withArgs(comet.address, alice.address, 0);
        });
      });
    });
  });

  describe('withdraw collateral', function () {
    before(async () => {
      await baseSnapshot.restore();
    });

    describe('reverts', function () {
      const BOB_SUPPLY_AMOUNT = exp(200, 6);
      const ALICE_COLLATERAL_AMOUNT = exp(1, 18);
      const BORROW_AMOUNT = exp(100, 6);
      const COLLATERAL_SUPPLY = exp(1, 18);

      it('reverts if withdraw is paused', async () => {
        await comet.connect(pauseGuardian).pause(false, false, true, false, false);
        expect(await comet.isWithdrawPaused()).to.be.true;

        await expect(comet.connect(alice).withdraw(collaterals['COMP'].address, 1)).to.be.revertedWithCustomError(comet, 'Paused');
        await comet.connect(pauseGuardian).pause(false, false, false, false, false);
      });

      it('reverts if collateral withdraw is paused (extended pause)', async () => {
        await comet.connect(pauseGuardian).pauseCollateralWithdraw(true);
        expect(await comet.isCollateralWithdrawPaused()).to.be.true;

        await expect(
          comet.connect(alice).withdraw(collaterals['COMP'].address, 1)
        ).to.be.revertedWithCustomError(comet, 'CollateralWithdrawPaused');

        await comet.connect(pauseGuardian).pauseCollateralWithdraw(false);
      });

      it('reverts if withdrawing more collateral than supplied', async () => {
        await baseSnapshot.restore();
        
        await collaterals['WETH'].allocateTo(alice.address, COLLATERAL_SUPPLY);
        await collaterals['WETH'].connect(alice).approve(comet.address, COLLATERAL_SUPPLY);
        await comet.connect(alice).supply(collaterals['WETH'].address, COLLATERAL_SUPPLY);
        await expect(
          comet.connect(alice).withdraw(collaterals['WETH'].address, COLLATERAL_SUPPLY + 1n)
        ).to.be.revertedWithPanic(0x11);
      });

      it('reverts if collateral withdraw amount is not collateralized', async () => {
        await baseSnapshot.restore();
        
        await baseToken.connect(bob).approve(comet.address, BOB_SUPPLY_AMOUNT);
        await comet.connect(bob).supply(baseToken.address, BOB_SUPPLY_AMOUNT);

        await collaterals['WETH'].allocateTo(alice.address, ALICE_COLLATERAL_AMOUNT);
        await collaterals['WETH'].connect(alice).approve(comet.address, ALICE_COLLATERAL_AMOUNT);
        await comet.connect(alice).supply(collaterals['WETH'].address, ALICE_COLLATERAL_AMOUNT);
        await comet.connect(alice).withdraw(baseToken.address, BORROW_AMOUNT);

        // alice has 1 WETH as collateral and borrowed 100 USDC
        // Withdrawing all WETH leaves 0 weighted collateral, but debt = 100 USDC ($100)
        // 0 < 100 → NotCollateralized
        await expect(
          comet.connect(alice).withdraw(collaterals['WETH'].address, ALICE_COLLATERAL_AMOUNT)
        ).to.be.revertedWithCustomError(comet, 'NotCollateralized');
      });

      describe('oracle reverts (with borrow position)', function () {
        const ALICE_WETH_SUPPLY = exp(2, 18);
        let oracleSnapshot: SnapshotRestorer;

        before(async () => {
          await baseSnapshot.restore();

          await baseToken.connect(bob).approve(comet.address, BOB_SUPPLY_AMOUNT);
          await comet.connect(bob).supply(baseToken.address, BOB_SUPPLY_AMOUNT);

          await collaterals['WETH'].allocateTo(alice.address, ALICE_WETH_SUPPLY);
          await collaterals['WETH'].connect(alice).approve(comet.address, ALICE_WETH_SUPPLY);
          await comet.connect(alice).supply(collaterals['WETH'].address, ALICE_WETH_SUPPLY);
          await comet.connect(alice).withdraw(baseToken.address, BORROW_AMOUNT);

          oracleSnapshot = await takeSnapshot();
        });

        it('reverts collateral withdraw if collateral oracle returns 0', async () => {
          await priceFeeds.WETH.setRoundData(1, 0, 0, 0, 1);

          await expect(
            comet.connect(alice).withdraw(collaterals['WETH'].address, exp(1, 18))
          ).to.be.revertedWithCustomError(comet, 'BadPrice');
        });

        it('reverts collateral withdraw if base oracle returns 0', async () => {
          await oracleSnapshot.restore();

          await priceFeeds.USDC.setRoundData(1, 0, 0, 0, 1);

          await expect(
            comet.connect(alice).withdraw(collaterals['WETH'].address, exp(1, 18))
          ).to.be.revertedWithCustomError(comet, 'BadPrice');
        });
      });
    });

    describe('withdraw collateral: happy path', function () {
      const COLLATERAL_SUPPLY_AMOUNT: bigint = exp(8, 8);
      // Alice supplies base so totalSupplyBase > baseMinForRewards, enabling trackingSupplyIndex growth
      const ALICE_BASE_SUPPLY: bigint = exp(10000, 6);
      const SKIP_TIME: number = 60 * 60; // 1 hr

      let collateral: FaucetToken;
      let withdrawTx: ContractTransaction;
      let aliceBalanceBefore: typeof ethers.BigNumber.prototype;
      let totalSupplyBefore: typeof ethers.BigNumber.prototype;
      let totalCollateralSupplyBefore: BigNumber;
      let totalSupplyBaseBefore: BigNumber;
      let alicePrincipalBefore: BigNumber;
      let aliceDisplayBalanceBefore: BigNumber;
      let cometSupplyIndexBefore: BigNumber;
      let cometSupplyRateBefore: BigNumber;
      let cometUpdatedTimeBefore: number;
      let cometBorrowIndexBefore: BigNumber;
      let trackingSupplyIndexBefore: BigNumber;
      let trackingBorrowIndexBefore: BigNumber;
      let bobBaseTrackingAccruedBefore: BigNumber;
      let baseTrackingSupplySpeedVal: BigNumber;
      let bobCollateralBalanceBefore: BigNumber;
      let borrowRateBefore: BigNumber;
      let utilizationBefore: BigNumber;
      let withdrawTimestamp: BigNumber;

      before(async () => {
        await baseSnapshot.restore();

        // Supply base tokens so totalSupplyBase >= baseMinForRewards, enabling trackingSupplyIndex growth
        await baseToken.connect(alice).approve(comet.address, ALICE_BASE_SUPPLY);
        await comet.connect(alice).supply(baseToken.address, ALICE_BASE_SUPPLY);

        collateral = collaterals['COMP'];
        await collateral.allocateTo(bob.address, COLLATERAL_SUPPLY_AMOUNT);
        await collateral.connect(bob).approve(comet.address, COLLATERAL_SUPPLY_AMOUNT);
        await comet.connect(bob).supply(collateral.address, COLLATERAL_SUPPLY_AMOUNT);

        aliceBalanceBefore = await collateral.balanceOf(alice.address);
        totalSupplyBefore = (await comet.totalsCollateral(collateral.address)).totalSupplyAsset;
        bobCollateralBalanceBefore = (await comet.userCollateral(bob.address, collateral.address)).balance;
        const totals = await comet.totalsBasic();
        totalCollateralSupplyBefore = (await comet.totalsCollateral(collateral.address)).totalSupplyAsset;
        totalSupplyBaseBefore = totals.totalSupplyBase;
        alicePrincipalBefore = (await comet.userBasic(alice.address)).principal;
        aliceDisplayBalanceBefore = await comet.balanceOf(alice.address);
        cometSupplyIndexBefore = totals.baseSupplyIndex;
        cometSupplyRateBefore = await comet.getSupplyRate(await comet.getUtilization());
        cometUpdatedTimeBefore = totals.lastAccrualTime;

        cometBorrowIndexBefore = totals.baseBorrowIndex;
        trackingSupplyIndexBefore = totals.trackingSupplyIndex;
        trackingBorrowIndexBefore = totals.trackingBorrowIndex;
        utilizationBefore = await comet.getUtilization();
        borrowRateBefore = await comet.getBorrowRate(utilizationBefore);
        baseTrackingSupplySpeedVal = await comet.baseTrackingSupplySpeed();
        const bobBasic = await comet.userBasic(bob.address);
        bobBaseTrackingAccruedBefore = bobBasic.baseTrackingAccrued;

        // Advance time to verify accrual during withdrawal
        await ethers.provider.send('evm_increaseTime', [60 * 60]); // 1 hr
        await ethers.provider.send('evm_mine', []);
      });

      it('alice has no collateral registered before withdrawal', async () => {
        const userData = await comet.userBasic(alice.address);
        expect(userData.assetsIn).to.equal(0);
      });

      it('bob collateral balance before withdraw equals supply amount', async () => {
        expect((await comet.userCollateral(bob.address, collateral.address)).balance).to.equal(COLLATERAL_SUPPLY_AMOUNT);
      });

      it('total supply before withdraw equals supply amount', async () => {
        expect(totalSupplyBefore).to.equal(COLLATERAL_SUPPLY_AMOUNT);
      });

      it('withdraw collateral does not revert', async () => {
        withdrawTx = await comet.connect(bob).withdrawTo(alice.address, collateral.address, COLLATERAL_SUPPLY_AMOUNT);
        expect(withdrawTx).to.not.be.reverted;
      });

      it('emits Transfer event (ERC20)', async () => {
        await expect(withdrawTx)
          .to.emit(collateral, 'Transfer')
          .withArgs(comet.address, alice.address, COLLATERAL_SUPPLY_AMOUNT);
      });

      it('emits WithdrawCollateral event', async () => {
        await expect(withdrawTx)
          .to.emit(comet, 'WithdrawCollateral')
          .withArgs(bob.address, alice.address, collateral.address, COLLATERAL_SUPPLY_AMOUNT);
      });

      it('accrues state during collateral withdrawal', async () => {
        const lastUpdated = (await comet.totalsBasic()).lastAccrualTime;
        const withdrawalTimestamp = BigNumber.from(
          (await ethers.provider.getBlock((await withdrawTx.wait()).blockNumber)).timestamp
        );
        expect(lastUpdated - cometUpdatedTimeBefore).to.be.approximately(SKIP_TIME, 2); // 2 seconds tolerance
        expect(lastUpdated).to.equal(withdrawalTimestamp);
      });

      it('supply index is updated correctly after accrual', async () => {
        const curTime = (await ethers.provider.getBlock('latest')).timestamp;
        const timeElapsed = curTime - cometUpdatedTimeBefore;
        const accruedIndex = cometSupplyIndexBefore.add(
          cometSupplyIndexBefore.mul(cometSupplyRateBefore).mul(timeElapsed).div(exp(1, 18))
        );

        const index = (await comet.totalsBasic()).baseSupplyIndex;
        expect(index).to.equal(accruedIndex);
      });

      it('recipient balance increases by withdrawn amount', async () => {
        expect(await collateral.balanceOf(alice.address)).to.equal(aliceBalanceBefore.add(COLLATERAL_SUPPLY_AMOUNT));
      });

      it('bob collateral balance is zero after full withdrawal', async () => {
        expect((await comet.userCollateral(bob.address, collateral.address)).balance).to.equal(0);
      });

      it('total supply is zero after full withdrawal', async () => {
        const totalsCollateral = await comet.totalsCollateral(collateral.address);
        expect(totalsCollateral.totalSupplyAsset).to.equal(0);
      });

      it('total collateral supply decreases by withdraw amount', async () => {
        const totalCollateralSupplyAfter = (await comet.totalsCollateral(collateral.address)).totalSupplyAsset;

        expect(totalCollateralSupplyBefore.sub(totalCollateralSupplyAfter)).to.equal(COLLATERAL_SUPPLY_AMOUNT);
      });

      it('assetsIn is cleared when collateral balance goes to zero', async () => {
        const collateralIndex = (await comet.getAssetInfoByAddress(collateral.address)).offset;
        const userData = await comet.userBasic(alice.address);
        const offset = 1 << collateralIndex;

        expect(userData.assetsIn & offset).to.equal(0);
      });

      it('alice principal is not changed after collateral withdrawal', async () => {
        expect((await comet.userBasic(alice.address)).principal).to.equal(alicePrincipalBefore);
      });

      it('alice displayed base balance is correct after accrual', async () => {
        const curTime = (await ethers.provider.getBlock('latest')).timestamp;
        const timeElapsed = curTime - cometUpdatedTimeBefore;
        const accruedIndex = cometSupplyIndexBefore.add(
          cometSupplyIndexBefore.mul(cometSupplyRateBefore).mul(timeElapsed).div(exp(1, 18))
        );

        const index = (await comet.totalsBasic()).baseSupplyIndex;
        expect(index).to.equal(accruedIndex);

        const newBalanceFromPrincipal = alicePrincipalBefore.mul(accruedIndex).div(exp(1, 15));
        const newBalance = await comet.balanceOf(alice.address);

        expect(newBalance).to.equal(newBalanceFromPrincipal);
        expect(newBalance).to.be.eq(aliceDisplayBalanceBefore);
      });

      it("comet's total supply base is not changed by collateral withdrawal", async () => {
        expect((await comet.totalsBasic()).totalSupplyBase).to.equal(totalSupplyBaseBefore);
      });

      it("comet's displayed total supply is correct after accrual", async () => {
        const curTime = (await ethers.provider.getBlock('latest')).timestamp;
        const timeElapsed = curTime - cometUpdatedTimeBefore;
        const accruedIndex = cometSupplyIndexBefore.add(
          cometSupplyIndexBefore.mul(cometSupplyRateBefore).mul(timeElapsed).div(exp(1, 18))
        );

        const displayedTotalSupply = await comet.totalSupply();
        const expectedTotalSupply = totalSupplyBaseBefore.mul(accruedIndex).div(exp(1, 15));

        expect(displayedTotalSupply).to.equal(expectedTotalSupply);
      });

      it("bob's collateral balance is decreased by withdrawal", async () => {
        expect(
          (await comet.userCollateral(bob.address, collateral.address)).balance
        ).to.equal(bobCollateralBalanceBefore.sub(COLLATERAL_SUPPLY_AMOUNT));
      });

      it('accrual time is updated after collateral withdrawal', async () => {
        const receipt = await withdrawTx.wait();
        const block = await ethers.provider.getBlock(receipt.blockNumber);
        withdrawTimestamp = BigNumber.from(block.timestamp);
        expect((await comet.totalsBasic()).lastAccrualTime).to.equal(withdrawTimestamp.toNumber());
        expect(withdrawTimestamp.toNumber()).to.be.greaterThan(cometUpdatedTimeBefore);
      });

      it('trackingSupplyIndex grows correctly during collateral withdrawal accrual', async () => {
        // accrueInternal() updates trackingSupplyIndex when totalSupplyBase >= baseMinForRewards:
        //   trackingSupplyIndex += divBaseWei(baseTrackingSupplySpeed * timeElapsed, totalSupplyBase)
        //                        = baseTrackingSupplySpeed * timeElapsed * baseScale / totalSupplyBase
        const timeElapsed = withdrawTimestamp.sub(cometUpdatedTimeBefore);
        const baseScale = exp(1, 6);
        const expectedTrackingSupplyIndex = trackingSupplyIndexBefore.add(
          baseTrackingSupplySpeedVal.mul(timeElapsed).mul(baseScale).div(totalSupplyBaseBefore)
        );
        expect((await comet.totalsBasic()).trackingSupplyIndex).to.equal(expectedTrackingSupplyIndex);
      });

      it('trackingBorrowIndex is unchanged when totalBorrowBase is zero', async () => {
        // accrueInternal() only updates trackingBorrowIndex if totalBorrowBase >= baseMinForRewards
        // With no active borrows, totalBorrowBase = 0 and the condition is not satisfied
        expect((await comet.totalsBasic()).totalBorrowBase).to.be.lessThan(await comet.baseMinForRewards());
        expect((await comet.totalsBasic()).trackingBorrowIndex).to.equal(trackingBorrowIndexBefore);
      });

      it('baseBorrowIndex accrues correctly during collateral withdrawal', async () => {
        // baseBorrowIndex += mulFactor(baseBorrowIndex, borrowRate * timeElapsed)
        //                  = baseBorrowIndex + baseBorrowIndex * borrowRate * timeElapsed / 1e18
        // With no borrows, getBorrowRate returns 0 and the borrow index is unchanged
        const timeElapsed = withdrawTimestamp.sub(cometUpdatedTimeBefore);
        const expectedBaseBorrowIndex = cometBorrowIndexBefore.add(
          cometBorrowIndexBefore.mul(borrowRateBefore).mul(timeElapsed).div(exp(1, 18))
        );
        expect((await comet.totalsBasic()).baseBorrowIndex).to.equal(expectedBaseBorrowIndex);
      });

      it('bob baseTrackingAccrued is unchanged when principal is zero', async () => {
        // accrueAccountInternal(bob) calls updateBasePrincipal(bob, basic, basic.principal).
        // bob.principal = 0 → indexDelta * 0 = 0 → no reward accrual, baseTrackingAccrued stays the same
        const bobBasicAfter = await comet.userBasic(bob.address);
        expect(bobBasicAfter.baseTrackingAccrued).to.equal(bobBaseTrackingAccruedBefore);
      });

      it('utilization after collateral withdrawal matches exact calculation from accrued indices', async () => {
        // getUtilization() = presentValue(borrow) * FACTOR_SCALE / presentValue(supply)
        // = totalBorrowBase * baseBorrowIndex_new / 1e15 * 1e18 / (totalSupplyBase * baseSupplyIndex_new / 1e15)
        const totals = await comet.totalsBasic();
        const totalBorrowPresent = totals.totalBorrowBase.mul(totals.baseBorrowIndex).div(exp(1, 15));
        const totalSupplyPresent = totals.totalSupplyBase.mul(totals.baseSupplyIndex).div(exp(1, 15));
        const expectedUtilization = totalBorrowPresent.mul(exp(1, 18)).div(totalSupplyPresent);
        expect(await comet.getUtilization()).to.equal(expectedUtilization);
      });
    });

    // Tests accrueAccountInternal(bob) when bob has a negative principal (active borrow).
    // Focuses on what differs from zero-borrow happy path: non-zero rates, growing borrow index,
    // and borrow reward accrual via trackingBorrowIndex.
    describe('withdraw collateral: accrual with active borrow (non-zero utilization)', function () {
      const SKIP_TIME = 3600;
      // COMP has 18 decimals; alice supplied 10,000 USDC in happy path → totalSupplyBase = 1e10
      // 10 COMP at $175 = $1750 collateral, borrow $100 USDC → 1% utilization → non-zero rates
      const BOB_COMP_SUPPLY: bigint = exp(10, 18); // 10 COMP (18-decimal token)
      const BOB_BORROW_AMOUNT: bigint = exp(100, 6); // 100 USDC
      const BOB_COMP_WITHDRAW: bigint = exp(1, 18); // withdraw 1 COMP, keep 9 as collateral

      let baseSupplyIndexBefore: BigNumber;
      let baseBorrowIndexBefore: BigNumber;
      let trackingSupplyIndexBefore: BigNumber;
      let trackingBorrowIndexBefore: BigNumber;
      let totalSupplyBaseBefore: BigNumber;
      let totalBorrowBaseBefore: BigNumber;
      let lastAccrualTimeBefore: number;
      let bobPrincipalBefore: BigNumber;
      let bobBaseTrackingIndexBefore: BigNumber;
      let bobBaseTrackingAccruedBefore: BigNumber;
      let baseTrackingBorrowSpeedVal: BigNumber;
      let baseTrackingSupplySpeedVal: BigNumber;
      let trackingIndexScaleVal: BigNumber;
      let supplyRateBefore: BigNumber;
      let borrowRateBefore: BigNumber;
      let utilizationBefore: BigNumber;
      let withdrawCollateralTx: ContractTransaction;
      let withdrawTimestamp: BigNumber;

      before(async function () {
        // Build on state from previous describe: alice has 10,000 USDC in comet, totalBorrowBase = 0
        const compCollateral = collaterals['COMP'];
        await compCollateral.allocateTo(bob.address, BOB_COMP_SUPPLY);
        await compCollateral.connect(bob).approve(comet.address, BOB_COMP_SUPPLY);
        await comet.connect(bob).supply(compCollateral.address, BOB_COMP_SUPPLY);

        // Bob borrows base, making his principal negative and creating non-zero utilization
        await comet.connect(bob).withdraw(baseToken.address, BOB_BORROW_AMOUNT);

        const totals = await comet.totalsBasic();
        baseSupplyIndexBefore = totals.baseSupplyIndex;
        baseBorrowIndexBefore = totals.baseBorrowIndex;
        trackingSupplyIndexBefore = totals.trackingSupplyIndex;
        trackingBorrowIndexBefore = totals.trackingBorrowIndex;
        totalSupplyBaseBefore = totals.totalSupplyBase;
        totalBorrowBaseBefore = totals.totalBorrowBase;
        lastAccrualTimeBefore = totals.lastAccrualTime;

        const bobBasic = await comet.userBasic(bob.address);
        bobPrincipalBefore = bobBasic.principal;
        bobBaseTrackingIndexBefore = bobBasic.baseTrackingIndex;
        bobBaseTrackingAccruedBefore = bobBasic.baseTrackingAccrued;

        utilizationBefore = await comet.getUtilization();
        supplyRateBefore = await comet.getSupplyRate(utilizationBefore);
        borrowRateBefore = await comet.getBorrowRate(utilizationBefore);
        baseTrackingSupplySpeedVal = await comet.baseTrackingSupplySpeed();
        baseTrackingBorrowSpeedVal = await comet.baseTrackingBorrowSpeed();
        trackingIndexScaleVal = await comet.trackingIndexScale();

        await ethers.provider.send('evm_increaseTime', [SKIP_TIME]);
        await ethers.provider.send('evm_mine', []);
      });

      it('bob principal is negative (active borrow)', async () => {
        expect(bobPrincipalBefore).to.be.lessThan(0);
      });

      it('totalBorrowBase exceeds baseMinForRewards', async () => {
        expect(totalBorrowBaseBefore).to.be.greaterThanOrEqual(await comet.baseMinForRewards());
      });

      it('utilization is greater than zero before withdrawal', async () => {
        expect(utilizationBefore).to.be.greaterThan(0);
      });

      it('bob withdraws COMP collateral, triggering accrueAccountInternal', async () => {
        withdrawCollateralTx = await comet.connect(bob).withdraw(collaterals['COMP'].address, BOB_COMP_WITHDRAW);
        await expect(withdrawCollateralTx).to.not.be.reverted;
      });

      it('accrual time matches the withdrawal block timestamp', async () => {
        withdrawTimestamp = BigNumber.from(
          (await ethers.provider.getBlock((await withdrawCollateralTx.wait()).blockNumber)).timestamp
        );
        expect((await comet.totalsBasic()).lastAccrualTime).to.equal(withdrawTimestamp.toNumber());
      });

      it('baseSupplyIndex grows when supply rate is non-zero', async () => {
        // supplyRate > 0 due to positive utilization (borrows exist)
        // baseSupplyIndex += mulFactor(baseSupplyIndex, supplyRate * timeElapsed)
        const timeElapsed = withdrawTimestamp.sub(lastAccrualTimeBefore);
        const expectedBaseSupplyIndex = baseSupplyIndexBefore.add(
          baseSupplyIndexBefore.mul(supplyRateBefore).mul(timeElapsed).div(exp(1, 18))
        );
        expect((await comet.totalsBasic()).baseSupplyIndex).to.equal(expectedBaseSupplyIndex);
      });

      it('baseBorrowIndex grows when borrow rate is non-zero', async () => {
        // borrowRate > 0 due to positive utilization
        // baseBorrowIndex += mulFactor(baseBorrowIndex, borrowRate * timeElapsed)
        const timeElapsed = withdrawTimestamp.sub(lastAccrualTimeBefore);
        const expectedBaseBorrowIndex = baseBorrowIndexBefore.add(
          baseBorrowIndexBefore.mul(borrowRateBefore).mul(timeElapsed).div(exp(1, 18))
        );
        expect((await comet.totalsBasic()).baseBorrowIndex).to.equal(expectedBaseBorrowIndex);
      });

      it('trackingBorrowIndex grows when totalBorrowBase exceeds baseMinForRewards', async () => {
        // trackingBorrowIndex += divBaseWei(baseTrackingBorrowSpeed * timeElapsed, totalBorrowBase)
        //                      = baseTrackingBorrowSpeed * timeElapsed * baseScale / totalBorrowBase
        const timeElapsed = withdrawTimestamp.sub(lastAccrualTimeBefore);
        const baseScale = exp(1, 6);
        const expectedTrackingBorrowIndex = trackingBorrowIndexBefore.add(
          baseTrackingBorrowSpeedVal.mul(timeElapsed).mul(baseScale).div(totalBorrowBaseBefore)
        );
        expect((await comet.totalsBasic()).trackingBorrowIndex).to.equal(expectedTrackingBorrowIndex);
      });

      it('trackingSupplyIndex also grows with non-zero total supply', async () => {
        // trackingSupplyIndex += divBaseWei(baseTrackingSupplySpeed * timeElapsed, totalSupplyBase)
        const timeElapsed = withdrawTimestamp.sub(lastAccrualTimeBefore);
        const baseScale = exp(1, 6);
        const expectedTrackingSupplyIndex = trackingSupplyIndexBefore.add(
          baseTrackingSupplySpeedVal.mul(timeElapsed).mul(baseScale).div(totalSupplyBaseBefore)
        );
        expect((await comet.totalsBasic()).trackingSupplyIndex).to.equal(expectedTrackingSupplyIndex);
      });

      it('bob baseTrackingAccrued accumulates borrow rewards via trackingBorrowIndex', async () => {
        // bob.principal < 0 → borrow tracking applies in updateBasePrincipal:
        //   indexDelta = trackingBorrowIndex_new - bob.baseTrackingIndex_before
        //   baseTrackingAccrued += |principal| * indexDelta / trackingIndexScale / accrualDescaleFactor
        // accrualDescaleFactor = baseScale / BASE_ACCRUAL_SCALE = 1e6 / 1e6 = 1 for USDC
        const timeElapsed = withdrawTimestamp.sub(lastAccrualTimeBefore);
        const baseScale = exp(1, 6);
        const trackingBorrowIndexNew = trackingBorrowIndexBefore.add(
          baseTrackingBorrowSpeedVal.mul(timeElapsed).mul(baseScale).div(totalBorrowBaseBefore)
        );
        const indexDelta = trackingBorrowIndexNew.sub(bobBaseTrackingIndexBefore);
        const expectedAccrued = bobBaseTrackingAccruedBefore.add(
          bobPrincipalBefore.abs().mul(indexDelta).div(trackingIndexScaleVal)
        );
        expect((await comet.userBasic(bob.address)).baseTrackingAccrued).to.equal(expectedAccrued);
      });

      it('utilization is greater than zero after collateral withdrawal', async () => {
        // Collateral withdrawal does not affect totalBorrowBase or totalSupplyBase
        expect(await comet.getUtilization()).to.be.greaterThan(0);
      });

      it('utilization after collateral withdrawal matches exact calculation from accrued indices', async () => {
        // getUtilization() = presentValue(borrow) * FACTOR_SCALE / presentValue(supply)
        // = totalBorrowBase * baseBorrowIndex_new / 1e15 * 1e18 / (totalSupplyBase * baseSupplyIndex_new / 1e15)
        const totals = await comet.totalsBasic();
        const totalBorrowPresent = totals.totalBorrowBase.mul(totals.baseBorrowIndex).div(exp(1, 15));
        const totalSupplyPresent = totals.totalSupplyBase.mul(totals.baseSupplyIndex).div(exp(1, 15));
        const expectedUtilization = totalBorrowPresent.mul(exp(1, 18)).div(totalSupplyPresent);
        expect(await comet.getUtilization()).to.equal(expectedUtilization);
      });
    });

    describe('edge cases', function () {
      const COLLATERAL_AMOUNT = exp(1, 8);
      const SUPPLY_AMOUNT = exp(100, 6);
      const WITHDRAW_AMOUNT = exp(25, 6);

      it('withdraws 0 collateral successfully', async () => {
        await baseSnapshot.restore();

        await collaterals['COMP'].allocateTo(alice.address, COLLATERAL_AMOUNT);
        await collaterals['COMP'].connect(alice).approve(comet.address, COLLATERAL_AMOUNT);
        await comet.connect(alice).supply(collaterals['COMP'].address, COLLATERAL_AMOUNT);

        const balanceBefore = (await comet.userCollateral(alice.address, collaterals['COMP'].address)).balance;
        const tx = await comet.connect(alice).withdraw(collaterals['COMP'].address, 0);

        await expect(tx)
          .to.emit(comet, 'WithdrawCollateral')
          .withArgs(alice.address, alice.address, collaterals['COMP'].address, 0);

        expect((await comet.userCollateral(alice.address, collaterals['COMP'].address)).balance).to.equal(balanceBefore);
      });

      it('multiple consecutive withdraws in same block', async () => {
        await baseSnapshot.restore();

        await baseToken.connect(bob).approve(comet.address, SUPPLY_AMOUNT);
        await comet.connect(bob).supply(baseToken.address, SUPPLY_AMOUNT);

        await comet.connect(bob).withdraw(baseToken.address, WITHDRAW_AMOUNT);
        expect(await comet.balanceOf(bob.address)).to.equal(exp(75, 6));
        await comet.connect(bob).withdraw(baseToken.address, WITHDRAW_AMOUNT);
        expect(await comet.balanceOf(bob.address)).to.equal(exp(50, 6));

        await comet.connect(bob).withdraw(baseToken.address, WITHDRAW_AMOUNT);
        expect(await comet.balanceOf(bob.address)).to.equal(exp(25, 6));


        await comet.connect(bob).withdraw(baseToken.address, WITHDRAW_AMOUNT);
        expect(await comet.balanceOf(bob.address)).to.equal(0);
      });

      it('withdrawTo zero address sends tokens to zero address (tokens burned)', async () => {
        await baseSnapshot.restore();

        await baseToken.connect(bob).approve(comet.address, SUPPLY_AMOUNT);
        await comet.connect(bob).supply(baseToken.address, SUPPLY_AMOUNT);

        const zeroAddressBalanceBefore = await baseToken.balanceOf(ethers.constants.AddressZero);

        const tx = await comet.connect(bob).withdrawTo(ethers.constants.AddressZero, baseToken.address, SUPPLY_AMOUNT);

        await expect(tx)
          .to.emit(comet, 'Withdraw')
          .withArgs(bob.address, ethers.constants.AddressZero, SUPPLY_AMOUNT);

        expect(await baseToken.balanceOf(ethers.constants.AddressZero)).to.equal(zeroAddressBalanceBefore.add(SUPPLY_AMOUNT));
        expect(await comet.balanceOf(bob.address)).to.equal(0);
      });
    });
  });

  describe('borrow (withdraw without supply)', function () {
    before(async () => {
      await baseSnapshot.restore();
    });

    describe('reverts', function () {
      const BOB_SUPPLY_AMOUNT = exp(100, 6);
      const BOB_LARGE_SUPPLY_AMOUNT = exp(100000, 6);
      const ALICE_COLLATERAL_AMOUNT = exp(1, 18);
      const SMALL_BORROW_AMOUNT = exp(1, 6);
      const LARGE_BORROW_AMOUNT = exp(10000, 6);

      it("can't borrow if there is no collateral supplied", async () => {
        await baseSnapshot.restore();
        
        await baseToken.connect(bob).approve(comet.address, BOB_SUPPLY_AMOUNT);
        await comet.connect(bob).supply(baseToken.address, BOB_SUPPLY_AMOUNT);

        await expect(
          comet.connect(alice).withdraw(baseToken.address, SMALL_BORROW_AMOUNT)
        ).to.be.revertedWithCustomError(comet, 'NotCollateralized');
      });

      it("can't borrow if there is not enough collateral", async () => {
        await baseSnapshot.restore();
        
        await baseToken.connect(bob).approve(comet.address, BOB_LARGE_SUPPLY_AMOUNT);
        await comet.connect(bob).supply(baseToken.address, BOB_LARGE_SUPPLY_AMOUNT);

        await collaterals['WETH'].allocateTo(alice.address, ALICE_COLLATERAL_AMOUNT);
        await collaterals['WETH'].connect(alice).approve(comet.address, ALICE_COLLATERAL_AMOUNT);
        await comet.connect(alice).supply(collaterals['WETH'].address, ALICE_COLLATERAL_AMOUNT);

        const collateralValueUsd = Number(ALICE_COLLATERAL_AMOUNT) / 1e18 * 3000;
        const borrowValueUsd = Number(LARGE_BORROW_AMOUNT) / 1e6;
        expect(borrowValueUsd).to.be.gt(collateralValueUsd);

        await expect(
          comet.connect(alice).withdraw(baseToken.address, LARGE_BORROW_AMOUNT)
        ).to.be.revertedWithCustomError(comet, 'NotCollateralized');
      });

      describe('reverts with collateral supplied', function () {
        let borrowRevertSnapshot: SnapshotRestorer;

        before(async () => {
          await baseSnapshot.restore();

          await baseToken.connect(bob).approve(comet.address, BOB_SUPPLY_AMOUNT);
          await comet.connect(bob).supply(baseToken.address, BOB_SUPPLY_AMOUNT);

          await collaterals['WETH'].allocateTo(alice.address, ALICE_COLLATERAL_AMOUNT);
          await collaterals['WETH'].connect(alice).approve(comet.address, ALICE_COLLATERAL_AMOUNT);
          await comet.connect(alice).supply(collaterals['WETH'].address, ALICE_COLLATERAL_AMOUNT);

          borrowRevertSnapshot = await takeSnapshot();
        });

        it("can't borrow less than minBorrow", async () => {

          const borrowAmount = exp(0.5, 6);
          const baseBorrowMin = await comet.baseBorrowMin();
          expect(borrowAmount).to.be.lt(baseBorrowMin);

          await expect(
            comet.connect(alice).withdraw(baseToken.address, borrowAmount)
          ).to.be.revertedWithCustomError(comet, 'BorrowTooSmall');
        });

        it('reverts if borrower withdraw is paused (extended pause)', async () => {
          const snapshot = await takeSnapshot();

          await baseToken.connect(bob).approve(comet.address, BOB_SUPPLY_AMOUNT);
          await comet.connect(bob).supply(baseToken.address, BOB_SUPPLY_AMOUNT);
          await collaterals['WETH'].allocateTo(alice.address, ALICE_COLLATERAL_AMOUNT);
          await collaterals['WETH'].connect(alice).approve(comet.address, ALICE_COLLATERAL_AMOUNT);
          await comet.connect(alice).supply(collaterals['WETH'].address, ALICE_COLLATERAL_AMOUNT);

          await comet.connect(pauseGuardian).pauseBorrowersWithdraw(true);
          expect(await comet.isBorrowersWithdrawPaused()).to.be.true;

          await expect(
            comet.connect(alice).withdraw(baseToken.address, SMALL_BORROW_AMOUNT)
          ).to.be.revertedWithCustomError(comet, 'BorrowersWithdrawPaused');

          await comet.connect(pauseGuardian).pauseBorrowersWithdraw(false);
          await snapshot.restore();
        });

        it('reverts borrow if collateral oracle returns 0', async () => {
          await borrowRevertSnapshot.restore();

          await priceFeeds.WETH.setRoundData(1, 0, 0, 0, 1);

          await expect(
            comet.connect(alice).withdraw(baseToken.address, SMALL_BORROW_AMOUNT)
          ).to.be.revertedWithCustomError(comet, 'BadPrice');
        });

        it('reverts borrow if base oracle returns 0', async () => {
          await borrowRevertSnapshot.restore();

          await priceFeeds.USDC.setRoundData(1, 0, 0, 0, 1);

          await expect(
            comet.connect(alice).withdraw(baseToken.address, SMALL_BORROW_AMOUNT)
          ).to.be.revertedWithCustomError(comet, 'BadPrice');
        });
      });
    });

    describe('borrow: happy path', function () {
      const BOB_SUPPLY_AMOUNT = exp(100, 6);
      const ALICE_COLLATERAL_AMOUNT = exp(1, 18);
      const BORROW_AMOUNT = exp(10, 6);

      before(async () => {
        await baseSnapshot.restore();
      });

      it('principal from the 1st borrow equals to the requested amount', async () => {
        const collateralValueUsd = Number(ALICE_COLLATERAL_AMOUNT) / 1e18 * 3000;
        const borrowValueUsd = Number(BORROW_AMOUNT) / 1e6;
        expect(collateralValueUsd).to.be.gt(borrowValueUsd);

        await baseToken.connect(bob).approve(comet.address, BOB_SUPPLY_AMOUNT);
        await comet.connect(bob).supply(baseToken.address, BOB_SUPPLY_AMOUNT);

        await collaterals['WETH'].allocateTo(alice.address, ALICE_COLLATERAL_AMOUNT);
        await collaterals['WETH'].connect(alice).approve(comet.address, ALICE_COLLATERAL_AMOUNT);
        await comet.connect(alice).supply(collaterals['WETH'].address, ALICE_COLLATERAL_AMOUNT);

        await comet.connect(alice).withdraw(baseToken.address, BORROW_AMOUNT);

        const aliceBalance = await baseBalanceOf(comet, alice.address);
        expect(aliceBalance).to.equal(-BORROW_AMOUNT);
      });

      it('borrow balance increases with interest over time (consecutive borrows)', async () => {
        await baseSnapshot.restore();

        await baseToken.connect(bob).approve(comet.address, exp(1000, 6));
        await comet.connect(bob).supply(baseToken.address, exp(1000, 6));

        await collaterals['WETH'].allocateTo(alice.address, exp(10, 18));
        await collaterals['WETH'].connect(alice).approve(comet.address, exp(10, 18));
        await comet.connect(alice).supply(collaterals['WETH'].address, exp(10, 18));

        const borrowAmount1 = exp(100, 6);
        await comet.connect(alice).withdraw(baseToken.address, borrowAmount1);
        const balance1 = await baseBalanceOf(comet, alice.address);
        expect(balance1).to.equal(-borrowAmount1);

        await fastForward(86400);
        await ethers.provider.send('evm_mine', []);

        const balanceAfterTime = await baseBalanceOf(comet, alice.address);
        expect(balanceAfterTime).to.be.lte(balance1);

        const borrowAmount2 = exp(50, 6);
        await comet.connect(alice).withdraw(baseToken.address, borrowAmount2);

        const finalBalance = await baseBalanceOf(comet, alice.address);
        expect(finalBalance).to.be.lte(-(borrowAmount1 + borrowAmount2));
      });

      it('borrows to withdraw if necessary/possible', async () => {
        await baseSnapshot.restore();
        
        const SMALL_SUPPLY = exp(10, 6);
        const SMALL_BORROW = exp(1, 6);
        
        await baseToken.connect(bob).approve(comet.address, SMALL_SUPPLY);
        await comet.connect(bob).supply(baseToken.address, SMALL_SUPPLY);

        await collaterals['WETH'].allocateTo(alice.address, ALICE_COLLATERAL_AMOUNT);
        await collaterals['WETH'].connect(alice).approve(comet.address, ALICE_COLLATERAL_AMOUNT);
        await comet.connect(alice).supply(collaterals['WETH'].address, ALICE_COLLATERAL_AMOUNT);

        const bobUsdcBefore = await baseToken.balanceOf(bob.address);
        await comet.connect(alice).withdrawTo(bob.address, baseToken.address, SMALL_BORROW);

        expect(await baseBalanceOf(comet, alice.address)).to.eq(-SMALL_BORROW);
        expect(await baseToken.balanceOf(bob.address)).to.eq(bobUsdcBefore.add(SMALL_BORROW));
      });
    });
  });

  describe('withdrawTo', function () {
    const SUPPLY_AMOUNT = exp(100, 6);

    before(async () => {
      await baseSnapshot.restore();
    });

    it('withdraws to sender by default', async () => {
      await baseToken.connect(bob).approve(comet.address, SUPPLY_AMOUNT);
      await comet.connect(bob).supply(baseToken.address, SUPPLY_AMOUNT);

      const bobUsdcBefore = await baseToken.balanceOf(bob.address);
      expect(await comet.balanceOf(bob.address)).to.equal(SUPPLY_AMOUNT);

      await comet.connect(bob).withdraw(baseToken.address, SUPPLY_AMOUNT);

      expect(await comet.balanceOf(bob.address)).to.equal(0);
      expect(await baseToken.balanceOf(bob.address)).to.equal(bobUsdcBefore.add(SUPPLY_AMOUNT));
    });

    it('reverts if collateral withdraw is paused (extended pause)', async () => {
      await baseSnapshot.restore();

      await comet.connect(pauseGuardian).pauseCollateralWithdraw(true);
      expect(await comet.isCollateralWithdrawPaused()).to.be.true;

      await expect(
        comet.connect(bob).withdrawTo(alice.address, collaterals['COMP'].address, 1)
      ).to.be.revertedWithCustomError(comet, 'CollateralWithdrawPaused');

      await comet.connect(pauseGuardian).pauseCollateralWithdraw(false);
    });

    it('reverts if lender withdraw is paused (extended pause)', async () => {
      await baseSnapshot.restore();

      await baseToken.connect(bob).approve(comet.address, SUPPLY_AMOUNT);
      await comet.connect(bob).supply(baseToken.address, SUPPLY_AMOUNT);

      await comet.connect(pauseGuardian).pauseLendersWithdraw(true);
      expect(await comet.isLendersWithdrawPaused()).to.be.true;

      await expect(
        comet.connect(bob).withdrawTo(alice.address, baseToken.address, exp(50, baseTokenDecimals))
      ).to.be.revertedWithCustomError(comet, 'LendersWithdrawPaused');

      await comet.connect(pauseGuardian).pauseLendersWithdraw(false);
    });

    it('reverts if borrower withdraw is paused (extended pause)', async () => {
      await baseSnapshot.restore();

      await baseToken.connect(bob).approve(comet.address, SUPPLY_AMOUNT);
      await comet.connect(bob).supply(baseToken.address, SUPPLY_AMOUNT);

      await collaterals['WETH'].allocateTo(alice.address, exp(1, 18));
      await collaterals['WETH'].connect(alice).approve(comet.address, exp(1, 18));
      await comet.connect(alice).supply(collaterals['WETH'].address, exp(1, 18));

      await comet.connect(pauseGuardian).pauseBorrowersWithdraw(true);
      expect(await comet.isBorrowersWithdrawPaused()).to.be.true;

      await expect(
        comet.connect(alice).withdrawTo(bob.address, baseToken.address, exp(10, baseTokenDecimals))
      ).to.be.revertedWithCustomError(comet, 'BorrowersWithdrawPaused');

      await comet.connect(pauseGuardian).pauseBorrowersWithdraw(false);
    });
  });

  describe('withdrawFrom', function () {
    const SUPPLY_AMOUNT = exp(1, 8);
    let charlie: SignerWithAddress;
    let withdrawFromSnapshot: SnapshotRestorer;

    before(async () => {
      await baseSnapshot.restore();
      charlie = (await ethers.getSigners())[4];

      await collaterals['COMP'].allocateTo(bob.address, SUPPLY_AMOUNT);
      await collaterals['COMP'].connect(bob).approve(comet.address, SUPPLY_AMOUNT);
      await comet.connect(bob).supply(collaterals['COMP'].address, SUPPLY_AMOUNT);

      withdrawFromSnapshot = await takeSnapshot();
    });

    it('withdraws from src if specified and sender has permission', async () => {
      const aliceBalanceBefore = await collaterals['COMP'].balanceOf(alice.address);
      expect((await comet.userCollateral(bob.address, collaterals['COMP'].address)).balance).to.equal(SUPPLY_AMOUNT);

      await comet.connect(bob).allow(charlie.address, true);
      await comet.connect(charlie).withdrawFrom(bob.address, alice.address, collaterals['COMP'].address, SUPPLY_AMOUNT);

      expect((await comet.userCollateral(bob.address, collaterals['COMP'].address)).balance).to.equal(0);
      expect(await collaterals['COMP'].balanceOf(alice.address)).to.equal(aliceBalanceBefore.add(SUPPLY_AMOUNT));
    });

    it('reverts if src is specified and sender does not have permission', async () => {
      await withdrawFromSnapshot.restore();

      await expect(
        comet.connect(charlie).withdrawFrom(bob.address, alice.address, collaterals['COMP'].address, SUPPLY_AMOUNT)
      ).to.be.revertedWithCustomError(comet, 'Unauthorized');
    });

    it('reverts if withdraw is paused', async () => {
      await withdrawFromSnapshot.restore();

      await comet.connect(pauseGuardian).pause(false, false, true, false, false);
      expect(await comet.isWithdrawPaused()).to.be.true;

      await comet.connect(bob).allow(charlie.address, true);
      await expect(
        comet.connect(charlie).withdrawFrom(bob.address, alice.address, collaterals['COMP'].address, SUPPLY_AMOUNT)
      ).to.be.revertedWithCustomError(comet, 'Paused');

      await comet.connect(pauseGuardian).pause(false, false, false, false, false);
    });

    it('reverts if collateral withdraw is paused (extended pause)', async () => {
      await withdrawFromSnapshot.restore();

      await comet.connect(bob).allow(charlie.address, true);
      await collaterals['COMP'].allocateTo(bob.address, SUPPLY_AMOUNT);
      await collaterals['COMP'].connect(bob).approve(comet.address, SUPPLY_AMOUNT);
      await comet.connect(bob).supply(collaterals['COMP'].address, SUPPLY_AMOUNT);

      await comet.connect(pauseGuardian).pauseCollateralWithdraw(true);
      expect(await comet.isCollateralWithdrawPaused()).to.be.true;

      await expect(
        comet.connect(charlie).withdrawFrom(bob.address, alice.address, collaterals['COMP'].address, SUPPLY_AMOUNT)
      ).to.be.revertedWithCustomError(comet, 'CollateralWithdrawPaused');

      await comet.connect(pauseGuardian).pauseCollateralWithdraw(false);
    });

    it('reverts if lender withdraw is paused (extended pause)', async () => {
      await withdrawFromSnapshot.restore();

      await baseToken.connect(bob).approve(comet.address, exp(100, baseTokenDecimals));
      await comet.connect(bob).supply(baseToken.address, exp(100, baseTokenDecimals));
      await comet.connect(bob).allow(charlie.address, true);

      await comet.connect(pauseGuardian).pauseLendersWithdraw(true);
      expect(await comet.isLendersWithdrawPaused()).to.be.true;

      await expect(
        comet.connect(charlie).withdrawFrom(bob.address, alice.address, baseToken.address, exp(50, baseTokenDecimals))
      ).to.be.revertedWithCustomError(comet, 'LendersWithdrawPaused');

      await comet.connect(pauseGuardian).pauseLendersWithdraw(false);
    });

    it('reverts if borrower withdraw is paused (extended pause)', async () => {
      await withdrawFromSnapshot.restore();

      await baseToken.connect(bob).approve(comet.address, exp(100, baseTokenDecimals));
      await comet.connect(bob).supply(baseToken.address, exp(100, baseTokenDecimals));

      await collaterals['WETH'].allocateTo(alice.address, exp(1, 18));
      await collaterals['WETH'].connect(alice).approve(comet.address, exp(1, 18));
      await comet.connect(alice).supply(collaterals['WETH'].address, exp(1, 18));
      await comet.connect(alice).allow(charlie.address, true);

      await comet.connect(pauseGuardian).pauseBorrowersWithdraw(true);
      expect(await comet.isBorrowersWithdrawPaused()).to.be.true;

      await expect(
        comet.connect(charlie).withdrawFrom(alice.address, bob.address, baseToken.address, exp(10, baseTokenDecimals))
      ).to.be.revertedWithCustomError(comet, 'BorrowersWithdrawPaused');

      await comet.connect(pauseGuardian).pauseBorrowersWithdraw(false);
    });
  });

  describe('reentrancy protection', function () {
    const USDC_LIQUIDITY = exp(100, 6);
    const ATTACK_AMOUNT = exp(1, 6);
    const COLLATERAL_SUPPLY = exp(100, 6);
    const ALICE_COLLATERAL_BALANCE = exp(1, 6);

    let evilComet: CometHarnessInterface;
    let USDC: FaucetToken;
    let EVIL: EvilToken;
    let evilAlice: SignerWithAddress;
    let evilBob: SignerWithAddress;
    let reentrancySnapshot: SnapshotRestorer;

    before(async () => {
      const { comet, tokens, users } = await makeProtocol({
        assets: {
          USDC: { decimals: 6 },
          EVIL: {
            decimals: 6,
            initialPrice: 2,
            factory: await ethers.getContractFactory('EvilToken') as EvilToken__factory,
          }
        }
      });
      evilComet = comet;
      USDC = tokens.USDC as FaucetToken;
      EVIL = tokens.EVIL as EvilToken;
      [evilAlice, evilBob] = users;

      await USDC.allocateTo(evilComet.address, USDC_LIQUIDITY);

      // Harness: EvilToken can't be supplied normally - it's malicious and triggers reentrancy
      const totalsCollateral = Object.assign({}, await evilComet.totalsCollateral(EVIL.address), {
        totalSupplyAsset: COLLATERAL_SUPPLY,
      });
      await evilComet.setTotalsCollateral(EVIL.address, totalsCollateral);
      await evilComet.setCollateralBalance(evilAlice.address, EVIL.address, ALICE_COLLATERAL_BALANCE);
      await evilComet.connect(evilAlice).allow(EVIL.address, true);

      reentrancySnapshot = await takeSnapshot();
    });

    it('blocks malicious reentrant transferFrom', async () => {
      const attack = Object.assign({}, await EVIL.getAttack(), {
        attackType: ReentryAttack.TransferFrom,
        destination: evilBob.address,
        asset: USDC.address,
        amount: ATTACK_AMOUNT
      });
      await EVIL.setAttack(attack);

      await expect(
        evilComet.connect(evilAlice).withdraw(EVIL.address, ATTACK_AMOUNT)
      ).to.be.revertedWithCustomError(evilComet, 'ReentrantCallBlocked');

      expect(await USDC.balanceOf(evilComet.address)).to.eq(USDC_LIQUIDITY);
      expect(await baseBalanceOf(evilComet, evilAlice.address)).to.eq(0n);
      expect(await USDC.balanceOf(evilBob.address)).to.eq(0);
    });

    it('blocks malicious reentrant withdrawFrom', async () => {
      await reentrancySnapshot.restore();

      const attack = Object.assign({}, await EVIL.getAttack(), {
        attackType: ReentryAttack.WithdrawFrom,
        destination: evilBob.address,
        asset: USDC.address,
        amount: ATTACK_AMOUNT
      });
      await EVIL.setAttack(attack);

      await expect(
        evilComet.connect(evilAlice).withdraw(EVIL.address, ATTACK_AMOUNT)
      ).to.be.revertedWithCustomError(evilComet, 'ReentrantCallBlocked');

      expect(await USDC.balanceOf(evilComet.address)).to.eq(USDC_LIQUIDITY);
      expect(await baseBalanceOf(evilComet, evilAlice.address)).to.eq(0n);
      expect(await USDC.balanceOf(evilBob.address)).to.eq(0);
    });
  });

  describe('non-standard tokens', function () {
    describe('USDT-like token (no return value)', function () {
      let nstComet: CometHarnessInterface;
      let alice: SignerWithAddress;
      let bob: SignerWithAddress;
      let usdt: NonStandardFaucetFeeToken;
      let nonStdCollateral: NonStandardFaucetFeeToken;
      const USDT_AMOUNT = exp(100, 6);
      const NON_STD_COLLATERAL_AMOUNT = exp(1, 18);

      before(async function () {
        const assets = defaultAssets();
        assets['USDT'] = {
          initial: 1e6,
          decimals: 6,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };
        assets['NonStdCollateral'] = {
          initial: 1e8,
          decimals: 18,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };

        const protocol = await makeProtocol({ base: 'USDT', assets: assets });
        nstComet = protocol.comet;
        [alice, bob] = protocol.users;

        const tokens = protocol.tokens;
        usdt = tokens['USDT'] as NonStandardFaucetFeeToken;
        nonStdCollateral = tokens['NonStdCollateral'] as NonStandardFaucetFeeToken;

        await usdt.allocateTo(bob.address, USDT_AMOUNT);
        await usdt.connect(bob).approve(nstComet.address, USDT_AMOUNT);
        await nstComet.connect(bob).supply(usdt.address, USDT_AMOUNT);

        await nonStdCollateral.allocateTo(alice.address, NON_STD_COLLATERAL_AMOUNT);
        await nonStdCollateral.connect(alice).approve(nstComet.address, NON_STD_COLLATERAL_AMOUNT);
        await nstComet.connect(alice).supply(nonStdCollateral.address, NON_STD_COLLATERAL_AMOUNT);
      });

      it('can withdraw base token - non-standard ERC20 (without return interface)', async () => {
        const bobBalanceBefore = await usdt.balanceOf(bob.address);

        await nstComet.connect(bob).withdraw(usdt.address, USDT_AMOUNT);

        expect(await usdt.balanceOf(bob.address)).to.equal(bobBalanceBefore.add(USDT_AMOUNT));
        expect(await nstComet.balanceOf(bob.address)).to.equal(0);
      });

      it('can withdraw collateral - non-standard ERC20 (without return interface)', async () => {
        const aliceBalanceBefore = await nonStdCollateral.balanceOf(alice.address);

        await nstComet.connect(alice).withdraw(nonStdCollateral.address, NON_STD_COLLATERAL_AMOUNT);

        expect(await nonStdCollateral.balanceOf(alice.address)).to.equal(aliceBalanceBefore.add(NON_STD_COLLATERAL_AMOUNT));
        expect((await nstComet.userCollateral(alice.address, nonStdCollateral.address)).balance).to.equal(0);
      });
    });

    describe('fee-on-transfer token', function () {
      const BASE_TOKEN_AMOUNT = exp(100, 6);
      const COLLATERAL_TOKEN_AMOUNT = exp(1, 18);
      const NUMERATOR = 10;
      const DENOMINATOR = 10000;

      let feeComet: CometHarnessInterface;
      let feeBaseToken: NonStandardFaucetFeeToken;
      let feeCollateral: NonStandardFaucetFeeToken;
      let alice: SignerWithAddress;
      let bob: SignerWithAddress;

      before(async function () {
        const assets = defaultAssets();
        assets['USDT'] = {
          initial: 1e6,
          decimals: 6,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };
        assets['FeeCollateral'] = {
          initial: 1e8,
          decimals: 18,
          factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
        };

        const protocol = await makeProtocol({ base: 'USDT', assets: assets });
        feeComet = protocol.comet;
        feeBaseToken = protocol.tokens['USDT'] as NonStandardFaucetFeeToken;
        feeCollateral = protocol.tokens['FeeCollateral'] as NonStandardFaucetFeeToken;
        [alice, bob] = protocol.users;

        await feeBaseToken.setParams(NUMERATOR, exp(100, 18));
        await feeCollateral.setParams(NUMERATOR, exp(100, 18));

        await feeBaseToken.allocateTo(bob.address, BASE_TOKEN_AMOUNT);
        await feeBaseToken.connect(bob).approve(feeComet.address, BASE_TOKEN_AMOUNT);
        await feeComet.connect(bob).supply(feeBaseToken.address, BASE_TOKEN_AMOUNT);

        await feeCollateral.allocateTo(alice.address, COLLATERAL_TOKEN_AMOUNT);
        await feeCollateral.connect(alice).approve(feeComet.address, COLLATERAL_TOKEN_AMOUNT);
        await feeComet.connect(alice).supply(feeCollateral.address, COLLATERAL_TOKEN_AMOUNT);
      });

      it('withdraws base token with fee-on-transfer (fee deducted on transfer out)', async () => {
        const bobPrincipal = (await feeComet.userBasic(bob.address)).principal;
        const bobBalanceBefore = await feeBaseToken.balanceOf(bob.address);

        const withdrawTx = await feeComet.connect(bob).withdraw(feeBaseToken.address, bobPrincipal);
        expect(withdrawTx).to.not.be.reverted;

        const fee = BigNumber.from(bobPrincipal).mul(NUMERATOR).div(DENOMINATOR);
        const expectedReceived = BigNumber.from(bobPrincipal).sub(fee);

        expect(await feeBaseToken.balanceOf(bob.address)).to.equal(bobBalanceBefore.add(expectedReceived));
      });

      it('withdraws collateral with fee-on-transfer (fee deducted on transfer out)', async () => {
        const aliceCollateral = (await feeComet.userCollateral(alice.address, feeCollateral.address)).balance;
        const aliceBalanceBefore = await feeCollateral.balanceOf(alice.address);

        const withdrawTx = await feeComet.connect(alice).withdraw(feeCollateral.address, aliceCollateral);
        expect(withdrawTx).to.not.be.reverted;

        const fee = BigNumber.from(aliceCollateral).mul(NUMERATOR).div(DENOMINATOR);
        const expectedReceived = BigNumber.from(aliceCollateral).sub(fee);

        expect(await feeCollateral.balanceOf(alice.address)).to.equal(aliceBalanceBefore.add(expectedReceived));

        expect((await feeComet.userCollateral(alice.address, feeCollateral.address)).balance).to.equal(0);
      });
    });
  });

  describe('withdraw 24 collaterals', function () {
    const SUPPLY_COLLATERAL_AMOUNT: bigint = exp(1, 18);

    let comet: CometHarnessInterfaceExtendedAssetList;
    let baseToken: FaucetToken;
    let collaterals: { [symbol: string]: FaucetToken } = {};

    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    let dave: SignerWithAddress;
    let withdrawTxs: ContractTransaction[] = [];
    let alicePrincipalBefore: BigNumber;

    let snapshot: SnapshotRestorer;

    before(async () => {
      const cometCollaterals = Object.fromEntries(
        Array.from({ length: MAX_ASSETS }, (_, j) => [`ASSET${j}`, {
          decimals: 18,
          initialPrice: 100,
        }])
      );
      const protocol = await makeProtocol({
        base: 'USDC',
        assets: {
          USDC: { decimals: 6, initialPrice: 1 },
          ...cometCollaterals
        },
      });

      comet = protocol.cometWithExtendedAssetList;
      baseToken = protocol.tokens[protocol.base] as FaucetToken;
      for (const asset in protocol.tokens) {
        if (asset === 'USDC') continue;
        collaterals[asset] = protocol.tokens[asset] as FaucetToken;
      }

      [alice, bob, dave] = protocol.users;

      await baseToken.allocateTo(bob.address, exp(100000, 6));
      await baseToken.connect(bob).approve(comet.address, exp(100000, 6));
      await comet.connect(bob).supply(baseToken.address, exp(100000, 6));

      for (let i = 0; i < MAX_ASSETS; i++) {
        const assetToken = collaterals[`ASSET${i}`];
        await assetToken.allocateTo(alice.address, SUPPLY_COLLATERAL_AMOUNT);
        await assetToken.connect(alice).approve(comet.address, SUPPLY_COLLATERAL_AMOUNT);
        await comet.connect(alice).supply(assetToken.address, SUPPLY_COLLATERAL_AMOUNT);

        await assetToken.allocateTo(dave.address, SUPPLY_COLLATERAL_AMOUNT);
        await assetToken.connect(dave).approve(comet.address, SUPPLY_COLLATERAL_AMOUNT);
        await comet.connect(dave).supply(assetToken.address, SUPPLY_COLLATERAL_AMOUNT);
      }

      alicePrincipalBefore = (await comet.userBasic(alice.address)).principal;

      snapshot = await takeSnapshot();
    });

    describe('withdraw', function () {
      this.afterAll(async () => snapshot.restore());

      it('each collateral withdraw is successful', async () => {
        for (const asset of Object.values(collaterals)) {
          const balanceBefore = await asset.balanceOf(alice.address);
          const withdrawTx = await comet.connect(alice).withdraw(asset.address, SUPPLY_COLLATERAL_AMOUNT);
          expect(withdrawTx).to.not.be.reverted;
          expect(await asset.balanceOf(alice.address)).to.equal(balanceBefore.add(SUPPLY_COLLATERAL_AMOUNT));
          withdrawTxs.push(withdrawTx);
        }
      });

      it('WithdrawCollateral event is emitted for each collateral', async () => {
        const assets = Object.values(collaterals);
        for (let i = 0; i < assets.length; i++) {
          await expect(withdrawTxs[i])
            .to.emit(comet, 'WithdrawCollateral')
            .withArgs(alice.address, alice.address, assets[i].address, SUPPLY_COLLATERAL_AMOUNT);
        }
        withdrawTxs = [];
      });

      it('each collateral balance is zero after withdrawal', async () => {
        for (const asset of Object.values(collaterals)) {
          expect(await comet.collateralBalanceOf(alice.address, asset.address)).to.be.equal(0);
        }
      });

      it('alice asset list is empty after all withdrawals', async () => {
        const assetList = await comet.getAssetList(alice.address);
        expect(assetList.length).to.equal(0);
      });

      it('each collateral comet total supplied collateral amount decreased by alice withdrawal', async () => {
        for (const asset of Object.values(collaterals)) {
          expect((await comet.totalsCollateral(asset.address)).totalSupplyAsset).to.be.equal(SUPPLY_COLLATERAL_AMOUNT);
        }
      });

      it('alice principal is not changed', async () => {
        expect((await comet.userBasic(alice.address)).principal).to.be.equal(alicePrincipalBefore);
      });
    });

    describe('withdrawTo', function () {
      before(async () => {
        await comet.connect(alice).allow(dave.address, true);
      });

      this.afterAll(async () => snapshot.restore());

      it('each collateral withdrawTo is successful', async () => {
        for (const asset of Object.values(collaterals)) {
          const balanceBefore = await asset.balanceOf(dave.address);
          const withdrawToTx = await comet.connect(alice).withdrawTo(dave.address, asset.address, SUPPLY_COLLATERAL_AMOUNT);
          expect(withdrawToTx).to.not.be.reverted;
          expect(await asset.balanceOf(dave.address)).to.equal(balanceBefore.add(SUPPLY_COLLATERAL_AMOUNT));
          withdrawTxs.push(withdrawToTx);
        }
      });

      it('WithdrawCollateral event is emitted for each collateral', async () => {
        const assets = Object.values(collaterals);
        for (let i = 0; i < assets.length; i++) {
          await expect(withdrawTxs[i])
            .to.emit(comet, 'WithdrawCollateral')
            .withArgs(alice.address, dave.address, assets[i].address, SUPPLY_COLLATERAL_AMOUNT);
        }
        withdrawTxs = [];
      });

      it('each collateral balance for alice is zero', async () => {
        for (const asset of Object.values(collaterals)) {
          expect(await comet.collateralBalanceOf(alice.address, asset.address)).to.be.equal(0);
        }
      });

      it('alice asset list is empty after all withdrawals', async () => {
        const assetList = await comet.getAssetList(alice.address);
        expect(assetList.length).to.equal(0);
      });

      it('each collateral comet total supplied collateral amount decreased by alice withdrawal', async () => {
        for (const asset of Object.values(collaterals)) {
          expect((await comet.totalsCollateral(asset.address)).totalSupplyAsset).to.be.equal(SUPPLY_COLLATERAL_AMOUNT);
        }
      });

      it('alice principal is not changed', async () => {
        expect((await comet.userBasic(alice.address)).principal).to.be.equal(alicePrincipalBefore);
      });
    });

    describe('withdrawFrom', function () {
      before(async () => {
        await comet.connect(alice).allow(dave.address, true);
      });

      this.afterAll(async () => snapshot.restore());

      it('each collateral withdrawFrom is successful', async () => {
        for (const asset of Object.values(collaterals)) {
          const balanceBefore = await asset.balanceOf(alice.address);
          const withdrawFromTx = await comet.connect(dave).withdrawFrom(alice.address, alice.address, asset.address, SUPPLY_COLLATERAL_AMOUNT);
          expect(withdrawFromTx).to.not.be.reverted;
          expect(await asset.balanceOf(alice.address)).to.equal(balanceBefore.add(SUPPLY_COLLATERAL_AMOUNT));
          withdrawTxs.push(withdrawFromTx);
        }
      });

      it('WithdrawCollateral event is emitted for each collateral', async () => {
        const assets = Object.values(collaterals);
        for (let i = 0; i < assets.length; i++) {
          await expect(withdrawTxs[i])
            .to.emit(comet, 'WithdrawCollateral')
            .withArgs(alice.address, alice.address, assets[i].address, SUPPLY_COLLATERAL_AMOUNT);
        }
      });

      it('each collateral balance for alice is zero', async () => {
        for (const asset of Object.values(collaterals)) {
          expect(await comet.collateralBalanceOf(alice.address, asset.address)).to.be.equal(0);
        }
      });

      it('alice asset list is empty after all withdrawals', async () => {
        const assetList = await comet.getAssetList(alice.address);
        expect(assetList.length).to.equal(0);
      });

      it('each collateral comet total supplied collateral amount decreased by alice withdrawal', async () => {
        for (const asset of Object.values(collaterals)) {
          expect((await comet.totalsCollateral(asset.address)).totalSupplyAsset).to.be.equal(SUPPLY_COLLATERAL_AMOUNT);
        }
      });

      it('alice principal is not changed', async () => {
        expect((await comet.userBasic(alice.address)).principal).to.be.equal(alicePrincipalBefore);
      });
    });

    describe('borrow with 24 collaterals', function () {
      before(async () => {
        await snapshot.restore();
      });

      it('can borrow when user has 24 different collateral types', async () => {
        const assetList = await comet.getAssetList(alice.address);
        expect(assetList.length).to.equal(MAX_ASSETS);

        const borrowAmount = exp(100, 6);
        const aliceBalanceBefore = await baseToken.balanceOf(alice.address);

        await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

        expect(await baseToken.balanceOf(alice.address)).to.equal(aliceBalanceBefore.add(borrowAmount));
        expect(await baseBalanceOf(comet as unknown as CometHarnessInterface, alice.address)).to.equal(BigInt(-borrowAmount));
      });
    });
  });

  describe('per-asset collateral pause (24 assets)', function () {
    let cometExtendedMaxAssets: CometHarnessInterfaceExtendedAssetList;
    let extTokensWithMaxAssets: { [symbol: string]: FaucetToken };
    let extAlice: SignerWithAddress;
    let extBob: SignerWithAddress;
    let extPauseGuardian: SignerWithAddress;
    let extSnapshot: SnapshotRestorer;

    const collateralTokenSupplyAmount = exp(5, 18);

    before(async () => {
      const maxAssetsCollaterals = Object.fromEntries(
        Array.from({ length: MAX_ASSETS }, (_, j) => [`ASSET${j}`, {}])
      );
      const protocolMaxAssets = await makeProtocol({
        assets: { USDC: {}, ...maxAssetsCollaterals },
      });
      cometExtendedMaxAssets = protocolMaxAssets.cometWithExtendedAssetList;
      extTokensWithMaxAssets = protocolMaxAssets.tokens as { [symbol: string]: FaucetToken };
      extPauseGuardian = protocolMaxAssets.pauseGuardian;
      [extAlice, extBob] = protocolMaxAssets.users;

      await cometExtendedMaxAssets.connect(extBob).allow(extAlice.address, true);

      extSnapshot = await takeSnapshot();
    });

    describe('withdraw', function () {
      this.afterAll(async () => extSnapshot.restore());

      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`withdraw reverts if collateral asset ${i} withdraw is paused`, async () => {
          const assetIndex = i - 1;
          const assetToken = extTokensWithMaxAssets[`ASSET${assetIndex}`];

          await assetToken.allocateTo(extBob.address, collateralTokenSupplyAmount);
          await assetToken
            .connect(extBob)
            .approve(cometExtendedMaxAssets.address, collateralTokenSupplyAmount);
          await cometExtendedMaxAssets
            .connect(extBob)
            .supply(assetToken.address, collateralTokenSupplyAmount);

          expect(
            await cometExtendedMaxAssets.collateralBalanceOf(extBob.address, assetToken.address)
          ).to.be.equal(collateralTokenSupplyAmount);

          await cometExtendedMaxAssets
            .connect(extPauseGuardian)
            .pauseCollateralAssetWithdraw(assetIndex, true);

          await expect(
            cometExtendedMaxAssets
              .connect(extBob)
              .withdraw(assetToken.address, collateralTokenSupplyAmount)
          ).to.be.revertedWithCustomError(
            cometExtendedMaxAssets,
            'CollateralAssetWithdrawPaused'
          );
        });
      }

      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`allows to withdraw collateral asset ${i} when asset becomes unpaused`, async () => {
          const assetIndex = i - 1;
          const assetToken = extTokensWithMaxAssets[`ASSET${assetIndex}`];
          const collateralBalance = await cometExtendedMaxAssets.collateralBalanceOf(extBob.address, assetToken.address);
          const tokenBalance = await assetToken.balanceOf(extBob.address);

          await cometExtendedMaxAssets
            .connect(extPauseGuardian)
            .pauseCollateralAssetWithdraw(assetIndex, false);

          await cometExtendedMaxAssets.connect(extBob).withdraw(assetToken.address, collateralTokenSupplyAmount);

          const collateralBalanceAfter = await cometExtendedMaxAssets.collateralBalanceOf(extBob.address, assetToken.address);
          const tokenBalanceAfter = await assetToken.balanceOf(extBob.address);

          expect(collateralBalanceAfter).to.be.equal(collateralBalance.sub(collateralTokenSupplyAmount));
          expect(tokenBalanceAfter).to.be.equal(tokenBalance.add(collateralTokenSupplyAmount));
        });
      }
    });

    describe('withdrawTo', function () {
      this.afterAll(async () => extSnapshot.restore());

      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`withdrawTo reverts if collateral asset ${i} withdraw is paused`, async () => {
          const assetIndex = i - 1;
          const assetToken = extTokensWithMaxAssets[`ASSET${assetIndex}`];

          await assetToken.allocateTo(extBob.address, collateralTokenSupplyAmount);
          await assetToken
            .connect(extBob)
            .approve(cometExtendedMaxAssets.address, collateralTokenSupplyAmount);
          await cometExtendedMaxAssets
            .connect(extBob)
            .supply(assetToken.address, collateralTokenSupplyAmount);

          expect(
            await cometExtendedMaxAssets.collateralBalanceOf(extBob.address, assetToken.address)
          ).to.be.equal(collateralTokenSupplyAmount);

          await cometExtendedMaxAssets
            .connect(extPauseGuardian)
            .pauseCollateralAssetWithdraw(assetIndex, true);

          await expect(
            cometExtendedMaxAssets
              .connect(extBob)
              .withdrawTo(
                extAlice.address,
                assetToken.address,
                collateralTokenSupplyAmount
              )
          ).to.be.revertedWithCustomError(
            cometExtendedMaxAssets,
            'CollateralAssetWithdrawPaused'
          );
        });
      }

      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`allows to withdrawTo collateral asset ${i} when asset becomes unpaused`, async () => {
          const assetIndex = i - 1;
          const assetToken = extTokensWithMaxAssets[`ASSET${assetIndex}`];
          const collateralBalanceBob = await cometExtendedMaxAssets.collateralBalanceOf(extBob.address, assetToken.address);
          const collateralBalanceAlice = await cometExtendedMaxAssets.collateralBalanceOf(extAlice.address, assetToken.address);
          const tokenBalanceBob = await assetToken.balanceOf(extBob.address);
          const tokenBalanceAlice = await assetToken.balanceOf(extAlice.address);

          await cometExtendedMaxAssets
            .connect(extPauseGuardian)
            .pauseCollateralAssetWithdraw(assetIndex, false);

          await cometExtendedMaxAssets
            .connect(extBob)
            .withdrawTo(extAlice.address, assetToken.address, collateralTokenSupplyAmount);

          const collateralBalanceBobAfter = await cometExtendedMaxAssets.collateralBalanceOf(extBob.address, assetToken.address);
          const collateralBalanceAliceAfter = await cometExtendedMaxAssets.collateralBalanceOf(extAlice.address, assetToken.address);
          const tokenBalanceBobAfter = await assetToken.balanceOf(extBob.address);
          const tokenBalanceAliceAfter = await assetToken.balanceOf(extAlice.address);

          expect(collateralBalanceBobAfter).to.be.equal(collateralBalanceBob.sub(collateralTokenSupplyAmount));
          expect(collateralBalanceAliceAfter).to.be.equal(collateralBalanceAlice);
          expect(tokenBalanceBobAfter).to.be.equal(tokenBalanceBob);
          expect(tokenBalanceAliceAfter).to.be.equal(tokenBalanceAlice.add(collateralTokenSupplyAmount));
        });
      }
    });

    describe('withdrawFrom', function () {
      this.afterAll(async () => extSnapshot.restore());

      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`withdrawFrom reverts if collateral asset ${i} withdraw is paused`, async () => {
          const assetIndex = i - 1;
          const assetToken = extTokensWithMaxAssets[`ASSET${assetIndex}`];

          await assetToken.allocateTo(extBob.address, collateralTokenSupplyAmount);
          await assetToken
            .connect(extBob)
            .approve(cometExtendedMaxAssets.address, collateralTokenSupplyAmount);
          await cometExtendedMaxAssets
            .connect(extBob)
            .supply(assetToken.address, collateralTokenSupplyAmount);

          expect(
            await cometExtendedMaxAssets.collateralBalanceOf(extBob.address, assetToken.address)
          ).to.be.equal(collateralTokenSupplyAmount);

          await cometExtendedMaxAssets
            .connect(extPauseGuardian)
            .pauseCollateralAssetWithdraw(assetIndex, true);

          await expect(
            cometExtendedMaxAssets
              .connect(extAlice)
              .withdrawFrom(
                extBob.address,
                extAlice.address,
                assetToken.address,
                collateralTokenSupplyAmount
              )
          ).to.be.revertedWithCustomError(
            cometExtendedMaxAssets,
            'CollateralAssetWithdrawPaused'
          );
        });
      }

      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`allows to withdrawFrom collateral asset ${i} when asset becomes unpaused`, async () => {
          const assetIndex = i - 1;
          const assetToken = extTokensWithMaxAssets[`ASSET${assetIndex}`];
          const collateralBalanceBob = await cometExtendedMaxAssets.collateralBalanceOf(extBob.address, assetToken.address);
          const collateralBalanceAlice = await cometExtendedMaxAssets.collateralBalanceOf(extAlice.address, assetToken.address);
          const tokenBalanceBob = await assetToken.balanceOf(extBob.address);
          const tokenBalanceAlice = await assetToken.balanceOf(extAlice.address);

          await cometExtendedMaxAssets
            .connect(extPauseGuardian)
            .pauseCollateralAssetWithdraw(assetIndex, false);

          await cometExtendedMaxAssets
            .connect(extAlice)
            .withdrawFrom(extBob.address, extAlice.address, assetToken.address, collateralTokenSupplyAmount);

          const collateralBalanceBobAfter = await cometExtendedMaxAssets.collateralBalanceOf(extBob.address, assetToken.address);
          const collateralBalanceAliceAfter = await cometExtendedMaxAssets.collateralBalanceOf(extAlice.address, assetToken.address);
          const tokenBalanceBobAfter = await assetToken.balanceOf(extBob.address);
          const tokenBalanceAliceAfter = await assetToken.balanceOf(extAlice.address);

          expect(collateralBalanceBobAfter).to.be.equal(collateralBalanceBob.sub(collateralTokenSupplyAmount));
          expect(collateralBalanceAliceAfter).to.be.equal(collateralBalanceAlice);
          expect(tokenBalanceBobAfter).to.be.equal(tokenBalanceBob);
          expect(tokenBalanceAliceAfter).to.be.equal(tokenBalanceAlice.add(collateralTokenSupplyAmount));
        });
      }
    });
  });
});
