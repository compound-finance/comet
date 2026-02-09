import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { CometHarnessInterfaceExtendedAssetList, EvilToken, EvilToken__factory, FaucetToken, NonStandardFaucetFeeToken, } from '../build/types';
import { baseBalanceOf, ethers, event, expect, exp, makeProtocol, portfolio, ReentryAttack, setTotalsBasic, wait, fastForward, MAX_ASSETS, SnapshotRestorer, takeSnapshot } from './helpers';

describe('withdraw functionality', function () {
  // Snapshot
  let snapshot: SnapshotRestorer;

  // Contracts
  let cometWithExtendedAssetList: CometHarnessInterfaceExtendedAssetList;
  let cometWithExtendedAssetListMaxAssets: CometHarnessInterfaceExtendedAssetList;

  // Tokens
  let baseToken: FaucetToken | NonStandardFaucetFeeToken;
  let collateralToken: FaucetToken | NonStandardFaucetFeeToken;
  let tokensWithMaxAssets: {
    [symbol: string]: FaucetToken | NonStandardFaucetFeeToken;
  };

  // Signers
  let pauseGuardian: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;

  // Constants
  const baseTokenSupplyAmount = exp(100, 6);
  const collateralTokenSupplyAmount = exp(5, 18);

  before(async () => {
    const protocol = await makeProtocol({
      assets: {
        USDC: { initialPrice: 1, decimals: 6 },
        COMP: { initialPrice: 200, decimals: 18 },
      },
    });
    cometWithExtendedAssetList = protocol.cometWithExtendedAssetList;
    baseToken = protocol.tokens.USDC;
    collateralToken = protocol.tokens.COMP;
    pauseGuardian = protocol.pauseGuardian;
    alice = protocol.users[0];
    bob = protocol.users[1];

    await baseToken.allocateTo(bob.address, baseTokenSupplyAmount);
    await collateralToken.allocateTo(bob.address, collateralTokenSupplyAmount);
    // Allocate some additional base tokens to the comet for borrowing
    await baseToken.allocateTo(
      cometWithExtendedAssetList.address,
      baseTokenSupplyAmount * 5n
    );

    const collaterals = Object.fromEntries(
      Array.from({ length: MAX_ASSETS }, (_, j) => [`ASSET${j}`, {}])
    );
    const protocolWithMaxAssets = await makeProtocol({
      assets: { USDC: {}, ...collaterals },
    });
    cometWithExtendedAssetListMaxAssets =
      protocolWithMaxAssets.cometWithExtendedAssetList;
    tokensWithMaxAssets = protocolWithMaxAssets.tokens;

    await collateralToken
      .connect(bob)
      .approve(cometWithExtendedAssetList.address, collateralTokenSupplyAmount);
    await cometWithExtendedAssetList
      .connect(bob)
      .supply(collateralToken.address, collateralTokenSupplyAmount);

    await baseToken
      .connect(bob)
      .approve(cometWithExtendedAssetList.address, baseTokenSupplyAmount);
    await cometWithExtendedAssetList
      .connect(bob)
      .supply(baseToken.address, baseTokenSupplyAmount);

    // Approve Alice to withdraw from Bob
    await cometWithExtendedAssetList.connect(bob).allow(alice.address, true);
    await cometWithExtendedAssetListMaxAssets
      .connect(bob)
      .allow(alice.address, true);

    snapshot = await takeSnapshot();
  });

  describe('withdrawTo', function () {
    this.afterAll(async () => await snapshot.restore());

    it('withdraws base from sender if the asset is base', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDC } = tokens;
  
      const _i0 = await USDC.allocateTo(comet.address, 100e6);
      await setTotalsBasic(comet, {
        totalSupplyBase: 100e6,
      });
  
      const _i1 = await comet.setBasePrincipal(bob.address, 100e6);
      const cometAsB = comet.connect(bob);
  
      const p0 = await portfolio(protocol, alice.address);
      const q0 = await portfolio(protocol, bob.address);
      const s0 = await wait(cometAsB.withdrawTo(alice.address, USDC.address, 100e6));
      const t1 = await comet.totalsBasic();
      const p1 = await portfolio(protocol, alice.address);
      const q1 = await portfolio(protocol, bob.address);
  
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
  
      expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q0.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p1.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(t1.totalSupplyBase).to.be.equal(0n);
      expect(t1.totalBorrowBase).to.be.equal(0n);
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(106000);
    });
  
    it('does not emit Transfer for 0 burn', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDC, WETH } = tokens;
  
      await USDC.allocateTo(comet.address, 110e6);
      await setTotalsBasic(comet, {
        totalSupplyBase: 100e6,
      });
      await comet.setCollateralBalance(bob.address, WETH.address, exp(1, 18));
      const cometAsB = comet.connect(bob);
  
      const s0 = await wait(cometAsB.withdrawTo(alice.address, USDC.address, exp(1, 6)));
      expect(s0.receipt['events'].length).to.be.equal(2);
      expect(event(s0, 0)).to.be.deep.equal({
        Transfer: {
          from: comet.address,
          to: alice.address,
          amount: exp(1, 6),
        }
      });
      expect(event(s0, 1)).to.be.deep.equal({
        Withdraw: {
          src: bob.address,
          to: alice.address,
          amount: exp(1, 6),
        }
      });
    });
  
    it('withdraws max base balance (including accrued) from sender if the asset is base', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDC } = tokens;
  
      await USDC.allocateTo(comet.address, 110e6);
      await setTotalsBasic(comet, {
        totalSupplyBase: 100e6,
        totalBorrowBase: 50e6, // non-zero borrow to accrue interest
      });
      await comet.setBasePrincipal(bob.address, 100e6);
      const cometAsB = comet.connect(bob);
  
      // Fast forward to accrue some interest
      await fastForward(86400);
      await ethers.provider.send('evm_mine', []);
  
      const a0 = await portfolio(protocol, alice.address);
      const b0 = await portfolio(protocol, bob.address);
      const bobAccruedBalance = (await comet.callStatic.balanceOf(bob.address)).toBigInt();
      const s0 = await wait(cometAsB.withdrawTo(alice.address, USDC.address, ethers.constants.MaxUint256));
      const t1 = await comet.totalsBasic();
      const a1 = await portfolio(protocol, alice.address);
      const b1 = await portfolio(protocol, bob.address);
  
      expect(event(s0, 0)).to.be.deep.equal({
        Transfer: {
          from: comet.address,
          to: alice.address,
          amount: bobAccruedBalance,
        }
      });
      expect(event(s0, 1)).to.be.deep.equal({
        Withdraw: {
          src: bob.address,
          to: alice.address,
          amount: bobAccruedBalance,
        }
      });
      expect(event(s0, 2)).to.be.deep.equal({
        Transfer: {
          from: bob.address,
          to: ethers.constants.AddressZero,
          amount: bobAccruedBalance,
        }
      });
  
      expect(a0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(a0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b0.internal).to.be.deep.equal({ USDC: bobAccruedBalance, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(a1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(a1.external).to.be.deep.equal({ USDC: bobAccruedBalance, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(t1.totalSupplyBase).to.be.equal(0n);
      expect(t1.totalBorrowBase).to.be.equal(exp(50, 6));
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(115000);
    });
  
    it('withdraw max base should withdraw 0 if user has a borrow position', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDC, WETH } = tokens;
  
      await comet.setBasePrincipal(bob.address, -100e6);
      await comet.setCollateralBalance(bob.address, WETH.address, exp(1, 18));
      const cometAsB = comet.connect(bob);
  
      const t0 = await comet.totalsBasic();
      const a0 = await portfolio(protocol, alice.address);
      const b0 = await portfolio(protocol, bob.address);
      const s0 = await wait(cometAsB.withdrawTo(alice.address, USDC.address, ethers.constants.MaxUint256));
      const t1 = await comet.totalsBasic();
      const a1 = await portfolio(protocol, alice.address);
      const b1 = await portfolio(protocol, bob.address);
  
      expect(s0.receipt['events'].length).to.be.equal(2);
      expect(event(s0, 0)).to.be.deep.equal({
        Transfer: {
          from: comet.address,
          to: alice.address,
          amount: 0n,
        }
      });
      expect(event(s0, 1)).to.be.deep.equal({
        Withdraw: {
          src: bob.address,
          to: alice.address,
          amount: 0n,
        }
      });
  
      expect(a0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(a0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b0.internal).to.be.deep.equal({ USDC: exp(-100, 6), COMP: 0n, WETH: exp(1, 18), WBTC: 0n });
      expect(b0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(a1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(a1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b1.internal).to.be.deep.equal({ USDC: exp(-100, 6), COMP: 0n, WETH: exp(1, 18), WBTC: 0n });
      expect(b1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
      expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(121000);
    });
  
    // This demonstrates a weird quirk of the present value/principal value rounding down math.
    it('withdraws 0 but Comet Transfer event amount is 1', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice] } = protocol;
      const { USDC } = tokens;
  
      await comet.setBasePrincipal(alice.address, 99999992291226);
      await setTotalsBasic(comet, {
        totalSupplyBase: 699999944771920,
        baseSupplyIndex: 1000000131467072,
      });
  
      const s0 = await wait(comet.connect(alice).withdraw(USDC.address, 0));
  
      expect(s0.receipt['events'].length).to.be.equal(3);
      expect(event(s0, 0)).to.be.deep.equal({
        Transfer: {
          from: comet.address,
          to: alice.address,
          amount: 0n,
        }
      });
      expect(event(s0, 1)).to.be.deep.equal({
        Withdraw: {
          src: alice.address,
          to: alice.address,
          amount: 0n,
        }
      });
      // Weird quirk of round down behavior where `withdrawAmount` is 1 even though
      // `amount` is 0. So no base leaves Comet (which is expected)
      expect(event(s0, 2)).to.be.deep.equal({
        Transfer: {
          from: alice.address,
          to: ethers.constants.AddressZero,
          amount: 1n,
        }
      });
    });
  
    it('withdraws collateral from sender if the asset is collateral', async () => {
      const protocol = await makeProtocol();
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { COMP } = tokens;
  
      const _i0 = await COMP.allocateTo(comet.address, 8e8);
      const t0 = Object.assign({}, await comet.totalsCollateral(COMP.address), {
        totalSupplyAsset: 8e8,
      });
      const _b0 = await wait(comet.setTotalsCollateral(COMP.address, t0));
  
      const _i1 = await comet.setCollateralBalance(bob.address, COMP.address, 8e8);
      const cometAsB = comet.connect(bob);
  
      const p0 = await portfolio(protocol, alice.address);
      const q0 = await portfolio(protocol, bob.address);
      const s0 = await wait(cometAsB.withdrawTo(alice.address, COMP.address, 8e8));
      const t1 = await comet.totalsCollateral(COMP.address);
      const p1 = await portfolio(protocol, alice.address);
      const q1 = await portfolio(protocol, bob.address);
  
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
  
      expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
      expect(q0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p1.external).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
      expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(t1.totalSupplyAsset).to.be.equal(0n);
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(85000);
    });
  
    it('calculates base principal correctly', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDC } = tokens;
  
      await USDC.allocateTo(comet.address, 100e6);
      const _totals0 = await setTotalsBasic(comet, {
        baseSupplyIndex: 2e15,
        totalSupplyBase: 50e6, // 100e6 in present value
      });
  
      await comet.setBasePrincipal(bob.address, 50e6); // 100e6 in present value
      const cometAsB = comet.connect(bob);
  
      const alice0 = await portfolio(protocol, alice.address);
      const bob0 = await portfolio(protocol, bob.address);
  
      await wait(cometAsB.withdrawTo(alice.address, USDC.address, 100e6));
      const totals1 = await comet.totalsBasic();
      const alice1 = await portfolio(protocol, alice.address);
      const bob1 = await portfolio(protocol, bob.address);
  
      expect(alice0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(alice0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(bob0.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(bob0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(alice1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(alice1.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(bob1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(bob1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(totals1.totalSupplyBase).to.be.equal(0n);
      expect(totals1.totalBorrowBase).to.be.equal(0n);
    });
  
    it('reverts if withdrawing base exceeds the total supply', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDC } = tokens;
  
      const _i0 = await USDC.allocateTo(comet.address, 100e6);
      const _i1 = await comet.setBasePrincipal(bob.address, 100e6);
      const cometAsB = comet.connect(bob);
  
      await expect(cometAsB.withdrawTo(alice.address, USDC.address, 100e6)).to.be.reverted;
    });
  
    it('reverts if withdrawing collateral exceeds the total supply', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { COMP } = tokens;
  
      const _i0 = await COMP.allocateTo(comet.address, 8e8);
      const _i1 = await comet.setCollateralBalance(bob.address, COMP.address, 8e8);
      const cometAsB = comet.connect(bob);
  
      await expect(cometAsB.withdrawTo(alice.address, COMP.address, 8e8)).to.be.reverted;
    });
  
    it('reverts if the asset is neither collateral nor base', async () => {
      const protocol = await makeProtocol();
      const { comet, users: [alice, bob], unsupportedToken: USUP } = protocol;
  
      const _i0 = await USUP.allocateTo(comet.address, 1);
      const cometAsB = comet.connect(bob);
  
      await expect(cometAsB.withdrawTo(alice.address, USUP.address, 1)).to.be.reverted;
    });
  
    it('reverts if withdraw is paused', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, pauseGuardian, users: [alice, bob] } = protocol;
      const { USDC } = tokens;
  
      await USDC.allocateTo(comet.address, 1);
      const cometAsB = comet.connect(bob);
  
      // Pause withdraw
      await wait(comet.connect(pauseGuardian).pause(false, false, true, false, false));
      expect(await comet.isWithdrawPaused()).to.be.true;
  
      await expect(cometAsB.withdrawTo(alice.address, USDC.address, 1)).to.be.revertedWith("custom error 'Paused()'");
    });
  
    it('reverts if withdraw max for a collateral asset', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { COMP } = tokens;
  
      await COMP.allocateTo(bob.address, 100e6);
      const cometAsB = comet.connect(bob);
  
      await expect(cometAsB.withdrawTo(alice.address, COMP.address, ethers.constants.MaxUint256)).to.be.revertedWith("custom error 'InvalidUInt128()'");
    });
  
    it('borrows to withdraw if necessary/possible', async () => {
      const { comet, tokens, users: [alice, bob] } = await makeProtocol();
      const { WETH, USDC } = tokens;
  
      await USDC.allocateTo(comet.address, 1e6);
      await comet.setCollateralBalance(alice.address, WETH.address, exp(1, 18));
  
      let t0 = await comet.totalsBasic();
      await setTotalsBasic(comet, {
        baseBorrowIndex: t0.baseBorrowIndex.mul(2),
      });
  
      await comet.connect(alice).withdrawTo(bob.address, USDC.address, 1e6);
  
      expect(await baseBalanceOf(comet, alice.address)).to.eq(BigInt(-1e6));
      expect(await USDC.balanceOf(bob.address)).to.eq(1e6);
    });

    it('reverts if collateral withdraw is paused', async () => {
      // Pause collateral withdraw
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseCollateralWithdraw(true);

      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .withdrawTo(
            alice.address,
            collateralToken.address,
            collateralTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'CollateralWithdrawPaused'
      );
    });

    it('reverts if lender withdraw is paused', async () => {
      // Pause lenders withdraw
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseLendersWithdraw(true);

      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .withdrawTo(alice.address, baseToken.address, baseTokenSupplyAmount)
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'LendersWithdrawPaused'
      );
    });

    it('reverts if borrower withdraw is paused', async () => {
      // Borrow some USDC
      await cometWithExtendedAssetList
        .connect(bob)
        .withdraw(baseToken.address, baseTokenSupplyAmount * 2n);

      // Check that alice is a borrower
      const userBasic = await cometWithExtendedAssetList.userBasic(bob.address);
      expect(userBasic.principal).to.be.lessThan(0);

      // Pause borrowers withdraw
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseBorrowersWithdraw(true);

      await expect(
        cometWithExtendedAssetList
          .connect(alice)
          .withdrawTo(bob.address, baseToken.address, baseTokenSupplyAmount)
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'BorrowersWithdrawPaused'
      );
    });

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`withdrawTo reverts if collateral asset ${i} withdraw is paused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];

        // Supply the asset first
        await assetToken.allocateTo(bob.address, collateralTokenSupplyAmount);
        await assetToken
          .connect(bob)
          .approve(
            cometWithExtendedAssetListMaxAssets.address,
            collateralTokenSupplyAmount
          );
        await cometWithExtendedAssetListMaxAssets
          .connect(bob)
          .supply(assetToken.address, collateralTokenSupplyAmount);

        expect(
          await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(
            bob.address,
            assetToken.address
          )
        ).to.be.equal(collateralTokenSupplyAmount);

        // Pause specific collateral asset withdraw at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetWithdraw(assetIndex, true);

        await expect(
          cometWithExtendedAssetListMaxAssets
            .connect(bob)
            .withdrawTo(
              alice.address,
              assetToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetListMaxAssets,
          'CollateralAssetWithdrawPaused'
        );
      });
    }

    for(let i = 1; i <= MAX_ASSETS; i++) {
      it(`allows to withdrawTo collateral asset ${i} when asset becomes unpaused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
        const collateralBalanceBob = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const collateralBalanceAlice = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);
        const tokenBalanceBob = await assetToken.balanceOf(bob.address);
        const tokenBalanceAlice = await assetToken.balanceOf(alice.address);

        // Unpause specific collateral asset withdraw at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetWithdraw(assetIndex, false);

        // Withdraw the asset
        await cometWithExtendedAssetListMaxAssets.connect(bob).withdrawTo(alice.address, assetToken.address, collateralTokenSupplyAmount);

        const collateralBalanceBobAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const collateralBalanceAliceAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);
        const tokenBalanceBobAfter = await assetToken.balanceOf(bob.address);
        const tokenBalanceAliceAfter = await assetToken.balanceOf(alice.address);

        expect(collateralBalanceBobAfter).to.be.equal(collateralBalanceBob.sub(collateralTokenSupplyAmount));
        expect(collateralBalanceAliceAfter).to.be.equal(collateralBalanceAlice);
        expect(tokenBalanceBobAfter).to.be.equal(tokenBalanceBob);
        expect(tokenBalanceAliceAfter).to.be.equal(tokenBalanceAlice.add(collateralTokenSupplyAmount));
      });
    }
  });

  describe('withdraw', function () {
    this.afterAll(async () => await snapshot.restore());

    it('withdraws to sender by default', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [bob] } = protocol;
      const { USDC } = tokens;
  
      const _i0 = await USDC.allocateTo(comet.address, 100e6);
      const _t0 = await setTotalsBasic(comet, {
        totalSupplyBase: 100e6,
      });
  
      const _i1 = await comet.setBasePrincipal(bob.address, 100e6);
      const cometAsB = comet.connect(bob);
  
      const q0 = await portfolio(protocol, bob.address);
      const _s0 = await wait(cometAsB.withdraw(USDC.address, 100e6));
      const _t1 = await comet.totalsBasic();
      const q1 = await portfolio(protocol, bob.address);
  
      expect(q0.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q1.external).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
    });
  
    it('reverts if withdraw is paused', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, pauseGuardian, users: [bob] } = protocol;
      const { USDC } = tokens;
  
      await USDC.allocateTo(comet.address, 100e6);
      const cometAsB = comet.connect(bob);
  
      // Pause withdraw
      await wait(comet.connect(pauseGuardian).pause(false, false, true, false, false));
      expect(await comet.isWithdrawPaused()).to.be.true;
  
      await expect(cometAsB.withdraw(USDC.address, 100e6)).to.be.revertedWith("custom error 'Paused()'");
    });
  
    it('reverts if withdraw amount is less than baseBorrowMin', async () => {
      const { comet, tokens, users: [alice] } = await makeProtocol({
        baseBorrowMin: exp(1, 6)
      });
      const { USDC } = tokens;
  
      await expect(
        comet.connect(alice).withdraw(USDC.address, exp(.5, 6))
      ).to.be.revertedWith("custom error 'BorrowTooSmall()'");
    });
  
    it('reverts if base withdraw amount is not collateralzed', async () => {
      const { comet, tokens, users: [alice] } = await makeProtocol();
      const { USDC } = tokens;
  
      await expect(
        comet.connect(alice).withdraw(USDC.address, exp(1, 6))
      ).to.be.revertedWith("custom error 'NotCollateralized()'");
    });
  
    it('reverts if collateral withdraw amount is not collateralized', async () => {
      const { comet, tokens, users: [alice] } = await makeProtocol();
      const { WETH } = tokens;
  
      const totalsCollateral = Object.assign({}, await comet.totalsCollateral(WETH.address), {
        totalSupplyAsset: exp(1, 18),
      });
      await wait(comet.setTotalsCollateral(WETH.address, totalsCollateral));
  
      // user has a borrow, but with collateral to cover
      await comet.setBasePrincipal(alice.address, -100e6);
      await comet.setCollateralBalance(alice.address, WETH.address, exp(1, 18));
  
      // reverts if withdraw would leave borrow uncollateralized
      await expect(
        comet.connect(alice).withdraw(WETH.address, exp(1, 18))
      ).to.be.revertedWith("custom error 'NotCollateralized()'");
    });
  
    describe('reentrancy', function () {
      it('blocks malicious reentrant transferFrom', async () => {
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
        const { USDC, EVIL } = <{ USDC: FaucetToken, EVIL: EvilToken }>tokens;
  
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
  
        await comet.setCollateralBalance(alice.address, EVIL.address, exp(1, 6));
        await comet.connect(alice).allow(EVIL.address, true);
  
        // In callback, EVIL token calls transferFrom(alice.address, bob.address, 1e6)
        await expect(
          comet.connect(alice).withdraw(EVIL.address, 1e6)
        ).to.be.revertedWithCustomError(comet, 'ReentrantCallBlocked');
  
        // no USDC transferred
        expect(await USDC.balanceOf(comet.address)).to.eq(100e6);
        expect(await baseBalanceOf(comet, alice.address)).to.eq(0n);
        expect(await USDC.balanceOf(alice.address)).to.eq(0);
        expect(await baseBalanceOf(comet, bob.address)).to.eq(0n);
        expect(await USDC.balanceOf(bob.address)).to.eq(0);
      });
  
      it('blocks malicious reentrant withdrawFrom', async () => {
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
        const { USDC, EVIL } = <{ USDC: FaucetToken, EVIL: EvilToken }>tokens;
  
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
  
        await comet.setCollateralBalance(alice.address, EVIL.address, exp(1, 6));
  
        await comet.connect(alice).allow(EVIL.address, true);
  
        // in callback, EvilToken attempts to withdraw USDC to bob's address
        await expect(
          comet.connect(alice).withdraw(EVIL.address, 1e6)
        ).to.be.revertedWithCustomError(comet, 'ReentrantCallBlocked');
  
        // no USDC transferred
        expect(await USDC.balanceOf(comet.address)).to.eq(100e6);
        expect(await baseBalanceOf(comet, alice.address)).to.eq(0n);
        expect(await USDC.balanceOf(alice.address)).to.eq(0);
        expect(await baseBalanceOf(comet, bob.address)).to.eq(0n);
        expect(await USDC.balanceOf(bob.address)).to.eq(0);
      });
    });

    it('reverts if collateral withdraw is paused', async () => {
      // Pause collateral withdraw
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseCollateralWithdraw(true);

      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .withdraw(collateralToken.address, collateralTokenSupplyAmount)
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'CollateralWithdrawPaused'
      );
    });

    it('reverts if lender withdraw is paused', async () => {
      // Pause lenders withdraw
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseLendersWithdraw(true);

      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .withdraw(baseToken.address, baseTokenSupplyAmount)
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'LendersWithdrawPaused'
      );
    });

    it('reverts if borrower withdraw is paused', async () => {
      // Pause borrowers withdraw
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseBorrowersWithdraw(true);

      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .withdraw(baseToken.address, baseTokenSupplyAmount * 2n)
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'BorrowersWithdrawPaused'
      );
    });

    for (let i = 1; i <= 24; i++) {
      it(`withdraw reverts if collateral asset ${i} withdraw is paused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];

        // Supply the asset first
        await assetToken.allocateTo(bob.address, collateralTokenSupplyAmount);
        await assetToken
          .connect(bob)
          .approve(
            cometWithExtendedAssetListMaxAssets.address,
            collateralTokenSupplyAmount
          );
        await cometWithExtendedAssetListMaxAssets
          .connect(bob)
          .supply(assetToken.address, collateralTokenSupplyAmount);

        expect(
          await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(
            bob.address,
            assetToken.address
          )
        ).to.be.equal(collateralTokenSupplyAmount);

        // Pause specific collateral asset withdraw at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetWithdraw(assetIndex, true);

        await expect(
          cometWithExtendedAssetListMaxAssets
            .connect(bob)
            .withdraw(assetToken.address, collateralTokenSupplyAmount)
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetListMaxAssets,
          'CollateralAssetWithdrawPaused'
        );
      });
    }

    for(let i = 1; i <= MAX_ASSETS; i++) {
      it(`allows to withdraw collateral asset ${i} when asset becomes unpaused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
        const collateralBalance = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const tokenBalance = await assetToken.balanceOf(bob.address);

        // Unpause specific collateral asset withdraw at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetWithdraw(assetIndex, false);

        // Withdraw the asset
        await cometWithExtendedAssetListMaxAssets.connect(bob).withdraw(assetToken.address, collateralTokenSupplyAmount);

        const collateralBalanceAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const tokenBalanceAfter = await assetToken.balanceOf(bob.address);

        expect(collateralBalanceAfter).to.be.equal(collateralBalance.sub(collateralTokenSupplyAmount));
        expect(tokenBalanceAfter).to.be.equal(tokenBalance.add(collateralTokenSupplyAmount));
      });
    }
  });

  describe('withdrawFrom', function () {
    this.afterAll(async () => await snapshot.restore());

    it('withdraws from src if specified and sender has permission', async () => {
      const protocol = await makeProtocol();
      const { comet, tokens, users: [alice, bob, charlie] } = protocol;
      const { COMP } = tokens;
  
      const _i0 = await COMP.allocateTo(comet.address, 7);
      const t0 = Object.assign({}, await comet.totalsCollateral(COMP.address), {
        totalSupplyAsset: 7,
      });
      const _b0 = await wait(comet.setTotalsCollateral(COMP.address, t0));
  
      const _i1 = await comet.setCollateralBalance(bob.address, COMP.address, 7);
  
      const cometAsB = comet.connect(bob);
      const cometAsC = comet.connect(charlie);
  
      const _a1 = await wait(cometAsB.allow(charlie.address, true));
      const p0 = await portfolio(protocol, alice.address);
      const q0 = await portfolio(protocol, bob.address);
      const _s0 = await wait(cometAsC.withdrawFrom(bob.address, alice.address, COMP.address, 7));
      const p1 = await portfolio(protocol, alice.address);
      const q1 = await portfolio(protocol, bob.address);
  
      expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n });
      expect(q0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p1.external).to.be.deep.equal({ USDC: 0n, COMP: 7n, WETH: 0n, WBTC: 0n });
      expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
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

    it('reverts if collateral withdraw is paused', async () => {
      // Pause collateral withdraw
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseCollateralWithdraw(true);

      await expect(
        cometWithExtendedAssetList
          .connect(alice)
          .withdrawFrom(
            bob.address,
            alice.address,
            collateralToken.address,
            collateralTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'CollateralWithdrawPaused'
      );
    });

    it('reverts if lender withdraw is paused', async () => {
      // Pause lenders withdraw
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseLendersWithdraw(true);

      await expect(
        cometWithExtendedAssetList
          .connect(alice)
          .withdrawFrom(
            bob.address,
            alice.address,
            baseToken.address,
            baseTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'LendersWithdrawPaused'
      );
    });

    it('reverts if borrower withdraw is paused', async () => {
      // Pause borrowers withdraw
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseBorrowersWithdraw(true);

      await expect(
        cometWithExtendedAssetList
          .connect(alice)
          .withdrawFrom(
            bob.address,
            alice.address,
            baseToken.address,
            baseTokenSupplyAmount * 2n
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'BorrowersWithdrawPaused'
      );
    });

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`withdrawFrom reverts if collateral asset ${i} withdraw is paused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];

        // Supply the asset first
        await assetToken.allocateTo(bob.address, collateralTokenSupplyAmount);
        await assetToken
          .connect(bob)
          .approve(
            cometWithExtendedAssetListMaxAssets.address,
            collateralTokenSupplyAmount
          );
        await cometWithExtendedAssetListMaxAssets
          .connect(bob)
          .supply(assetToken.address, collateralTokenSupplyAmount);
        expect(
          await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(
            bob.address,
            assetToken.address
          )
        ).to.be.equal(collateralTokenSupplyAmount);

        // Pause specific collateral asset withdraw at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetWithdraw(assetIndex, true);

        await expect(
          cometWithExtendedAssetListMaxAssets
            .connect(alice)
            .withdrawFrom(
              bob.address,
              alice.address,
              assetToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetListMaxAssets,
          'CollateralAssetWithdrawPaused'
        );
      });
    }
    
    for(let i = 1; i <= MAX_ASSETS; i++) {
      it(`allows to withdrawFrom collateral asset ${i} when asset becomes unpaused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
        const collateralBalanceBob = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const collateralBalanceAlice = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);
        const tokenBalanceBob = await assetToken.balanceOf(bob.address);
        const tokenBalanceAlice = await assetToken.balanceOf(alice.address);

        // Unpause specific collateral asset withdraw at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetWithdraw(assetIndex, false);

        // Withdraw the asset
        await cometWithExtendedAssetListMaxAssets.connect(alice).withdrawFrom(bob.address, alice.address, assetToken.address, collateralTokenSupplyAmount);

        const collateralBalanceBobAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const collateralBalanceAliceAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);
        const tokenBalanceBobAfter = await assetToken.balanceOf(bob.address);
        const tokenBalanceAliceAfter = await assetToken.balanceOf(alice.address);

        expect(collateralBalanceBobAfter).to.be.equal(collateralBalanceBob.sub(collateralTokenSupplyAmount));
        expect(collateralBalanceAliceAfter).to.be.equal(collateralBalanceAlice);
        expect(tokenBalanceBobAfter).to.be.equal(tokenBalanceBob);
        expect(tokenBalanceAliceAfter).to.be.equal(tokenBalanceAlice.add(collateralTokenSupplyAmount));
      });
    }
  });
});
