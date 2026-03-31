import { CometHarnessInterfaceExtendedAssetList, FaucetToken, NonStandardFaucetFeeToken, NonStandardFaucetFeeToken__factory } from 'build/types';
import { ethers, expect, exp, makeProtocol, presentValue, ZERO_ADDRESS, presentValueSupply, mulPrice, mulFactor, defaultAssets, MAX_ASSETS } from './helpers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from './helpers/snapshot';

describe('transfer', function () {
  // Constants
  const baseTokenDecimals = 6;
  // Contracts
  let comet: CometHarnessInterfaceExtendedAssetList;
  let baseToken: FaucetToken;
  let collaterals: { [symbol: string]: FaucetToken } = {};
  let unsupportedToken: FaucetToken;
  // Accounts
  let users: SignerWithAddress[];
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let dave: SignerWithAddress;
  let pauseGuardian: SignerWithAddress;
  // Comet parameters
  let baseBorrowMin: bigint;

  before(async () => {
    const protocol = await makeProtocol({ base: 'USDC'});
    comet = protocol.cometWithExtendedAssetList;
    baseToken = protocol.tokens.USDC as FaucetToken;
    for (const asset in protocol.tokens) {
      if (asset === 'USDC') continue;
      collaterals[asset] = protocol.tokens[asset] as FaucetToken;
    }
    pauseGuardian = protocol.pauseGuardian;
    unsupportedToken = protocol.unsupportedToken;

    users = protocol.users;
    [alice, bob, dave] = protocol.users;

    baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
  });

  describe('base token', function () {
    const SUPPLY_AMOUNT:bigint = exp(100, baseTokenDecimals);
    const TRANSFER_AMOUNT:bigint = SUPPLY_AMOUNT / 2n;

    before(async () => {
      // Allocate base tokens to Alice
      await baseToken.allocateTo(alice.address, SUPPLY_AMOUNT);
      // Supply base tokens to Comet from Alice
      await baseToken.connect(alice).approve(comet.address, SUPPLY_AMOUNT);
      await comet.connect(alice).supply(baseToken.address, SUPPLY_AMOUNT);
    });

    describe('revert on', function () {
      let principal: bigint;
      let baseSupplyIndex: bigint;
      let baseBorrowIndex: bigint;

      before(async () => {
        principal = (await comet.userBasic(alice.address)).principal.toBigInt();
        const totalsBasic = await comet.totalsBasic();
        baseSupplyIndex = totalsBasic.baseSupplyIndex.toBigInt();
        baseBorrowIndex = totalsBasic.baseBorrowIndex.toBigInt();
      });

      it('self-transfer', async () => {
        await expect(comet.connect(alice).transfer(alice.address, SUPPLY_AMOUNT)).to.be.revertedWithCustomError(comet, 'NoSelfTransfer');
      });

      it('transfer is paused', async () => {
        // Pause transfer
        await comet.connect(pauseGuardian).pause(false, true, false, false, false);

        await expect(comet.connect(alice).transfer(alice.address, SUPPLY_AMOUNT)).to.be.revertedWithCustomError(comet, 'Paused');
        
        // Unpause transfer
        await comet.connect(pauseGuardian).pause(false, false, false, false, false);
      });

      it('lenders transfer is paused', async () => {
        // Pause lenders transfer
        await comet.connect(pauseGuardian).pauseLendersTransfer(true);

        await expect(comet.connect(alice).transfer(bob.address, SUPPLY_AMOUNT)).to.be.revertedWithCustomError(comet, 'LendersTransferPaused');

        // Unpause lenders transfer
        await comet.connect(pauseGuardian).pauseLendersTransfer(false);
      });

      // In case when user has no collateral supplied and lend position
      // transfering will revert with BorrowTooSmall, as amount to transfer is greater than
      // user's balance, he'll become a borrower and his balance will be negative on 1 wei
      // which is less than baseBorrowMin
      it('exceeds balance (no collateral supplied & newSrcBalance < baseBorrowMin)', async () => {
        const amountToTransfer = SUPPLY_AMOUNT + 1n;
        const srcBalance = presentValue(principal, baseSupplyIndex, baseBorrowIndex) - amountToTransfer;

        // Ensure -srcBalance < baseBorrowMin
        expect(baseBorrowMin).to.be.greaterThan(-srcBalance);

        await expect(comet.connect(alice).transfer(bob.address, SUPPLY_AMOUNT + 1n)).to.be.revertedWithCustomError(comet, 'BorrowTooSmall');
      });

      // In case when user has no collateral supplied and lend position
      // transfering will revert with NotCollateralized, as amount to transfer is greater than
      // user's balance, he'll become a borrower and his amount to borrow will be >= to baseBorrowMin
      // which will trigger NotCollateralized
      it('exceeds balance (no collateral supplied & newSrcBalance >= baseBorrowMin)', async () => {
        const amountToTransfer = SUPPLY_AMOUNT + baseBorrowMin;
        const srcBalance = presentValue(principal, baseSupplyIndex, baseBorrowIndex) - amountToTransfer;

        // Ensure -srcBalance >= baseBorrowMin
        expect(baseBorrowMin).to.lessThanOrEqual(-srcBalance);

        await expect(comet.connect(alice).transfer(bob.address, amountToTransfer)).to.be.revertedWithCustomError(comet, 'NotCollateralized');
      });

      it('borrowers transfer is paused', async () => {
        // Pause borrowers transfer
        await comet.connect(pauseGuardian).pauseBorrowersTransfer(true);

        const baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
        // Transfer will make Alice a borrower, so amount to transfer is greater than her balance
        const transferAmount = SUPPLY_AMOUNT + baseBorrowMin;
        await expect(comet.connect(alice).transfer(bob.address, transferAmount)).to.be.revertedWithCustomError(comet, 'BorrowersTransferPaused');

        // Unpause borrowers transfer
        await comet.connect(pauseGuardian).pauseBorrowersTransfer(false);
      });
    });

    describe('happy path (without interest)', function () {
      let alicePrincipalBefore: bigint;
      let bobPrincipalBefore: bigint;

      let transferTx: ContractTransaction;

      let totalSupplyBaseBefore: bigint;
      let totalBorrowBaseBefore: bigint;
      let baseSupplyIndex: bigint;

      before(async () => {
        alicePrincipalBefore = (await comet.userBasic(alice.address)).principal.toBigInt();
        bobPrincipalBefore = (await comet.userBasic(bob.address)).principal.toBigInt();
        const totalsBasic = await comet.totalsBasic();
        totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
        totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
        baseSupplyIndex = totalsBasic.baseSupplyIndex.toBigInt();
      });

      it('alice has principal equal to supplied amount', async () => {
        expect(alicePrincipalBefore).to.equal(SUPPLY_AMOUNT);
      });

      it('bob has 0 principal', async () => {
        expect(bobPrincipalBefore).to.equal(0n);
      });

      it('alice has 0 borrow balance', async () => {
        expect(await comet.borrowBalanceOf(alice.address)).to.equal(0n);
      });

      it('bob has 0 borrow balance', async () => {
        expect(await comet.borrowBalanceOf(bob.address)).to.equal(0n);
      });

      it('alice balanceOf equals to supplied amount', async () => {
        expect(await comet.balanceOf(alice.address)).to.equal(SUPPLY_AMOUNT);
      });

      it('bob balanceOf equals to 0', async () => {
        expect(await comet.balanceOf(bob.address)).to.equal(0n);
      });

      it('total supply base equals to supplied amount', async () => {
        expect(totalSupplyBaseBefore).to.equal(SUPPLY_AMOUNT);
      });

      it('total borrow base equals to 0', async () => {
        expect(totalBorrowBaseBefore).to.equal(0n);
      });

      it('transfer is successful', async () => {
        transferTx = await comet.connect(alice).transfer(bob.address, TRANSFER_AMOUNT);
        await expect(transferTx).to.not.be.reverted;
      });

      it('accrue interest', async () => {
        expect((await comet.totalsBasic()).lastAccrualTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);
      });

      it('alice princiapal decreased by transfer amount', async () => {
        const alicePrincipalAfter = (await comet.userBasic(alice.address)).principal.toBigInt();
        expect(alicePrincipalAfter).to.equal(alicePrincipalBefore - TRANSFER_AMOUNT);
      });

      it('bob principal increased by transfer amount', async () => {
        const bobPrincipalAfter = (await comet.userBasic(bob.address)).principal.toBigInt();
        expect(bobPrincipalAfter).to.equal(bobPrincipalBefore + TRANSFER_AMOUNT);
      });

      it('alice balanceOf becomes transferred amount', async () => {
        expect(await comet.balanceOf(alice.address)).to.equal(TRANSFER_AMOUNT);
      });

      it('bob balanceOf becomes transferred amount', async () => {
        expect(await comet.balanceOf(bob.address)).to.equal(TRANSFER_AMOUNT);
      });

      it('alice borrow balance is not changed', async () => {
        expect(await comet.borrowBalanceOf(alice.address)).to.equal(0n);
      });

      it('bob borrow balance is not changed', async () => {
        expect(await comet.borrowBalanceOf(bob.address)).to.equal(0n);
      });

      it('total supply base is not changed', async () => {
        expect((await comet.totalsBasic()).totalSupplyBase).to.equal(totalSupplyBaseBefore);
      });

      it('total borrow base is not changed', async () => {
        expect((await comet.totalsBasic()).totalBorrowBase).to.equal(totalBorrowBaseBefore);
      });

      it('emits Transfer event for alice', async () => {
        await expect(transferTx)
          .to.emit(comet, 'Transfer')
          .withArgs(alice.address, ZERO_ADDRESS, presentValueSupply(baseSupplyIndex, TRANSFER_AMOUNT));
      });

      it('emits Transfer event for bob', async () => {
        await expect(transferTx)
          .to.emit(comet, 'Transfer')
          .withArgs(ZERO_ADDRESS, bob.address, presentValueSupply(baseSupplyIndex, TRANSFER_AMOUNT));
      });
    });

    describe('max balance variations', function () {
      describe('without interest', function () {
        let alicePrincipalBefore: bigint;
        let bobPrincipalBefore: bigint;

        let transferTx: ContractTransaction;

        let totalSupplyBaseBefore: bigint;
        let totalBorrowBaseBefore: bigint;
        let baseSupplyIndex: bigint;

        before(async () => {
          alicePrincipalBefore = (await comet.userBasic(alice.address)).principal.toBigInt();
          bobPrincipalBefore = (await comet.userBasic(bob.address)).principal.toBigInt();
          const totalsBasic = await comet.totalsBasic();
          totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
          totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
          baseSupplyIndex = totalsBasic.baseSupplyIndex.toBigInt();
        });

        it('alice has principal equal to supplied amount', async () => {
          expect(alicePrincipalBefore).to.equal(TRANSFER_AMOUNT);
        });

        it('bob has 0 principal', async () => {
          expect(bobPrincipalBefore).to.equal(TRANSFER_AMOUNT);
        });

        it('alice has 0 borrow balance', async () => {
          expect(await comet.borrowBalanceOf(alice.address)).to.equal(0n);
        });

        it('bob has 0 borrow balance', async () => {
          expect(await comet.borrowBalanceOf(bob.address)).to.equal(0n);
        });

        it('alice balanceOf equals to transferred amount', async () => {
          expect(await comet.balanceOf(alice.address)).to.equal(TRANSFER_AMOUNT);
        });

        it('bob balanceOf equals to transferred amount', async () => {
          expect(await comet.balanceOf(bob.address)).to.equal(TRANSFER_AMOUNT);
        });

        it('total supply base equals to supplied amount', async () => {
          expect(totalSupplyBaseBefore).to.equal(SUPPLY_AMOUNT);
        });

        it('total borrow base equals to 0', async () => {
          expect(totalBorrowBaseBefore).to.equal(0n);
        });

        it('transfer is successful', async () => {
          transferTx = await comet.connect(alice).transfer(bob.address, ethers.constants.MaxUint256);
          await expect(transferTx).to.not.be.reverted;
        });

        it('alice princiapal becomes 0', async () => {
          expect((await comet.userBasic(alice.address)).principal).to.equal(0n);
        });

        it('bob principal increased by transfer amount', async () => {
          const bobPrincipalAfter = (await comet.userBasic(bob.address)).principal.toBigInt();
          expect(bobPrincipalAfter).to.equal(bobPrincipalBefore + TRANSFER_AMOUNT);
        });

        it('alice balanceOf becomes 0', async () => {
          expect(await comet.balanceOf(alice.address)).to.equal(0n);
        });

        it('bob balanceOf becomes alice supplied amount', async () => {
          expect(await comet.balanceOf(bob.address)).to.equal(SUPPLY_AMOUNT);
        });

        it('alice borrow balance is not changed', async () => {
          expect(await comet.borrowBalanceOf(alice.address)).to.equal(0n);
        });

        it('bob borrow balance is not changed', async () => {
          expect(await comet.borrowBalanceOf(bob.address)).to.equal(0n);
        });

        it('total supply base is not changed', async () => {
          expect((await comet.totalsBasic()).totalSupplyBase).to.equal(totalSupplyBaseBefore);
        });

        it('total borrow base is not changed', async () => {
          expect((await comet.totalsBasic()).totalBorrowBase).to.equal(totalBorrowBaseBefore);
        });

        it('emits Transfer event for alice', async () => {
          await expect(transferTx)
            .to.emit(comet, 'Transfer')
            .withArgs(alice.address, ZERO_ADDRESS, presentValueSupply(baseSupplyIndex, TRANSFER_AMOUNT));
        });

        it('emits Transfer event for bob', async () => {
          await expect(transferTx)
            .to.emit(comet, 'Transfer')
            .withArgs(ZERO_ADDRESS, bob.address, presentValueSupply(baseSupplyIndex, TRANSFER_AMOUNT));
        });
      });
    
      describe('with accrued interest', function () {
        const interestRateParams = {
          supplyKink: exp(0.8, 18),
          supplyInterestRateBase: exp(0.01, 18),
          supplyInterestRateSlopeLow: exp(0.04, 18),
          supplyInterestRateSlopeHigh: exp(0.4, 18),
          borrowKink: exp(0.8, 18),
          borrowInterestRateBase: exp(0.01, 18),
          borrowInterestRateSlopeLow: exp(0.05, 18),
          borrowInterestRateSlopeHigh: exp(0.3, 18),
        };
        const SUPPLY_AMOUNT:bigint = exp(100, baseTokenDecimals);

        let testComet: CometHarnessInterfaceExtendedAssetList;
        let testBaseToken: FaucetToken;

        let alice: SignerWithAddress;
        let bob: SignerWithAddress;

        let newAlicePrincipal: BigNumber;
        let newAliceBalanceOf: BigNumber;
        let bobPrincipalBefore: BigNumber;

        let earnedInterest: bigint;

        let transferTx: ContractTransaction;

        before(async () => {
          const protocol = await makeProtocol({ ...interestRateParams, base: 'USDC'});
          testComet = protocol.cometWithExtendedAssetList;
          testBaseToken = protocol.tokens.USDC as FaucetToken;

          [alice, bob] = protocol.users;

          // Allocate tokens to Alice
          await testBaseToken.allocateTo(alice.address, SUPPLY_AMOUNT);

          // Supply base tokens to Comet from Alice
          await testBaseToken.connect(alice).approve(testComet.address, SUPPLY_AMOUNT);
          await testComet.connect(alice).supply(testBaseToken.address, SUPPLY_AMOUNT);
        });

        it('alice has principal equal to supplied amount', async () => {
          newAlicePrincipal = (await testComet.userBasic(alice.address)).principal;
          expect(newAlicePrincipal).to.be.approximately(SUPPLY_AMOUNT, 1n); // 1 wei precision
        });

        it('bob has 0 principal', async () => {
          bobPrincipalBefore = (await testComet.userBasic(bob.address)).principal;
          expect(bobPrincipalBefore).to.equal(0n);
        });

        it('alice balanceOf equal to supplied amount', async () => {
          newAliceBalanceOf = await testComet.balanceOf(alice.address);
          expect(newAliceBalanceOf).to.be.approximately(SUPPLY_AMOUNT, 1n); // 1 wei precision
        });

        it('bob balanceOf equal to 0', async () => {
          expect(await testComet.balanceOf(bob.address)).to.equal(0n);
        });

        it('alice borrow balance is 0', async () => {
          expect(await testComet.borrowBalanceOf(alice.address)).to.equal(0n);
        });

        it('bob borrow balance is 0', async () => {
          expect(await testComet.borrowBalanceOf(bob.address)).to.equal(0n);
        });

        it('total supply base is equal to supplied amount', async () => {
          expect((await testComet.totalsBasic()).totalSupplyBase).to.be.approximately(SUPPLY_AMOUNT, 1n); // 1 wei precision
        });

        it('total borrow base is equal to 0', async () => {
          expect((await testComet.totalsBasic()).totalBorrowBase).to.equal(0n);
        });

        it('wait some time to accrue interest', async () => {
          await ethers.provider.send('evm_increaseTime', [60 * 3600]);
          await ethers.provider.send('evm_mine', []);

          await testComet.accrueAccount(ZERO_ADDRESS);
        });

        it('alice principal is not changed', async () => {
          expect((await testComet.userBasic(alice.address)).principal).to.equal(newAlicePrincipal);
        });

        it('earned interest is > 0', async () => {
          const baseSupplyIndex = (await testComet.totalsBasic()).baseSupplyIndex;
          earnedInterest = presentValueSupply(baseSupplyIndex, newAlicePrincipal) - SUPPLY_AMOUNT;
          expect(earnedInterest).to.be.greaterThan(0n);
        });

        it('alice balanceOf is increased', async () => {
          const updatedAliceBalanceOf = await testComet.balanceOf(alice.address);
          expect(updatedAliceBalanceOf).to.be.approximately(newAliceBalanceOf.add(earnedInterest), 1n); // 1 wei precision
          newAliceBalanceOf = updatedAliceBalanceOf;
        });

        it('bob principal and balances are not changed after some time', async () => {
          expect((await testComet.userBasic(bob.address)).principal).to.equal(bobPrincipalBefore);
          expect(await testComet.balanceOf(bob.address)).to.equal(0n);
          expect(await testComet.borrowBalanceOf(bob.address)).to.equal(0n);
        });

        it('trasnfer is successful', async () => {
          transferTx = await testComet.connect(alice).transfer(bob.address, ethers.constants.MaxUint256);
          await expect(transferTx).to.not.be.reverted;
        });

        it('alice principal becomes 0', async () => {
          expect((await testComet.userBasic(alice.address)).principal).to.equal(0n);
        });

        it('bob principal becomes alice principal after transfer', async () => {
          expect((await testComet.userBasic(bob.address)).principal).to.be.approximately(newAlicePrincipal, 1n); // 1 wei precision
        });

        it('alice balanceOf becomes 0', async () => {
          expect(await testComet.balanceOf(alice.address)).to.equal(0n);
        });

        it('bob balanceOf becomes supplied amount + earned interest', async () => {
          expect(await testComet.balanceOf(bob.address)).to.be.approximately(SUPPLY_AMOUNT + earnedInterest, 1n); // 1 wei precision
        });
      });
    });

    describe('edge cases', function () {
      describe('becomes borrower by transferring amount greater than base balance', function () {
        const BORROW_AMOUNT = exp(10, baseTokenDecimals);
        const TRANSFER_AMOUNT = SUPPLY_AMOUNT + BORROW_AMOUNT;
        const COLLATERAL_AMOUNT = exp(1, 18); // 1 WETH

        let bobPrincipalBefore: bigint;
        let alicePrincipalBefore: bigint;
        let transferTx: ContractTransaction;
        let totalSupplyBaseBefore: bigint;
        let totalBorrowBaseBefore: bigint;
        let baseSupplyIndex: bigint;
        let weth: FaucetToken;

        let snapshot: SnapshotRestorer;

        before(async () => {
          // Bob already has base balance (SUPPLY_AMOUNT) from previous "transfer max base balance" describe.
          // Supply collateral to bob so he can become a borrower when transferring more than his balance.
          weth = collaterals['WETH'] as FaucetToken;
          await weth.allocateTo(bob.address, COLLATERAL_AMOUNT);
          await weth.connect(bob).approve(comet.address, COLLATERAL_AMOUNT);
          await comet.connect(bob).supply(weth.address, COLLATERAL_AMOUNT);

          bobPrincipalBefore = (await comet.userBasic(bob.address)).principal.toBigInt();
          alicePrincipalBefore = (await comet.userBasic(alice.address)).principal.toBigInt();
          const totalsBasic = await comet.totalsBasic();
          totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
          totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
          baseSupplyIndex = totalsBasic.baseSupplyIndex.toBigInt();

          snapshot = await takeSnapshot();
        });

        it('bob has base balance equal to supplied amount', async () => {
          expect(bobPrincipalBefore).to.equal(SUPPLY_AMOUNT);
        });

        it('alice has 0 principal', async () => {
          expect(alicePrincipalBefore).to.equal(0n);
        });

        it('bob has collateral supplied', async () => {
          expect(await comet.collateralBalanceOf(bob.address, weth.address)).to.equal(COLLATERAL_AMOUNT);
        });

        it('transfer is successful (bob transfers more than base balance, becomes borrower)', async () => {
          transferTx = await comet.connect(bob).transfer(alice.address, TRANSFER_AMOUNT);
          await expect(transferTx).to.not.be.reverted;
        });

        it('bob principal is negative (borrow position)', async () => {
          expect((await comet.userBasic(bob.address)).principal).to.be.lessThan(0n);
        });

        it('bob borrow balance equals borrow amount', async () => {
          expect(await comet.borrowBalanceOf(bob.address)).to.equal(BORROW_AMOUNT);
        });

        it('alice principal increased by transfer amount', async () => {
          expect((await comet.userBasic(alice.address)).principal).to.equal(alicePrincipalBefore + TRANSFER_AMOUNT);
        });

        it('alice balanceOf equals transfer amount', async () => {
          expect(await comet.balanceOf(alice.address)).to.equal(TRANSFER_AMOUNT);
        });

        it('bob balanceOf is 0', async () => {
          expect(await comet.balanceOf(bob.address)).to.equal(0n);
        });

        it('total supply base increased by borrow amount (alice receives supply, bob withdraws)', async () => {
          // Net change: + (SUPPLY_AMOUNT + BORROW_AMOUNT) to alice, - SUPPLY_AMOUNT from bob = + BORROW_AMOUNT
          expect((await comet.totalsBasic()).totalSupplyBase).to.equal(totalSupplyBaseBefore + BORROW_AMOUNT);
        });

        it('total borrow base increased by bob borrow amount', async () => {
          expect((await comet.totalsBasic()).totalBorrowBase).to.be.approximately(totalBorrowBaseBefore + BORROW_AMOUNT, 400n);
        });

        it('emits Transfer event for bob (withdraw)', async () => {
          await expect(transferTx)
            .to.emit(comet, 'Transfer')
            .withArgs(bob.address, ZERO_ADDRESS, presentValueSupply(baseSupplyIndex, SUPPLY_AMOUNT));
        });

        it('emits Transfer event for alice (supply)', async () => {
          await expect(transferTx)
            .to.emit(comet, 'Transfer')
            .withArgs(ZERO_ADDRESS, alice.address, presentValueSupply(baseSupplyIndex, SUPPLY_AMOUNT + BORROW_AMOUNT));
          
          await snapshot.restore();
        });
      });
    });
  });

  describe('collateral', function () {
    const TRANSFER_AMOUNT:bigint = exp(1, 18);
    let collateral: FaucetToken;

    before(async () => {
      collateral = collaterals['COMP'] as FaucetToken;
      await collateral.allocateTo(alice.address, TRANSFER_AMOUNT);
      await collateral.connect(alice).approve(comet.address, TRANSFER_AMOUNT);
      await comet.connect(alice).supply(collateral.address, TRANSFER_AMOUNT);
    });

    describe('revert on', function () {
      it('self-transfer', async () => {
        await expect(comet.connect(alice).transferAsset(
          alice.address,
          collateral.address,
          TRANSFER_AMOUNT
        )).to.be.revertedWithCustomError(comet, 'NoSelfTransfer');
      });

      it('global transfer pause', async () => {
        await comet.connect(pauseGuardian).pause(false, true, false, false, false);

        await expect(comet.connect(alice).transferAsset(
          bob.address,
          collateral.address,
          TRANSFER_AMOUNT
        )).to.be.revertedWithCustomError(comet, 'Paused');

        await comet.connect(pauseGuardian).pause(false, false, false, false, false);
      });

      it('collaterals transfers pause', async () => {
        await comet.connect(pauseGuardian).pauseCollateralTransfer(true);

        await expect(comet.connect(alice).transferAsset(
          bob.address,
          collateral.address,
          TRANSFER_AMOUNT
        )).to.be.revertedWithCustomError(comet, 'CollateralTransferPaused');

        await comet.connect(pauseGuardian).pauseCollateralTransfer(false);
      });

      it('specific collateral asset transfer pause', async () => {
        await comet.connect(pauseGuardian).pauseCollateralAssetTransfer(0, true);

        await expect(comet.connect(alice).transferAsset(
          bob.address,
          collateral.address,
          TRANSFER_AMOUNT
        )).to.be.revertedWithCustomError(comet, 'CollateralAssetTransferPaused');

        await comet.connect(pauseGuardian).pauseCollateralAssetTransfer(0, false);
      });

      it('unsupported asset & amount > 0', async () => {
        // Overflow/underflow panic error
        // This happens because user can not have unsupported token balance > 0
        await expect(comet.connect(alice).transferAsset(bob.address, unsupportedToken.address, TRANSFER_AMOUNT)).to.be.revertedWithPanic('0x11'); 
      });

      it('unsupported asset & amount = 0', async () => {
        await expect(comet.connect(alice).transferAsset(bob.address, unsupportedToken.address, 0n)).to.be.revertedWithCustomError(comet, 'BadAsset');
      });

      it('amount > balance', async () => {
        const balance = await comet.collateralBalanceOf(alice.address, collateral.address);

        // 0x11: Arithmetic operation overflowed outside of an unchecked block
        await expect(comet.connect(alice).transferAsset(bob.address, collateral.address, balance.add(1))).to.be.revertedWithPanic('0x11');
      });

      describe('not collateralized', function () {
        const BORROW_AMOUNT:bigint = exp(50, baseTokenDecimals);
        const TRANSFER_AMOUNT:bigint = exp(0.8, 18);
        let snapshot: SnapshotRestorer;

        before(async () => snapshot = await takeSnapshot());

        it('alice withdraw base asset to become borrower', async () => {
          await comet.connect(alice).withdraw(baseToken.address, BORROW_AMOUNT);
        });

        it('alice principal is negative (borrow position)', async () => {
          expect((await comet.userBasic(alice.address)).principal).to.be.lessThan(0n);
        });

        // Reproduce calculation performed in isLiquidatable function
        // to check that alice is not collateralized to transfer such amount
        it('final liquidity is negative', async () => {
          const principal = (await comet.userBasic(alice.address)).principal;
          const totalsBasic = await comet.totalsBasic();
          const basePrice = await comet.getPrice(await comet.baseTokenPriceFeed());
          const baseScale = await comet.baseScale();
          const baseLiquidity = mulPrice(
            presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex),
            basePrice,
            baseScale
          );

          // Calculate liquidity for collateral
          const assetInfo = await comet.getAssetInfoByAddress(collateral.address);
          const collateralAmount = (await comet.collateralBalanceOf(alice.address, collateral.address)).sub(TRANSFER_AMOUNT).toBigInt();
          const collateralPrice = await comet.getPrice(assetInfo.priceFeed);
          const collateralLiquidity = mulPrice(collateralAmount, collateralPrice, exp(1, 18));
          const finalLiquidity = baseLiquidity + mulFactor(collateralLiquidity, assetInfo.borrowCollateralFactor.toBigInt());

          expect(finalLiquidity).to.be.lessThan(0n);
        });

        it('transfer is reverted with NotCollateralized error', async () => {
          await expect(comet.connect(alice).transferAsset(
            bob.address, 
            collateral.address, 
            TRANSFER_AMOUNT
          )).to.be.revertedWithCustomError(comet, 'NotCollateralized');
          await snapshot.restore();
        });
      });
    });

    describe('transfer asset: happy path & no borrow', function () {
      let transferTx: ContractTransaction;
      let totalsCollateralBefore: BigNumber;
      let aliceCollateralBalanceBefore: BigNumber;

      it('total collateral amount equals alice balance', async () => {
        totalsCollateralBefore = (await comet.totalsCollateral(collateral.address)).totalSupplyAsset;
        expect(totalsCollateralBefore).to.equal(TRANSFER_AMOUNT);
      });

      it('alice collateral balance equals transfer amount', async () => {
        aliceCollateralBalanceBefore = await comet.collateralBalanceOf(alice.address, collateral.address);
        expect(aliceCollateralBalanceBefore).to.equal(TRANSFER_AMOUNT);
      });

      it('dave collateral balance = 0', async () => {
        expect(await comet.collateralBalanceOf(dave.address, collateral.address)).to.equal(0n);
      });

      it('alice assetsIn has only one asset and collateral is the only asset', async () => {
        const assetsInList = await comet.getAssetList(alice.address);
        expect(assetsInList).to.include(collateral.address);
        expect((await comet.userBasic(alice.address)).assetsIn).to.equal(1);
      });

      it('dave assetsIn = 0', async () => {
        const assetsInList = await comet.getAssetList(dave.address);
        expect(assetsInList).to.be.empty;
        expect((await comet.userBasic(dave.address)).assetsIn).to.equal(0);
      });

      it('alice is not a borrower', async () => {
        // We should check that alice is not a borrower
        // In case when alice is a borrower, she need to make additional check for collateralization
        expect((await comet.userBasic(alice.address)).principal).to.equal(0n);
      });

      it('transfer is successful', async () => {
        transferTx = await comet.connect(alice).transferAsset(dave.address, collateral.address, TRANSFER_AMOUNT);
        await expect(transferTx).to.not.be.reverted;
      });

      it('TransferCollateral event is emitted', async () => {
        await expect(transferTx)
          .to.emit(comet, 'TransferCollateral')
          .withArgs(alice.address, dave.address, collateral.address, TRANSFER_AMOUNT);
      });

      it('alice collateral balance decreased by transfer amount', async () => {
        expect(await comet.collateralBalanceOf(alice.address, collateral.address)).to.equal(aliceCollateralBalanceBefore.sub(TRANSFER_AMOUNT));
      });

      it('dave collateral balance increased by transfer amount', async () => {
        expect(await comet.collateralBalanceOf(dave.address, collateral.address)).to.equal(TRANSFER_AMOUNT);
      });

      it('alice assetsIn becomes zero and asset is removed from the list', async () => {
        // We expect that transfer amount is the whole alice balance
        // So alice assetsIn is updated
        const assetsInList = await comet.getAssetList(alice.address);
        expect(assetsInList).to.be.empty;
        expect((await comet.userBasic(alice.address)).assetsIn).to.equal(0);
      });

      it('dave assetsIn increases and collateral is the only asset', async () => {
        const assetsInList = await comet.getAssetList(dave.address);
        expect(assetsInList).to.include(collateral.address);
        expect((await comet.userBasic(dave.address)).assetsIn).to.equal(1);
      });

      it('total collateral amount is not changed', async () => {
        expect((await comet.totalsCollateral(collateral.address)).totalSupplyAsset).to.equal(totalsCollateralBefore);
      });
    });

    describe('transfer asset: happy path & with borrow', function () {
      const BORROW_AMOUNT:bigint = exp(20, baseTokenDecimals);
      const PARTIAL_TRANSFER_AMOUNT:bigint = exp(0.2, 18);
      let transferTx: ContractTransaction;
      let totalsCollateralBefore: BigNumber;
      let daveCollateralBalanceBefore: BigNumber;

      // Dave already has base balance (SUPPLY_AMOUNT) from previous "transfer max base balance" describe.
      // Make Dave a borrower by withdrawing base asset
      before(async () => {
        await comet.connect(dave).withdraw(baseToken.address, BORROW_AMOUNT);
      });

      it('total collateral amount equals dave balance', async () => {
        totalsCollateralBefore = (await comet.totalsCollateral(collateral.address)).totalSupplyAsset;
        expect(totalsCollateralBefore).to.equal(TRANSFER_AMOUNT);
      });

      it('dave collateral balance equals transfer amount', async () => {
        daveCollateralBalanceBefore = await comet.collateralBalanceOf(dave.address, collateral.address);
        expect(daveCollateralBalanceBefore).to.equal(TRANSFER_AMOUNT);
      });

      it('alice collateral balance = 0', async () => {
        expect(await comet.collateralBalanceOf(alice.address, collateral.address)).to.equal(0n);
      });

      it('dave assetsIn has only one asset and collateral is the only asset', async () => {
        const assetsInList = await comet.getAssetList(dave.address);
        expect(assetsInList).to.include(collateral.address);
        expect((await comet.userBasic(dave.address)).assetsIn).to.equal(1);
      });

      it('alice assetsIn = 0', async () => {
        const assetsInList = await comet.getAssetList(alice.address);
        expect(assetsInList).to.be.empty;
        expect((await comet.userBasic(alice.address)).assetsIn).to.equal(0);
      });

      it('dave is a borrower', async () => {
        expect((await comet.userBasic(dave.address)).principal).to.be.lessThan(0n);
      });

      it('dave is collateralized for transfer amount', async () => {
        const principal = (await comet.userBasic(dave.address)).principal;
        const totalsBasic = await comet.totalsBasic();
        const basePrice = await comet.getPrice(await comet.baseTokenPriceFeed());
        const baseScale = await comet.baseScale();
        const baseLiquidity = mulPrice(
          presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex),
          basePrice,
          baseScale
        );

        // Calculate liquidity for collateral
        const assetInfo = await comet.getAssetInfoByAddress(collateral.address);
        const collateralAmount = (await comet.collateralBalanceOf(dave.address, collateral.address)).sub(PARTIAL_TRANSFER_AMOUNT).toBigInt();
        const collateralPrice = await comet.getPrice(assetInfo.priceFeed);
        const collateralLiquidity = mulPrice(collateralAmount, collateralPrice, exp(1, 18));
        const finalLiquidity = baseLiquidity + mulFactor(collateralLiquidity, assetInfo.borrowCollateralFactor.toBigInt());

        expect(finalLiquidity).to.be.greaterThan(0n);
      });

      it('transfer is successful', async () => {
        transferTx = await comet.connect(dave).transferAsset(alice.address, collateral.address, PARTIAL_TRANSFER_AMOUNT);
        await expect(transferTx).to.not.be.reverted;
      });

      it('TransferCollateral event is emitted', async () => {
        await expect(transferTx)
          .to.emit(comet, 'TransferCollateral')
          .withArgs(dave.address, alice.address, collateral.address, PARTIAL_TRANSFER_AMOUNT);
      });

      it('dave collateral balance decreased by transfer amount', async () => {
        expect(await comet.collateralBalanceOf(dave.address, collateral.address)).to.equal(daveCollateralBalanceBefore.sub(PARTIAL_TRANSFER_AMOUNT));
      });

      it('alice collateral balance increased by transfer amount', async () => {
        expect(await comet.collateralBalanceOf(alice.address, collateral.address)).to.equal(PARTIAL_TRANSFER_AMOUNT);
      });

      it('dave assetsIn is not changed', async () => {
        const assetsInList = await comet.getAssetList(dave.address);
        expect(assetsInList).to.include(collateral.address);
        expect((await comet.userBasic(dave.address)).assetsIn).to.equal(1);
      });

      it('alice assetsIn increases and collateral is the only asset', async () => {
        const assetsInList = await comet.getAssetList(dave.address);
        expect(assetsInList).to.include(collateral.address);
        expect((await comet.userBasic(dave.address)).assetsIn).to.equal(1);
      });

      it('total collateral amount is not changed', async () => {
        expect((await comet.totalsCollateral(collateral.address)).totalSupplyAsset).to.equal(totalsCollateralBefore);
      });
    });
  });
  
  /**
   * Note: tests assume, that transferFrom(), transferAssetFrom() are clones of
   * transfer(), transferAsset(), thus only key cases are checked
   */
  describe('transferFrom variations', function () {
    const BASE_TRANSFER_AMOUNT: bigint = exp(10, baseTokenDecimals);
    const COLLATERAL_TRANSFER_AMOUNT: bigint = exp(1, 18);

    let operator: SignerWithAddress;
    let holder: SignerWithAddress;
    let receiver: SignerWithAddress;

    before(async function () {
      operator = users[10];
      holder = users[11];
      receiver = users[12];
    });

    describe('transferFrom (base asset)', function () {
      before(async function () {
        await baseToken.allocateTo(holder.address, BASE_TRANSFER_AMOUNT);
        await baseToken.connect(holder).approve(comet.address, BASE_TRANSFER_AMOUNT);
        await comet.connect(holder).supply(baseToken.address, BASE_TRANSFER_AMOUNT);

        await comet.connect(holder).approve(operator.address, ethers.constants.MaxUint256);

        // wait for a while to have impact from accrual
        await ethers.provider.send('evm_increaseTime', [60 * 60]); // 1 hr
        await ethers.provider.send('evm_mine', []);
      });

      describe('revert on', function () {
        let principal: bigint;
        let baseSupplyIndex: bigint;
        let baseBorrowIndex: bigint;

        before(async () => {
          principal = (await comet.userBasic(holder.address)).principal.toBigInt();
          const totalsBasic = await comet.totalsBasic();
          baseSupplyIndex = totalsBasic.baseSupplyIndex.toBigInt();
          baseBorrowIndex = totalsBasic.baseBorrowIndex.toBigInt();
        });

        it('pause', async () => {
          await comet.connect(pauseGuardian).pause(false, true, false, false, false);

          await expect(comet.connect(operator).transferFrom(
            holder.address,
            receiver.address,
            BASE_TRANSFER_AMOUNT
          )).to.be.revertedWithCustomError(comet, 'Paused');

          await comet.connect(pauseGuardian).pause(false, false, false, false, false);
        });

        it('operator has no permission from holder', async () => {
          await comet.connect(holder).approve(operator.address, 0);

          await expect(comet.connect(operator).transferFrom(
            holder.address,
            receiver.address,
            BASE_TRANSFER_AMOUNT
          )).to.be.revertedWithCustomError(comet, 'Unauthorized');

          await comet.connect(holder).approve(operator.address, ethers.constants.MaxUint256);
        });

        it('src == dst', async () => {
          await expect(comet.connect(operator).transferFrom(
            holder.address,
            holder.address,
            BASE_TRANSFER_AMOUNT
          )).to.be.revertedWithCustomError(comet, 'NoSelfTransfer');
        });

        it('exceeds balance (no collateral supplied & newSrcBalance < baseBorrowMin)', async () => {
          const amountToTransfer = BASE_TRANSFER_AMOUNT + 10n;
          const srcBalance = presentValue(principal, baseSupplyIndex, baseBorrowIndex) - amountToTransfer;
  
          // Ensure -srcBalance < baseBorrowMin
          expect(baseBorrowMin).to.be.greaterThan(-srcBalance);
  
          await expect(comet.connect(operator).transferFrom(holder.address,receiver.address, amountToTransfer)).to.be.revertedWithCustomError(comet, 'BorrowTooSmall');
        });

        it('exceeds balance (no collateral supplied & newSrcBalance >= baseBorrowMin)', async () => {
          const amountToTransfer = BASE_TRANSFER_AMOUNT + baseBorrowMin + 10n;
          const srcBalance = presentValue(principal, baseSupplyIndex, baseBorrowIndex) - amountToTransfer;
  
          // Ensure -srcBalance >= baseBorrowMin
          expect(baseBorrowMin).to.lessThanOrEqual(-srcBalance);
  
          await expect(comet.connect(operator).transferFrom(holder.address,receiver.address, amountToTransfer)).to.be.revertedWithCustomError(comet, 'NotCollateralized');
        });
      });

      describe('happy cases', function () {
        it('should accrue state (same as transfer())', async () => {
          const snapshot: SnapshotRestorer = await takeSnapshot();

          await comet.connect(operator).transferFrom(holder.address, receiver.address, BASE_TRANSFER_AMOUNT);
          expect((await comet.totalsBasic()).lastAccrualTime).to.equal((await ethers.provider.getBlock('latest')).timestamp);

          await snapshot.restore();
        });

        it('should transfer base from holder to receiver', async () => {
          const snapshot: SnapshotRestorer = await takeSnapshot();

          const holderBalanceBeforeTx = await comet.balanceOf(holder.address);
          const receiverBalanceBeforeTx = await comet.balanceOf(receiver.address);

          await comet.connect(operator).transferFrom(holder.address, receiver.address, BASE_TRANSFER_AMOUNT);

          expect(holderBalanceBeforeTx.sub(await comet.balanceOf(holder.address))).to.be.approximately(BASE_TRANSFER_AMOUNT, 1n);
          expect((await comet.balanceOf(receiver.address)).sub(receiverBalanceBeforeTx)).to.be.approximately(BASE_TRANSFER_AMOUNT, 1n);

          await snapshot.restore();
        });

        it('should transfer base when receiver == operator', async () => {
          const snapshot: SnapshotRestorer = await takeSnapshot();

          const holderBalanceBeforeTx = await comet.balanceOf(holder.address);
          const operatorBalanceBeforeTx = await comet.balanceOf(operator.address);

          await comet.connect(operator).transferFrom(holder.address, operator.address, BASE_TRANSFER_AMOUNT);

          expect(holderBalanceBeforeTx.sub(await comet.balanceOf(holder.address))).to.be.approximately(BASE_TRANSFER_AMOUNT, 1n);
          expect((await comet.balanceOf(operator.address)).sub(operatorBalanceBeforeTx)).to.be.approximately(BASE_TRANSFER_AMOUNT, 1n);

          await snapshot.restore();
        });

        it('should transfer base when operator == holder', async () => {
          const snapshot: SnapshotRestorer = await takeSnapshot();

          const holderBalanceBeforeTx = await comet.balanceOf(holder.address);
          const receiverBalanceBeforeTx = await comet.balanceOf(receiver.address);

          await comet.connect(holder).transferFrom(holder.address, receiver.address, BASE_TRANSFER_AMOUNT);

          expect(holderBalanceBeforeTx.sub(await comet.balanceOf(holder.address))).to.be.approximately(BASE_TRANSFER_AMOUNT, 1n);
          expect((await comet.balanceOf(receiver.address)).sub(receiverBalanceBeforeTx)).to.be.approximately(BASE_TRANSFER_AMOUNT, 1n);

          await snapshot.restore();
        });

        it('should emit Transfer events', async () => {
          const snapshot: SnapshotRestorer = await takeSnapshot();
          const baseSupplyIndex = (await comet.totalsBasic()).baseSupplyIndex;

          const tx = await comet.connect(operator).transferFrom(holder.address, receiver.address, BASE_TRANSFER_AMOUNT);

          // Get all Transfer events from the transaction receipt
          const receipt = await tx.wait();
          const transferEvents = receipt.events?.filter((x) => x.event === 'Transfer') || [];

          // From src to zero address
          let transferEvent = transferEvents[0];
          expect(transferEvent).to.not.be.undefined;
          let transferFrom = transferEvent?.args?.from;
          let transferTo = transferEvent?.args?.to;
          let transferAmount = transferEvent?.args?.amount;       
          expect(transferFrom).to.be.equal(holder.address);
          expect(transferTo).to.be.equal(ZERO_ADDRESS);
          expect(transferAmount).to.be.approximately(presentValueSupply(baseSupplyIndex, BASE_TRANSFER_AMOUNT), 1);

          // From zero address to dst
          transferEvent = transferEvents[1];
          expect(transferEvent).to.not.be.undefined;
          transferFrom = transferEvent?.args?.from;
          transferTo = transferEvent?.args?.to;
          transferAmount = transferEvent?.args?.amount;       
          expect(transferFrom).to.be.equal(ZERO_ADDRESS);
          expect(transferTo).to.be.equal(receiver.address);
          expect(transferAmount).to.be.approximately(presentValueSupply(baseSupplyIndex, BASE_TRANSFER_AMOUNT), 1);

          await snapshot.restore();
        });
      });
    });

    describe('transferAssetFrom (collateral)', function () {
      const PARTIAL_COLLATERAL_AMOUNT = exp(0.5, 18);

      before(async function () {
        // Withdraw all base balance from holder
        await comet.connect(holder).withdraw(baseToken.address, ethers.constants.MaxUint256);
        // Holder already has base supplied from transferFrom (base asset) describe
        await collaterals['COMP'].allocateTo(holder.address, COLLATERAL_TRANSFER_AMOUNT);
        await collaterals['COMP'].connect(holder).approve(comet.address, COLLATERAL_TRANSFER_AMOUNT);
        await comet.connect(holder).supply(collaterals['COMP'].address, COLLATERAL_TRANSFER_AMOUNT);

        await comet.connect(holder).approve(operator.address, ethers.constants.MaxUint256);
      });

      describe('revert on', function () {
        it('pause', async () => {
          await comet.connect(pauseGuardian).pause(false, true, false, false, false);

          await expect(comet.connect(operator).transferAssetFrom(
            holder.address,
            receiver.address,
            collaterals['COMP'].address,
            PARTIAL_COLLATERAL_AMOUNT
          )).to.be.revertedWithCustomError(comet, 'Paused');

          await comet.connect(pauseGuardian).pause(false, false, false, false, false);
        });

        it('operator has no permission from holder', async () => {
          await comet.connect(holder).approve(operator.address, 0);

          await expect(comet.connect(operator).transferAssetFrom(
            holder.address,
            receiver.address,
            collaterals['COMP'].address,
            PARTIAL_COLLATERAL_AMOUNT
          )).to.be.revertedWithCustomError(comet, 'Unauthorized');

          await comet.connect(holder).approve(operator.address, ethers.constants.MaxUint256);
        });

        it('src == dst', async () => {
          await expect(comet.connect(operator).transferAssetFrom(
            holder.address,
            holder.address,
            collaterals['COMP'].address,
            PARTIAL_COLLATERAL_AMOUNT
          )).to.be.revertedWithCustomError(comet, 'NoSelfTransfer');
        });

        it('unsupported asset & amount = 0', async () => {
          await expect(comet.connect(operator).transferAssetFrom(
            holder.address,
            receiver.address,
            unsupportedToken.address,
            0n
          )).to.be.revertedWithCustomError(comet, 'BadAsset');
        });

        it('unsupported asset & amount > 0', async () => {
          await expect(comet.connect(operator).transferAssetFrom(
            holder.address,
            receiver.address,
            unsupportedToken.address,
            COLLATERAL_TRANSFER_AMOUNT
          )).to.be.revertedWithPanic('0x11');
        });

        it('amount > balance', async () => {
          const balance = await comet.collateralBalanceOf(holder.address, collaterals['COMP'].address);

          await expect(comet.connect(operator).transferAssetFrom(
            holder.address,
            receiver.address,
            collaterals['COMP'].address,
            balance.add(1)
          )).to.be.revertedWithPanic('0x11');
        });

        it('not collateralized', async () => {
          const snapshot: SnapshotRestorer = await takeSnapshot();
          const BORROW_AMOUNT = exp(50, baseTokenDecimals);
          await baseToken.allocateTo(comet.address, BORROW_AMOUNT);
          await comet.connect(holder).withdraw(baseToken.address, BORROW_AMOUNT);

          await expect(comet.connect(operator).transferAssetFrom(
            holder.address,
            receiver.address,
            collaterals['COMP'].address,
            COLLATERAL_TRANSFER_AMOUNT
          )).to.be.revertedWithCustomError(comet, 'NotCollateralized');

          await snapshot.restore();
        });
      });

      describe('happy cases', function () {
        it('should transfer collateral from holder to receiver', async () => {
          const snapshot: SnapshotRestorer = await takeSnapshot();

          const holderCollateralBeforeTx = (await comet.collateralBalanceOf(holder.address, collaterals['COMP'].address));
          const receiverCollateralBeforeTx = (await comet.collateralBalanceOf(receiver.address, collaterals['COMP'].address));
          const totalsCollateralBefore = (await comet.totalsCollateral(collaterals['COMP'].address)).totalSupplyAsset;

          const tx = await comet.connect(operator).transferAssetFrom(
            holder.address,
            receiver.address,
            collaterals['COMP'].address,
            PARTIAL_COLLATERAL_AMOUNT
          );

          // holder's collateral balance decreases
          expect(await comet.collateralBalanceOf(holder.address, collaterals['COMP'].address)).to.equal(holderCollateralBeforeTx.sub(PARTIAL_COLLATERAL_AMOUNT));
          // receiver's collateral balance grows
          expect(await comet.collateralBalanceOf(receiver.address, collaterals['COMP'].address)).to.equal(receiverCollateralBeforeTx.add(PARTIAL_COLLATERAL_AMOUNT));
          // total collateral amount is unchanged (internal transfer)
          expect((await comet.totalsCollateral(collaterals['COMP'].address)).totalSupplyAsset).to.equal(totalsCollateralBefore);
          await expect(tx)
            .to.emit(comet, 'TransferCollateral')
            .withArgs(holder.address, receiver.address, collaterals['COMP'].address, PARTIAL_COLLATERAL_AMOUNT);

          await snapshot.restore();
        });

        it('should transfer collateral when receiver == operator', async () => {
          const snapshot: SnapshotRestorer = await takeSnapshot();

          const holderCollateralBeforeTx = (await comet.collateralBalanceOf(holder.address, collaterals['COMP'].address));
          const operatorCollateralBeforeTx = (await comet.collateralBalanceOf(operator.address, collaterals['COMP'].address));

          await comet.connect(operator).transferAssetFrom(
            holder.address,
            operator.address,
            collaterals['COMP'].address,
            PARTIAL_COLLATERAL_AMOUNT
          );

          // holder's collateral balance decreases
          expect(await comet.collateralBalanceOf(holder.address, collaterals['COMP'].address)).to.equal(holderCollateralBeforeTx.sub(PARTIAL_COLLATERAL_AMOUNT));
          // operator (as receiver) collateral balance grows
          expect(await comet.collateralBalanceOf(operator.address, collaterals['COMP'].address)).to.equal(operatorCollateralBeforeTx.add(PARTIAL_COLLATERAL_AMOUNT));

          await snapshot.restore();
        });

        it('should transfer collateral when operator == holder', async () => {
          const snapshot: SnapshotRestorer = await takeSnapshot();

          const holderCollateralBeforeTx = (await comet.collateralBalanceOf(holder.address, collaterals['COMP'].address));
          const receiverCollateralBeforeTx = (await comet.collateralBalanceOf(receiver.address, collaterals['COMP'].address));

          await comet.connect(holder).transferAssetFrom(
            holder.address,
            receiver.address,
            collaterals['COMP'].address,
            PARTIAL_COLLATERAL_AMOUNT
          );

          // holder's collateral balance decreases
          expect(await comet.collateralBalanceOf(holder.address, collaterals['COMP'].address)).to.equal(holderCollateralBeforeTx.sub(PARTIAL_COLLATERAL_AMOUNT));
          // receiver's collateral balance grows (same as transferAsset())
          expect(await comet.collateralBalanceOf(receiver.address, collaterals['COMP'].address)).to.equal(receiverCollateralBeforeTx.add(PARTIAL_COLLATERAL_AMOUNT));

          await snapshot.restore();
        });
      });
    });
  });

  describe('transfer with 24 collaterals', function () {
    const TRANSFER_AMOUNT: bigint = exp(1, 18);

    let comet: CometHarnessInterfaceExtendedAssetList;
    let collaterals: { [symbol: string]: FaucetToken } = {};

    let transferTxs: ContractTransaction[] = [];

    let alice: SignerWithAddress;
    let bob: SignerWithAddress;
    before(async () => {
      // Setup protocol with MAX_ASSETS collaterals
      const cometCollaterals = Object.fromEntries(
        Array.from({ length: MAX_ASSETS }, (_, j) => [`ASSET${j}`, {
          decimals: 18, 
          initialPrice: 1,
        }])
      );
      const protocol = await makeProtocol({
        base: 'USDC',
        assets: { 
          USDC: {decimals: baseTokenDecimals, initialPrice: 1},
          ...cometCollaterals 
        },
      });

      comet = protocol.cometWithExtendedAssetList;
      for (let asset in protocol.tokens) {
        if (asset === 'USDC') continue;
        collaterals[asset] = protocol.tokens[asset] as FaucetToken;
      }

      [alice, bob] = protocol.users;
    });

    describe('pause can be set for each collateral', function () {
      it('setup: alice supply each of collaterals', async () => {
        for (const asset in collaterals) {
          await collaterals[asset].allocateTo(alice.address, TRANSFER_AMOUNT);
          await collaterals[asset].connect(alice).approve(comet.address, TRANSFER_AMOUNT);
          await comet.connect(alice).supply(collaterals[asset].address, TRANSFER_AMOUNT);
        }
      });

      it('should allow to pause each collateral transfers', async () => {
        for(let i = 0; i < MAX_ASSETS; i++) {
          await comet.connect(pauseGuardian).pauseCollateralAssetTransfer(i, true);
          expect(await comet.isCollateralAssetTransferPaused(i)).to.be.true;
        }
      });

      it('should revert when transferring collateral asset that is paused', async () => {
        for (const asset in collaterals) {
          await expect(comet.connect(alice).transferAsset(bob.address, collaterals[asset].address, TRANSFER_AMOUNT)).to.be.revertedWithCustomError(comet, 'CollateralAssetTransferPaused');
        }
      });

      it('should allow to unpause each collateral transfers', async () => {
        for(let i = 0; i < MAX_ASSETS; i++) {
          await comet.connect(pauseGuardian).pauseCollateralAssetTransfer(i, false);
          expect(await comet.isCollateralAssetTransferPaused(i)).to.be.false;
        }
      });
    });

    describe('transfer collateral works for each collateral', function () {
      it('each collateral balance is equal to supply amount', async () => {
        for (const asset in collaterals) {
          expect(await comet.collateralBalanceOf(alice.address, collaterals[asset].address)).to.be.equal(TRANSFER_AMOUNT);
        }
      });

      it('each collateral bob balance is equal to 0', async () => {
        for (const asset in collaterals) {
          expect(await comet.collateralBalanceOf(bob.address, collaterals[asset].address)).to.equal(0);
        }
      });

      it('transfer is successful for each collateral', async () => {
        for (const asset in collaterals) {
          const tx = await comet.connect(alice).transferAsset(bob.address, collaterals[asset].address, TRANSFER_AMOUNT);
          await expect(tx).to.not.be.reverted;
          transferTxs.push(tx);
        }
      });

      it('for each collateral emits TransferCollateral event', async () => {
        for (let i = 0; i < MAX_ASSETS; i++) {
          await expect(transferTxs[i])
            .to.emit(comet, 'TransferCollateral')
            .withArgs(alice.address, bob.address, collaterals[`ASSET${i}`].address, TRANSFER_AMOUNT);
        }
      });

      it('each collateral alice balance is equal to 0', async () => {
        for (const asset in collaterals) {
          expect(await comet.collateralBalanceOf(alice.address, collaterals[asset].address)).to.equal(0);
        }
      });

      it('each collateral bob balance is equal to transfer amount', async () => {
        for (const asset in collaterals) {
          expect(await comet.collateralBalanceOf(bob.address, collaterals[asset].address)).to.equal(TRANSFER_AMOUNT);
        }
      });
    });
  });

  describe('non-standard tokens', function () {
    describe('USDT-like token', function () {
      let comet: CometHarnessInterfaceExtendedAssetList;
      let alice: SignerWithAddress;
      let bob: SignerWithAddress;
      let usdt: NonStandardFaucetFeeToken;
      let nonStdCollateral: NonStandardFaucetFeeToken;
      const USDT_AMOUNT = exp(1, 6);
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
        comet = protocol.cometWithExtendedAssetList;
        const tokens = protocol.tokens;
        [alice, bob] = protocol.users;

        usdt = tokens['USDT'] as NonStandardFaucetFeeToken;
        nonStdCollateral = tokens['NonStdCollateral'] as NonStandardFaucetFeeToken;
      });

      it('can transfer base token - non-standard ERC20 (without return interface) e.g. USDT', async () => {
        await usdt.allocateTo(alice.address, USDT_AMOUNT);

        await usdt.connect(alice).approve(comet.address, USDT_AMOUNT);
        await comet.connect(alice).supply(usdt.address, USDT_AMOUNT);

        // as per the initial test case, 1st deposit will end with the same principal
        expect((await comet.userBasic(alice.address)).principal).to.equal(USDT_AMOUNT);

        await expect(comet.connect(alice).transfer(bob.address, USDT_AMOUNT)).to.not.be.reverted;

        // bob's principal should be equal to the transferred amount
        expect((await comet.userBasic(bob.address)).principal).to.equal(USDT_AMOUNT);
      });

      it('can transfer collateral - non-standard ERC20 (without return interface) e.g. USDT', async () => {
        await nonStdCollateral.allocateTo(alice.address, NON_STD_COLLATERAL_AMOUNT);

        await nonStdCollateral.connect(alice).approve(comet.address, NON_STD_COLLATERAL_AMOUNT);
        await comet.connect(alice).supply(nonStdCollateral.address, NON_STD_COLLATERAL_AMOUNT);

        expect((await comet.userCollateral(alice.address, nonStdCollateral.address)).balance).to.equal(NON_STD_COLLATERAL_AMOUNT);

        await expect(comet.connect(alice).transferAsset(bob.address, nonStdCollateral.address, NON_STD_COLLATERAL_AMOUNT)).to.not.be.reverted;

        // bob's collateral balance should be equal to the transferred amount
        expect((await comet.userCollateral(bob.address, nonStdCollateral.address)).balance).to.equal(NON_STD_COLLATERAL_AMOUNT);
      });
    });

    describe('fee-on-transfer token has no impact on transfer', function () {
      const BASE_TOKEN_AMOUNT = exp(1, 6);
      const COLLATERAL_TOKEN_AMOUNT = exp(0.5, 18);
      const NUMERATOR = 10;
      const DENOMINATOR = 10000;
      let feeComet: CometHarnessInterfaceExtendedAssetList;
      let feeBaseToken: NonStandardFaucetFeeToken;
      let feeCollateral: NonStandardFaucetFeeToken;
      let alice: SignerWithAddress;
      let bob: SignerWithAddress;
      let transferFeeTx: ContractTransaction;
      let baseAmountWithoutFee: BigNumber;
      let collateralAmountWithoutFee: BigNumber;

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
        
        feeComet = protocol.cometWithExtendedAssetList;
        feeBaseToken = protocol.tokens['USDT'] as NonStandardFaucetFeeToken;
        feeCollateral = protocol.tokens['FeeCollateral'] as NonStandardFaucetFeeToken;
        [alice, bob] = protocol.users;

        // Allocate tokens to Alice
        await feeCollateral.allocateTo(alice.address, COLLATERAL_TOKEN_AMOUNT);
        await feeBaseToken.allocateTo(alice.address, BASE_TOKEN_AMOUNT);

        // Set fee to 0.1%
        await feeBaseToken.setParams(10, exp(100, 18));
        await feeCollateral.setParams(10, exp(100, 18));

        // Base token preparation
        // We supply the amount with fee to check that it's work even on supply phase
        const baseAmountDeposited = BigNumber.from(BASE_TOKEN_AMOUNT);
        const baseFee = baseAmountDeposited.mul(NUMERATOR).div(DENOMINATOR);
        baseAmountWithoutFee = baseAmountDeposited.sub(baseFee);
        await feeBaseToken.connect(alice).approve(feeComet.address, BASE_TOKEN_AMOUNT);
        await feeComet.connect(alice).supply(feeBaseToken.address, BASE_TOKEN_AMOUNT);

        // Collateral token preparation
        // We supply the amount with fee to check that it's work even on supply phase
        const collateralAmountDeposited = BigNumber.from(COLLATERAL_TOKEN_AMOUNT);
        const collateralFee = collateralAmountDeposited.mul(NUMERATOR).div(DENOMINATOR);
        collateralAmountWithoutFee = collateralAmountDeposited.sub(collateralFee);
        await feeCollateral.connect(alice).approve(feeComet.address, COLLATERAL_TOKEN_AMOUNT);
        await feeComet.connect(alice).supply(feeCollateral.address, COLLATERAL_TOKEN_AMOUNT);

        // we are checking that the (amount - fee) is considered as deposit
        expect((await feeComet.userBasic(alice.address)).principal).to.equal(baseAmountWithoutFee);
        expect((await feeComet.userCollateral(alice.address, feeCollateral.address)).balance).to.equal(collateralAmountWithoutFee);
      });

      it('no fee is charged for transfer base token - fee-on-transfer token', async () => {
        const feeBalanceBefore = await feeBaseToken.balanceOf(feeBaseToken.address);

        transferFeeTx = await feeComet.connect(alice).transfer(bob.address, baseAmountWithoutFee);
        await expect(transferFeeTx).to.not.be.reverted;

        // bob's principal should be equal to the transferred amount (no fee is charged)
        expect((await feeComet.userBasic(bob.address)).principal).to.equal(baseAmountWithoutFee);

        const feeBalanceAfter = await feeBaseToken.balanceOf(feeBaseToken.address);

        // no fee is charged
        expect(feeBalanceAfter.sub(feeBalanceBefore)).to.equal(0);
      });

      it('correct amount in the Transfer event (withdraw) - fee-on-transfer token', async () => {
        // event should contain amount without fee
        await expect(transferFeeTx).to.emit(feeComet, 'Transfer').withArgs(alice.address, ZERO_ADDRESS, baseAmountWithoutFee);
      });

      it('correct amount in the Transfer event (supply) - fee-on-transfer token', async () => {
        // event should contain amount without fee
        await expect(transferFeeTx).to.emit(feeComet, 'Transfer').withArgs(ZERO_ADDRESS, bob.address, baseAmountWithoutFee);
      });

      it('no fee is charged for transfer collateral token - fee-on-transfer token', async () => {
        const feeBalanceBefore = await feeCollateral.balanceOf(feeCollateral.address);

        transferFeeTx = await feeComet.connect(alice).transferAsset(bob.address, feeCollateral.address, collateralAmountWithoutFee);
        await expect(transferFeeTx).to.not.be.reverted;

        const feeBalanceAfter = await feeCollateral.balanceOf(feeCollateral.address);

        // no fee is charged
        expect(feeBalanceAfter.sub(feeBalanceBefore)).to.equal(0);

        // bob's collateral balance should be equal to the transferred amount
        expect((await feeComet.userCollateral(bob.address, feeCollateral.address)).balance).to.equal(collateralAmountWithoutFee);
      });

      it('correct amount in the TransferCollateral event - fee-on-transfer token', async () => {
        // event should contain amount without fee - the actual received on the contract
        await expect(transferFeeTx).to.emit(feeComet, 'TransferCollateral').withArgs(alice.address, bob.address, feeCollateral.address, collateralAmountWithoutFee);
      });
    });
  });
});
