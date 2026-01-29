import { CometHarnessInterfaceExtendedAssetList, FaucetToken } from 'build/types';
import { ethers, expect, exp, makeProtocol, presentValue, ZERO_ADDRESS, presentValueSupply } from './helpers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';

describe.only('transfer', function () {
  // Constants
  const baseTokenDecimals = 6;
  // Contracts
  let comet: CometHarnessInterfaceExtendedAssetList;
  let baseToken: FaucetToken;
  let tokens: { [symbol: string]: FaucetToken };
  // Accounts
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let pauseGuarding: SignerWithAddress;

  let baseBorrowMin: bigint;

  before(async () => {
    const protocol = await makeProtocol({ base: 'USDC'});
    comet = protocol.cometWithExtendedAssetList;
    baseToken = protocol.tokens.USDC as FaucetToken;
    tokens = protocol.tokens as { [symbol: string]: FaucetToken };
    pauseGuarding = protocol.pauseGuardian;

    [alice, bob] = protocol.users;

    baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
  });

  describe('lender (base token)', function () {
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
        await comet.connect(pauseGuarding).pause(false, true, false, false, false);

        await expect(comet.connect(alice).transfer(alice.address, SUPPLY_AMOUNT)).to.be.revertedWithCustomError(comet, 'Paused');
        
        // Unpause transfer
        await comet.connect(pauseGuarding).pause(false, false, false, false, false);
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

    describe('transfer max base balance (without interest)', function () {
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

    // in case when a comet has 
    describe('transfer max base balance (including accrued interest)', function () {
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

    describe('edge cases', function () {
      describe('becomes borrower by transferring amount greater than base balance', function () {
        const BORROW_AMOUNT = 10n * exp(1, baseTokenDecimals); // 10 base units
        const COLLATERAL_AMOUNT = exp(1, 18); // 1 WETH

        let bobPrincipalBefore: bigint;
        let alicePrincipalBefore: bigint;
        let transferTx: ContractTransaction;
        let totalSupplyBaseBefore: bigint;
        let totalBorrowBaseBefore: bigint;
        let baseSupplyIndex: bigint;

        before(async () => {
          // Bob already has base balance (SUPPLY_AMOUNT) from previous "transfer max base balance" describe.
          // Supply collateral to bob so he can become a borrower when transferring more than his balance.
          const weth = tokens.WETH as FaucetToken;
          await weth.allocateTo(bob.address, COLLATERAL_AMOUNT);
          await weth.connect(bob).approve(comet.address, COLLATERAL_AMOUNT);
          await comet.connect(bob).supply(weth.address, COLLATERAL_AMOUNT);

          bobPrincipalBefore = (await comet.userBasic(bob.address)).principal.toBigInt();
          alicePrincipalBefore = (await comet.userBasic(alice.address)).principal.toBigInt();
          const totalsBasic = await comet.totalsBasic();
          totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
          totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
          baseSupplyIndex = totalsBasic.baseSupplyIndex.toBigInt();
        });

        it('bob has base balance equal to supplied amount', async () => {
          expect(bobPrincipalBefore).to.equal(SUPPLY_AMOUNT);
        });

        it('alice has 0 principal', async () => {
          expect(alicePrincipalBefore).to.equal(0n);
        });

        it('bob has collateral supplied', async () => {
          const weth = tokens.WETH as FaucetToken;
          expect(await comet.collateralBalanceOf(bob.address, weth.address)).to.equal(COLLATERAL_AMOUNT);
        });

        it('transfer is successful (bob transfers more than base balance, becomes borrower)', async () => {
          const transferAmount = SUPPLY_AMOUNT + BORROW_AMOUNT;
          transferTx = await comet.connect(bob).transfer(alice.address, transferAmount);
          await expect(transferTx).to.not.be.reverted;
        });

        it('bob principal is negative (borrow position)', async () => {
          const bobPrincipalAfter = (await comet.userBasic(bob.address)).principal.toBigInt();
          expect(bobPrincipalAfter).to.be.lessThan(0n);
        });

        it('bob borrow balance equals borrow amount', async () => {
          const bobBorrowBalance = (await comet.borrowBalanceOf(bob.address)).toBigInt();
          expect(bobBorrowBalance).to.be.greaterThanOrEqual(BORROW_AMOUNT);
          expect(bobBorrowBalance).to.be.lessThanOrEqual(BORROW_AMOUNT + 1n); // index rounding
        });

        it('alice principal increased by transfer amount', async () => {
          const alicePrincipalAfter = (await comet.userBasic(alice.address)).principal.toBigInt();
          const transferAmount = SUPPLY_AMOUNT + BORROW_AMOUNT;
          expect(alicePrincipalAfter).to.equal(alicePrincipalBefore + transferAmount);
        });

        it('alice balanceOf equals transfer amount', async () => {
          const transferAmount = SUPPLY_AMOUNT + BORROW_AMOUNT;
          expect(await comet.balanceOf(alice.address)).to.equal(transferAmount);
        });

        it('bob balanceOf is 0', async () => {
          expect(await comet.balanceOf(bob.address)).to.equal(0n);
        });

        it('total supply base increased by borrow amount (alice receives supply, bob withdraws)', async () => {
          const totalSupplyBaseAfter = (await comet.totalsBasic()).totalSupplyBase.toBigInt();
          // Net change: + (SUPPLY_AMOUNT + BORROW_AMOUNT) to alice, - SUPPLY_AMOUNT from bob = + BORROW_AMOUNT
          expect(totalSupplyBaseAfter).to.equal(totalSupplyBaseBefore + BORROW_AMOUNT);
        });

        it('total borrow base increased by bob borrow amount', async () => {
          const totalBorrowBaseAfter = (await comet.totalsBasic()).totalBorrowBase.toBigInt();
          const delta = totalBorrowBaseAfter - totalBorrowBaseBefore;
          expect(delta).to.be.greaterThanOrEqual(BORROW_AMOUNT - 10000n); // index rounding
          expect(delta).to.be.lessThanOrEqual(BORROW_AMOUNT + 100n);
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
        });
      });
    });
  });
});
