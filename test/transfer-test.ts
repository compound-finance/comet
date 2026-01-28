import { CometHarnessInterfaceExtendedAssetList, FaucetToken } from 'build/types';
import { baseBalanceOf, ethers, event, expect, exp, makeProtocol, portfolio, setTotalsBasic, wait, fastForward, presentValue, ZERO_ADDRESS, presentValueSupply } from './helpers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { TotalsBasicStruct } from 'build/types/CometExt';
import { ContractTransaction } from 'ethers';

describe.only('transfer', function () {
  // Constants
  const baseTokenDecimals = 6;
  // Contracts
  let comet: CometHarnessInterfaceExtendedAssetList;
  let baseToken: FaucetToken;
  // Accounts
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let pauseGuarding: SignerWithAddress;

  let baseBorrowMin: bigint;

  before(async () => {
    const protocol = await makeProtocol({ base: 'USDC'});
    comet = protocol.cometWithExtendedAssetList;
    baseToken = protocol.tokens.USDC as FaucetToken;
    pauseGuarding = protocol.pauseGuardian;

    [alice, bob] = protocol.users;

    baseBorrowMin = (await comet.baseBorrowMin()).toBigInt();
  });

  describe('lender (base token)', function () {
    const SUPPLY_AMOUNT:bigint = exp(100, baseTokenDecimals);

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
      // user's balance, he'll become a borrower and his balance will be >= to baseBorrowMin
      // which will trigger NotCollateralized
      it('exceeds balance (no collateral supplied & newSrcBalance >= baseBorrowMin)', async () => {
        const amountToTransfer = SUPPLY_AMOUNT + baseBorrowMin;
        const srcBalance = presentValue(principal, baseSupplyIndex, baseBorrowIndex) - amountToTransfer;

        // Ensure -srcBalance >= baseBorrowMin
        expect(baseBorrowMin).to.lessThanOrEqual(-srcBalance);

        await expect(comet.connect(alice).transfer(bob.address, amountToTransfer)).to.be.revertedWithCustomError(comet, 'NotCollateralized');
      });
    });

    describe('happy path (unaccrued interest)', function () {
      const TRANSFER_AMOUNT:bigint = SUPPLY_AMOUNT / 2n;

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
  });

  // it('transfers base from sender if the asset is base', async () => {
  //   const protocol = await makeProtocol({ base: 'USDC' });
  //   const {
  //     comet,
  //     tokens,
  //     users: [alice, bob],
  //   } = protocol;
  //   const { USDC } = tokens;

  //   const _i0 = await comet.setBasePrincipal(bob.address, 100e6);
  //   const cometAsB = comet.connect(bob);

  //   const t0 = await comet.totalsBasic();
  //   const p0 = await portfolio(protocol, alice.address);
  //   const q0 = await portfolio(protocol, bob.address);
  //   const s0 = await wait(cometAsB.transferAsset(alice.address, USDC.address, 100e6));
  //   const t1 = await comet.totalsBasic();
  //   const p1 = await portfolio(protocol, alice.address);
  //   const q1 = await portfolio(protocol, bob.address);

  //   expect(event(s0, 0)).to.be.deep.equal({
  //     Transfer: {
  //       from: bob.address,
  //       to: ethers.constants.AddressZero,
  //       amount: BigInt(100e6),
  //     }
  //   });
  //   expect(event(s0, 1)).to.be.deep.equal({
  //     Transfer: {
  //       from: ethers.constants.AddressZero,
  //       to: alice.address,
  //       amount: BigInt(100e6),
  //     }
  //   });

  //   expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(q0.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(p1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
  //   expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
  //   expect(Number(s0.receipt.gasUsed)).to.be.lessThan(90000);
  // });

  // it('does not emit Transfer if 0 mint/burn', async () => {
  //   const protocol = await makeProtocol({ base: 'USDC' });
  //   const {
  //     comet,
  //     tokens,
  //     users: [alice, bob],
  //   } = protocol;
  //   const { USDC, WETH } = tokens;

  //   await comet.setCollateralBalance(bob.address, WETH.address, exp(1, 18));
  //   await comet.setBasePrincipal(alice.address, -100e6);
  //   await setTotalsBasic(comet, {
  //     totalSupplyBase: 100e6,
  //     totalBorrowBase: 100e6,
  //   });

  //   const cometAsB = comet.connect(bob);

  //   const s0 = await wait(cometAsB.transferAsset(alice.address, USDC.address, 100e6));

  //   expect(s0.receipt['events'].length).to.be.equal(0);
  // });

  // it('transfers max base balance (including accrued) from sender if the asset is base', async () => {
  //   const protocol = await makeProtocol({ base: 'USDC' });
  //   const { comet, tokens, users: [alice, bob] } = protocol;
  //   const { USDC } = tokens;

  //   await USDC.allocateTo(comet.address, 100e6);
  //   await setTotalsBasic(comet, {
  //     totalSupplyBase: 100e6,
  //     totalBorrowBase: 50e6, // non-zero borrow to accrue interest
  //   });
  //   await comet.setBasePrincipal(bob.address, 100e6);
  //   const cometAsB = comet.connect(bob);

  //   // Fast forward to accrue some interest
  //   await fastForward(86400);
  //   await ethers.provider.send('evm_mine', []);

  //   const t0 = await comet.totalsBasic();
  //   const a0 = await portfolio(protocol, alice.address);
  //   const b0 = await portfolio(protocol, bob.address);
  //   const bobAccruedBalance = (await comet.callStatic.balanceOf(bob.address)).toBigInt();
  //   const s0 = await wait(cometAsB.transferAsset(alice.address, USDC.address, ethers.constants.MaxUint256));
  //   const t1 = await comet.totalsBasic();
  //   const a1 = await portfolio(protocol, alice.address);
  //   const b1 = await portfolio(protocol, bob.address);

  //   // additional 1 wei burned, amount to clear bob gets alice to same balance - 1
  //   expect(event(s0, 0)).to.be.deep.equal({
  //     Transfer: {
  //       from: bob.address,
  //       to: ethers.constants.AddressZero,
  //       amount: bobAccruedBalance,
  //     }
  //   });
  //   expect(event(s0, 1)).to.be.deep.equal({
  //     Transfer: {
  //       from: ethers.constants.AddressZero,
  //       to: alice.address,
  //       amount: bobAccruedBalance - 1n,
  //     }
  //   });

  //   // Hitting the rounding down behavior in this specific case (which is favorable to the protocol)
  //   expect(a0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(b0.internal).to.be.deep.equal({ USDC: bobAccruedBalance, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(a1.internal).to.be.deep.equal({ USDC: bobAccruedBalance - 1n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(b1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase.sub(1));
  //   expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
  //   expect(Number(s0.receipt.gasUsed)).to.be.lessThan(105000);
  // });

  // it('transfer max base should transfer 0 if user has a borrow position', async () => {
  //   const protocol = await makeProtocol({ base: 'USDC' });
  //   const { comet, tokens, users: [alice, bob] } = protocol;
  //   const { USDC, WETH } = tokens;

  //   await comet.setBasePrincipal(bob.address, -100e6);
  //   await comet.setCollateralBalance(bob.address, WETH.address, exp(1, 18));
  //   const cometAsB = comet.connect(bob);

  //   const t0 = await comet.totalsBasic();
  //   const a0 = await portfolio(protocol, alice.address);
  //   const b0 = await portfolio(protocol, bob.address);
  //   const s0 = await wait(cometAsB.transferAsset(alice.address, USDC.address, ethers.constants.MaxUint256));
  //   const t1 = await comet.totalsBasic();
  //   const a1 = await portfolio(protocol, alice.address);
  //   const b1 = await portfolio(protocol, bob.address);

  //   expect(s0.receipt['events'].length).to.be.equal(0);
  //   expect(a0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(b0.internal).to.be.deep.equal({ USDC: exp(-100, 6), COMP: 0n, WETH: exp(1, 18), WBTC: 0n });
  //   expect(a1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(b1.internal).to.be.deep.equal({ USDC: exp(-100, 6), COMP: 0n, WETH: exp(1, 18), WBTC: 0n });
  //   expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
  //   expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
  //   expect(Number(s0.receipt.gasUsed)).to.be.lessThan(105000);
  // });

  // it('transfers collateral from sender if the asset is collateral', async () => {
  //   const protocol = await makeProtocol();
  //   const {
  //     comet,
  //     tokens,
  //     users: [alice, bob],
  //   } = protocol;
  //   const { COMP } = tokens;

  //   const _i0 = await comet.setCollateralBalance(bob.address, COMP.address, 8e8);
  //   const cometAsB = comet.connect(bob);

  //   const t0 = await comet.totalsCollateral(COMP.address);
  //   const p0 = await portfolio(protocol, alice.address);
  //   const q0 = await portfolio(protocol, bob.address);
  //   const s0 = await wait(cometAsB.transferAsset(alice.address, COMP.address, 8e8));
  //   const t1 = await comet.totalsCollateral(COMP.address);
  //   const p1 = await portfolio(protocol, alice.address);
  //   const q1 = await portfolio(protocol, bob.address);

  //   expect(event(s0, 0)).to.be.deep.equal({
  //     TransferCollateral: {
  //       from: bob.address,
  //       to: alice.address,
  //       asset: COMP.address,
  //       amount: BigInt(8e8),
  //     }
  //   });

  //   expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
  //   expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
  //   expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(t1.totalSupplyAsset).to.be.equal(t0.totalSupplyAsset);
  //   expect(Number(s0.receipt.gasUsed)).to.be.lessThan(95000);
  // });

  // it('calculates base principal correctly', async () => {
  //   const protocol = await makeProtocol({ base: 'USDC' });
  //   const { comet, tokens, users: [alice, bob] } = protocol;
  //   const { USDC } = tokens;

  //   await comet.setBasePrincipal(bob.address, 50e6); // 100e6 in present value
  //   const cometAsB = comet.connect(bob);

  //   const totals0 = await setTotalsBasic(comet, {
  //     baseSupplyIndex: 2e15,
  //   });

  //   const alice0 = await portfolio(protocol, alice.address);
  //   const bob0 = await portfolio(protocol, bob.address);

  //   await wait(cometAsB.transferAsset(alice.address, USDC.address, 100e6));
  //   const totals1 = await comet.totalsBasic();
  //   const alice1 = await portfolio(protocol, alice.address);
  //   const bob1 = await portfolio(protocol, bob.address);

  //   expect(alice0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(bob0.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(alice1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(bob1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  //   expect(totals1.totalSupplyBase).to.be.equal(totals0.totalSupplyBase);
  //   expect(totals1.totalBorrowBase).to.be.equal(totals0.totalBorrowBase);
  // });

  // it('reverts if the asset is neither collateral nor base', async () => {
  //   const protocol = await makeProtocol();
  //   const {
  //     comet,
  //     users: [alice, bob],
  //     unsupportedToken: USUP,
  //   } = protocol;

  //   const cometAsB = comet.connect(bob);

  //   await expect(cometAsB.transferAsset(alice.address, USUP.address, 1)).to.be.reverted;
  // });

  // it('reverts if transfer is paused', async () => {
  //   const protocol = await makeProtocol({ base: 'USDC' });
  //   const { comet, tokens, pauseGuardian, users: [alice, bob] } = protocol;
  //   const { USDC } = tokens;

  //   const cometAsB = comet.connect(bob);

  //   // Pause transfer
  //   await wait(comet.connect(pauseGuardian).pause(false, true, false, false, false));
  //   expect(await comet.isTransferPaused()).to.be.true;

  //   await expect(cometAsB.transferAsset(alice.address, USDC.address, 1)).to.be.revertedWith("custom error 'Paused()'");
  // });

  // it('reverts if transfer max for a collateral asset', async () => {
  //   const protocol = await makeProtocol({ base: 'USDC' });
  //   const { comet, tokens, users: [alice, bob] } = protocol;
  //   const { COMP } = tokens;

  //   await COMP.allocateTo(bob.address, 100e6);
  //   const cometAsB = comet.connect(bob);

  //   await expect(cometAsB.transferAsset(alice.address, COMP.address, ethers.constants.MaxUint256)).to.be.revertedWith("custom error 'InvalidUInt128()'");
  // });

  // it('borrows base if collateralized', async () => {
  //   const { comet, tokens, users: [alice, bob] } = await makeProtocol();
  //   const { WETH, USDC } = tokens;

  //   await comet.setCollateralBalance(alice.address, WETH.address, exp(1, 18));

  //   let t0 = await comet.totalsBasic();
  //   await setTotalsBasic(comet, {
  //     baseBorrowIndex: t0.baseBorrowIndex.mul(2),
  //   });

  //   await comet.connect(alice).transferAsset(bob.address, USDC.address, 100e6);

  //   expect(await baseBalanceOf(comet, alice.address)).to.eq(BigInt(-100e6));
  // });

  // it('cant borrow less than the minimum', async () => {
  //   const protocol = await makeProtocol();
  //   const {
  //     comet,
  //     tokens,
  //     users: [alice, bob],
  //   } = protocol;
  //   const { USDC } = tokens;

  //   const cometAsB = comet.connect(bob);

  //   const amount = (await comet.baseBorrowMin()).sub(1);
  //   await expect(cometAsB.transferAsset(alice.address, USDC.address, amount)).to.be.revertedWith(
  //     "custom error 'BorrowTooSmall()'"
  //   );
  // });

  // it('reverts on self-transfer of base token', async () => {
  //   const {
  //     comet,
  //     tokens,
  //     users: [alice],
  //   } = await makeProtocol({ base: 'USDC' });
  //   const { USDC } = tokens;

  //   await expect(
  //     comet.connect(alice).transferAsset(alice.address, USDC.address, 100)
  //   ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
  // });

  // it('reverts on self-transfer of collateral', async () => {
  //   const {
  //     comet,
  //     tokens,
  //     users: [alice],
  //   } = await makeProtocol();
  //   const { COMP } = tokens;

  //   await expect(
  //     comet.connect(alice).transferAsset(alice.address, COMP.address, 100)
  //   ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
  // });

  // it('reverts if transferring base results in an under collateralized borrow', async () => {
  //   const { comet, tokens, users: [alice, bob] } = await makeProtocol();
  //   const { USDC } = tokens;

  //   await expect(
  //     comet.connect(alice).transferAsset(bob.address, USDC.address, 100e6)
  //   ).to.be.revertedWith("custom error 'NotCollateralized()'");
  // });

  // it('reverts if transferring collateral results in an under collateralized borrow', async () => {
  //   const { comet, tokens, users: [alice, bob] } = await makeProtocol();
  //   const { WETH } = tokens;

  //   // user has a borrow, but with collateral to cover
  //   await comet.setBasePrincipal(alice.address, -100e6);
  //   await comet.setCollateralBalance(alice.address, WETH.address, exp(1, 18));

  //   // reverts if transfer would leave the borrow uncollateralized
  //   await expect(
  //     comet.connect(alice).transferAsset(bob.address, WETH.address, exp(1, 18))
  //   ).to.be.revertedWith("custom error 'NotCollateralized()'");
  // });
});

describe('transferFrom', function () {
  it('transfers from src if specified and sender has permission', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      tokens,
      users: [alice, bob, charlie],
    } = protocol;
    const { COMP } = tokens;

    const _i0 = await comet.setCollateralBalance(bob.address, COMP.address, 7);
    const cometAsB = comet.connect(bob);
    const cometAsC = comet.connect(charlie);

    const _a1 = await wait(cometAsB.allow(charlie.address, true));
    const p0 = await portfolio(protocol, alice.address);
    const q0 = await portfolio(protocol, bob.address);
    const _s0 = await wait(cometAsC.transferAssetFrom(bob.address, alice.address, COMP.address, 7));
    const p1 = await portfolio(protocol, alice.address);
    const q1 = await portfolio(protocol, bob.address);

    expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
    expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n });
    expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n });
    expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
  });

  it('reverts if src is specified and sender does not have permission', async () => {
    const protocol = await makeProtocol();
    const {
      comet,
      tokens,
      users: [alice, bob, charlie],
    } = protocol;
    const { COMP } = tokens;

    const _i0 = await comet.setCollateralBalance(bob.address, COMP.address, 7);
    const cometAsC = comet.connect(charlie);

    await expect(
      cometAsC.transferAssetFrom(bob.address, alice.address, COMP.address, 7)
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('reverts on transfer of base token from address to itself', async () => {
    const {
      comet,
      tokens,
      users: [alice, bob],
    } = await makeProtocol({ base: 'USDC' });
    const { USDC } = tokens;

    await comet.connect(bob).allow(alice.address, true);

    await expect(
      comet.connect(alice).transferAssetFrom(bob.address, bob.address, USDC.address, 100)
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
  });

  it('reverts on transfer of collateral from address to itself', async () => {
    const {
      comet,
      tokens,
      users: [alice, bob],
    } = await makeProtocol();
    const { COMP } = tokens;

    await comet.connect(bob).allow(alice.address, true);

    await expect(
      comet.connect(alice).transferAssetFrom(bob.address, bob.address, COMP.address, 100)
    ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
  });

  it('reverts if transfer is paused', async () => {
    const protocol = await makeProtocol();
    const { comet, tokens, pauseGuardian, users: [alice, bob, charlie] } = protocol;
    const { COMP } = tokens;

    await comet.setCollateralBalance(bob.address, COMP.address, 7);
    const cometAsB = comet.connect(bob);
    const cometAsC = comet.connect(charlie);

    // Pause transfer
    await wait(comet.connect(pauseGuardian).pause(false, true, false, false, false));
    expect(await comet.isTransferPaused()).to.be.true;

    await wait(cometAsB.allow(charlie.address, true));
    await expect(cometAsC.transferAssetFrom(bob.address, alice.address, COMP.address, 7)).to.be.revertedWith("custom error 'Paused()'");
  });
});
