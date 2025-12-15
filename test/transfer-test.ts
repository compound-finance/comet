import {
  CometHarnessInterfaceExtendedAssetList, FaucetToken, NonStandardFaucetFeeToken} from 'build/types';
import { baseBalanceOf, ethers, event, expect, exp, makeProtocol, portfolio, setTotalsBasic, wait, fastForward, MAX_ASSETS, SnapshotRestorer, takeSnapshot, UserCollateral, UserBasic } from './helpers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';

describe('transfer functionality', function () {
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
  let governor: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let dave: SignerWithAddress;

  // Constants
  const baseTokenSupplyAmount = exp(100, 6);
  const collateralTokenSupplyAmount = exp(1, 18);
  const collateralTokenTransferAmount = collateralTokenSupplyAmount / 4n;

  // Storage
  let deactivatedCollateralIndex: number;
  let aliceCollateralBefore: UserCollateral;
  let aliceBasicBefore: UserBasic;
  let daveCollateralBefore: UserCollateral;
  let daveBasicBefore: UserBasic;

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
    governor = protocol.governor;
    alice = protocol.users[0];
    bob = protocol.users[1];
    dave = protocol.users[2];

    const collateralAssetInfo = await cometWithExtendedAssetList.getAssetInfoByAddress(collateralToken.address);
    deactivatedCollateralIndex = collateralAssetInfo.offset;

    await baseToken.allocateTo(bob.address, baseTokenSupplyAmount);
    await collateralToken.allocateTo(bob.address, collateralTokenSupplyAmount);
    await baseToken.allocateTo(dave.address, baseTokenSupplyAmount);
    await collateralToken.allocateTo(dave.address, collateralTokenSupplyAmount);
    // Allocate some additional base tokens to the comet for borrowing
    await baseToken.allocateTo(
      cometWithExtendedAssetList.address,
      baseTokenSupplyAmount * 5n
    );

    const collaterals = Object.fromEntries(
      Array.from({ length: MAX_ASSETS }, (_, j) => [`ASSET${j}`, { initialPrice: 100, decimals: 18 }])
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

    await collateralToken
      .connect(dave)
      .approve(cometWithExtendedAssetList.address, collateralTokenSupplyAmount);
    await cometWithExtendedAssetList
      .connect(dave)
      .supply(collateralToken.address, collateralTokenSupplyAmount);

    await cometWithExtendedAssetList.connect(dave).withdraw(baseToken.address, exp(1, 6));

    aliceBasicBefore = await cometWithExtendedAssetList.userBasic(alice.address);
    aliceCollateralBefore = await cometWithExtendedAssetList.userCollateral(alice.address, collateralToken.address);
    daveCollateralBefore = await cometWithExtendedAssetList.userCollateral(dave.address, collateralToken.address);
    daveBasicBefore = await cometWithExtendedAssetList.userBasic(dave.address);

    // Allow alice to act on behalf of bob for transferFrom calls
    await cometWithExtendedAssetList.connect(dave).allow(alice.address, true);
    await cometWithExtendedAssetListMaxAssets.connect(bob).allow(alice.address, true);

    snapshot = await takeSnapshot();
  });

  describe('transfer', function () {
    this.afterAll(async () => await snapshot.restore());

    it('transfers base from sender if the asset is base', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const {
        comet,
        tokens,
        users: [alice, bob],
      } = protocol;
      const { USDC } = tokens;
  
      const _i0 = await comet.setBasePrincipal(bob.address, 100e6);
      const cometAsB = comet.connect(bob);
  
      const t0 = await comet.totalsBasic();
      const p0 = await portfolio(protocol, alice.address);
      const q0 = await portfolio(protocol, bob.address);
      const s0 = await wait(cometAsB.transferAsset(alice.address, USDC.address, 100e6));
      const t1 = await comet.totalsBasic();
      const p1 = await portfolio(protocol, alice.address);
      const q1 = await portfolio(protocol, bob.address);
  
      expect(event(s0, 0)).to.be.deep.equal({
        Transfer: {
          from: bob.address,
          to: ethers.constants.AddressZero,
          amount: BigInt(100e6),
        }
      });
      expect(event(s0, 1)).to.be.deep.equal({
        Transfer: {
          from: ethers.constants.AddressZero,
          to: alice.address,
          amount: BigInt(100e6),
        }
      });
  
      expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q0.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(p1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
      expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(90000);
    });
  
    it('does not emit Transfer if 0 mint/burn', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const {
        comet,
        tokens,
        users: [alice, bob],
      } = protocol;
      const { USDC, WETH } = tokens;
  
      await comet.setCollateralBalance(bob.address, WETH.address, exp(1, 18));
      await comet.setBasePrincipal(alice.address, -100e6);
      await setTotalsBasic(comet, {
        totalSupplyBase: 100e6,
        totalBorrowBase: 100e6,
      });
  
      const cometAsB = comet.connect(bob);
  
      const s0 = await wait(cometAsB.transferAsset(alice.address, USDC.address, 100e6));
  
      expect(s0.receipt['events'].length).to.be.equal(0);
    });
  
    it('transfers max base balance (including accrued) from sender if the asset is base', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDC } = tokens;
  
      await USDC.allocateTo(comet.address, 100e6);
      await setTotalsBasic(comet, {
        totalSupplyBase: 100e6,
        totalBorrowBase: 50e6, // non-zero borrow to accrue interest
      });
      await comet.setBasePrincipal(bob.address, 100e6);
      const cometAsB = comet.connect(bob);
  
      // Fast forward to accrue some interest
      await fastForward(86400);
      await ethers.provider.send('evm_mine', []);
  
      const t0 = await comet.totalsBasic();
      const a0 = await portfolio(protocol, alice.address);
      const b0 = await portfolio(protocol, bob.address);
      const bobAccruedBalance = (await comet.callStatic.balanceOf(bob.address)).toBigInt();
      const s0 = await wait(cometAsB.transferAsset(alice.address, USDC.address, ethers.constants.MaxUint256));
      const t1 = await comet.totalsBasic();
      const a1 = await portfolio(protocol, alice.address);
      const b1 = await portfolio(protocol, bob.address);
  
      // additional 1 wei burned, amount to clear bob gets alice to same balance - 1
      expect(event(s0, 0)).to.be.deep.equal({
        Transfer: {
          from: bob.address,
          to: ethers.constants.AddressZero,
          amount: bobAccruedBalance,
        }
      });
      expect(event(s0, 1)).to.be.deep.equal({
        Transfer: {
          from: ethers.constants.AddressZero,
          to: alice.address,
          amount: bobAccruedBalance - 1n,
        }
      });
  
      // Hitting the rounding down behavior in this specific case (which is favorable to the protocol)
      expect(a0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b0.internal).to.be.deep.equal({ USDC: bobAccruedBalance, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(a1.internal).to.be.deep.equal({ USDC: bobAccruedBalance - 1n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase.sub(1));
      expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(105000);
    });
  
    it('transfer max base should transfer 0 if user has a borrow position', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDC, WETH } = tokens;
  
      await comet.setBasePrincipal(bob.address, -100e6);
      await comet.setCollateralBalance(bob.address, WETH.address, exp(1, 18));
      const cometAsB = comet.connect(bob);
  
      const t0 = await comet.totalsBasic();
      const a0 = await portfolio(protocol, alice.address);
      const b0 = await portfolio(protocol, bob.address);
      const s0 = await wait(cometAsB.transferAsset(alice.address, USDC.address, ethers.constants.MaxUint256));
      const t1 = await comet.totalsBasic();
      const a1 = await portfolio(protocol, alice.address);
      const b1 = await portfolio(protocol, bob.address);
  
      expect(s0.receipt['events'].length).to.be.equal(0);
      expect(a0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b0.internal).to.be.deep.equal({ USDC: exp(-100, 6), COMP: 0n, WETH: exp(1, 18), WBTC: 0n });
      expect(a1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(b1.internal).to.be.deep.equal({ USDC: exp(-100, 6), COMP: 0n, WETH: exp(1, 18), WBTC: 0n });
      expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase);
      expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(105000);
    });
  
    it('transfers collateral from sender if the asset is collateral', async () => {
      const protocol = await makeProtocol();
      const {
        comet,
        tokens,
        users: [alice, bob],
      } = protocol;
      const { COMP } = tokens;
  
      const _i0 = await comet.setCollateralBalance(bob.address, COMP.address, 8e8);
      const cometAsB = comet.connect(bob);
  
      const t0 = await comet.totalsCollateral(COMP.address);
      const p0 = await portfolio(protocol, alice.address);
      const q0 = await portfolio(protocol, bob.address);
      const s0 = await wait(cometAsB.transferAsset(alice.address, COMP.address, 8e8));
      const t1 = await comet.totalsCollateral(COMP.address);
      const p1 = await portfolio(protocol, alice.address);
      const q1 = await portfolio(protocol, bob.address);
  
      expect(event(s0, 0)).to.be.deep.equal({
        TransferCollateral: {
          from: bob.address,
          to: alice.address,
          asset: COMP.address,
          amount: BigInt(8e8),
        }
      });
  
      expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
      expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: exp(8, 8), WETH: 0n, WBTC: 0n });
      expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(t1.totalSupplyAsset).to.be.equal(t0.totalSupplyAsset);
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(95000);
    });
  
    it('calculates base principal correctly', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDC } = tokens;
  
      await comet.setBasePrincipal(bob.address, 50e6); // 100e6 in present value
      const cometAsB = comet.connect(bob);
  
      const totals0 = await setTotalsBasic(comet, {
        baseSupplyIndex: 2e15,
      });
  
      const alice0 = await portfolio(protocol, alice.address);
      const bob0 = await portfolio(protocol, bob.address);
  
      await wait(cometAsB.transferAsset(alice.address, USDC.address, 100e6));
      const totals1 = await comet.totalsBasic();
      const alice1 = await portfolio(protocol, alice.address);
      const bob1 = await portfolio(protocol, bob.address);
  
      expect(alice0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(bob0.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(alice1.internal).to.be.deep.equal({ USDC: exp(100, 6), COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(bob1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n });
      expect(totals1.totalSupplyBase).to.be.equal(totals0.totalSupplyBase);
      expect(totals1.totalBorrowBase).to.be.equal(totals0.totalBorrowBase);
    });
  
    it('reverts if the asset is neither collateral nor base', async () => {
      const protocol = await makeProtocol();
      const {
        comet,
        users: [alice, bob],
        unsupportedToken: USUP,
      } = protocol;
  
      const cometAsB = comet.connect(bob);
  
      await expect(cometAsB.transferAsset(alice.address, USUP.address, 1)).to.be.reverted;
    });
  
    it('reverts if transfer is paused', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, pauseGuardian, users: [alice, bob] } = protocol;
      const { USDC } = tokens;
  
      const cometAsB = comet.connect(bob);
  
      // Pause transfer
      await wait(comet.connect(pauseGuardian).pause(false, true, false, false, false));
      expect(await comet.isTransferPaused()).to.be.true;
  
      await expect(cometAsB.transferAsset(alice.address, USDC.address, 1)).to.be.revertedWith("custom error 'Paused()'");
    });
  
    it('reverts if transfer max for a collateral asset', async () => {
      const protocol = await makeProtocol({ base: 'USDC' });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { COMP } = tokens;
  
      await COMP.allocateTo(bob.address, 100e6);
      const cometAsB = comet.connect(bob);
  
      await expect(cometAsB.transferAsset(alice.address, COMP.address, ethers.constants.MaxUint256)).to.be.revertedWith("custom error 'InvalidUInt128()'");
    });
  
    it('borrows base if collateralized', async () => {
      const { comet, tokens, users: [alice, bob] } = await makeProtocol();
      const { WETH, USDC } = tokens;
  
      await comet.setCollateralBalance(alice.address, WETH.address, exp(1, 18));
  
      let t0 = await comet.totalsBasic();
      await setTotalsBasic(comet, {
        baseBorrowIndex: t0.baseBorrowIndex.mul(2),
      });
  
      await comet.connect(alice).transferAsset(bob.address, USDC.address, 100e6);
  
      expect(await baseBalanceOf(comet, alice.address)).to.eq(BigInt(-100e6));
    });
  
    it('cant borrow less than the minimum', async () => {
      const protocol = await makeProtocol();
      const {
        comet,
        tokens,
        users: [alice, bob],
      } = protocol;
      const { USDC } = tokens;
  
      const cometAsB = comet.connect(bob);
  
      const amount = (await comet.baseBorrowMin()).sub(1);
      await expect(cometAsB.transferAsset(alice.address, USDC.address, amount)).to.be.revertedWith(
        "custom error 'BorrowTooSmall()'"
      );
    });
  
    it('reverts on self-transfer of base token', async () => {
      const {
        comet,
        tokens,
        users: [alice],
      } = await makeProtocol({ base: 'USDC' });
      const { USDC } = tokens;
  
      await expect(
        comet.connect(alice).transferAsset(alice.address, USDC.address, 100)
      ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
    });
  
    it('reverts on self-transfer of collateral', async () => {
      const {
        comet,
        tokens,
        users: [alice],
      } = await makeProtocol();
      const { COMP } = tokens;
  
      await expect(
        comet.connect(alice).transferAsset(alice.address, COMP.address, 100)
      ).to.be.revertedWith("custom error 'NoSelfTransfer()'");
    });
  
    it('reverts if transferring base results in an under collateralized borrow', async () => {
      const { comet, tokens, users: [alice, bob] } = await makeProtocol();
      const { USDC } = tokens;
  
      await expect(
        comet.connect(alice).transferAsset(bob.address, USDC.address, 100e6)
      ).to.be.revertedWith("custom error 'NotCollateralized()'");
    });
  
    it('reverts if transferring collateral results in an under collateralized borrow', async () => {
      const { comet, tokens, users: [alice, bob] } = await makeProtocol();
      const { WETH } = tokens;
  
      // user has a borrow, but with collateral to cover
      await comet.setBasePrincipal(alice.address, -100e6);
      await comet.setCollateralBalance(alice.address, WETH.address, exp(1, 18));
  
      // reverts if transfer would leave the borrow uncollateralized
      await expect(
        comet.connect(alice).transferAsset(bob.address, WETH.address, exp(1, 18))
      ).to.be.revertedWith("custom error 'NotCollateralized()'");
    });

    it('reverts if collateral transfer paused', async () => {
      // Pause collateral transfer
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseCollateralTransfer(true);

      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .transferAsset(
            alice.address,
            collateralToken.address,
            collateralTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'CollateralTransferPaused'
      );
    });

    it('reverts if lenders transfer is paused', async () => {
      // Note: we make here restore to avoid error InvalidUInt64
      await snapshot.restore();

      // Pause lenders transfer
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseLendersTransfer(true);

      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .transferAsset(
            alice.address,
            baseToken.address,
            baseTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'LendersTransferPaused'
      );
    });

    it('reverts if borrower transfer is paused', async () => {
      // Borrow some USDC
      await cometWithExtendedAssetList
        .connect(bob)
        .withdraw(baseToken.address, baseTokenSupplyAmount * 2n);

      // Check that alice is a borrower
      const userBasic = await cometWithExtendedAssetList.userBasic(bob.address);
      expect(userBasic.principal).to.be.lessThan(0);

      // Pause borrowers transfer
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseBorrowersTransfer(true);

      // Transfer
      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .transferAsset(
            alice.address,
            baseToken.address,
            baseTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'BorrowersTransferPaused'
      );
    });

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`transfer reverts if collateral asset ${i} transfer is paused`, async () => {
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

        // Pause specific collateral asset transfer at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetTransfer(assetIndex, true);

        await expect(
          cometWithExtendedAssetListMaxAssets
            .connect(bob)
            .transferAsset(
              alice.address,
              assetToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetListMaxAssets,
          'CollateralAssetTransferPaused'
        );
      });
    }

    for(let i = 1; i <= MAX_ASSETS; i++) {
      it(`allows to transfer collateral asset ${i} when asset becomes unpaused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
        const collateralBalanceBob = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const collateralBalanceAlice = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);

        // Unpause specific collateral asset transfer at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetTransfer(assetIndex, false);

        // Transfer the asset
        await cometWithExtendedAssetListMaxAssets.connect(bob).transferAsset(alice.address, assetToken.address, collateralTokenSupplyAmount);

        const collateralBalanceBobAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const collateralBalanceAliceAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);
        expect(collateralBalanceBobAfter).to.be.equal(collateralBalanceBob.sub(collateralTokenSupplyAmount));
        expect(collateralBalanceAliceAfter).to.be.equal(collateralBalanceAlice.add(collateralTokenSupplyAmount));
      });
    }

    /**
     * @notice End-to-end transfer behavior when collateral is deactivated and reactivated
     * @dev
     *  This block validates how both **collateral transfers** and **base token transfers**
     *  behave when a collateral asset is deactivated by the `pauseGuardian` and later
     *  reactivated by the `governor`, using the same deactivation mechanism introduced
     *  after the wUSDM / deUSD incident.
     *
     *  High-level flow:
     *  - From a prepared snapshot, where `dave` holds collateral and a borrow position
     *    against `collateralToken` (with index `deactivatedCollateralIndex`), the
     *    `pauseGuardian` calls `deactivateCollateral(deactivatedCollateralIndex)` on
     *    `CometWithExtendedAssetList`.
     *      - We assert that:
     *          - The call succeeds (no revert).
     *          - It emits:
     *              - `CollateralAssetTransferPauseAction(deactivatedCollateralIndex, true)`
     *              - `CollateralDeactivated(deactivatedCollateralIndex)`
     *          - Core state is updated:
     *              - `isCollateralDeactivated(deactivatedCollateralIndex)` is `true`.
     *              - `isCollateralAssetTransferPaused(deactivatedCollateralIndex)` is `true`.
     *
     *  - With the collateral now deactivated:
     *      - A `transferAsset` call for that collateral is expected to revert with
     *        `CollateralAssetTransferPaused(deactivatedCollateralIndex)`, demonstrating
     *        that no further collateral movement is allowed while deactivated.
     *      - Additionally, a base token `transfer` from `dave` (who is a borrower and still
     *        holds the deactivated collateral) is expected to revert with
     *        `TokenIsDeactivated(collateralToken)`. This threads through the check in
     *        `isBorrowCollateralized`, which now treats deactivated collateral as
     *        disallowed for borrow collateralization, effectively freezing further base
     *        transfers that would rely on that collateral while the account is borrowing.
     *
     *  - The `governor` then calls `activateCollateral(deactivatedCollateralIndex)`:
     *      - We assert that:
     *          - The call succeeds.
     *          - It emits:
     *              - `CollateralAssetTransferPauseAction(deactivatedCollateralIndex, false)`
     *              - `CollateralActivated(deactivatedCollateralIndex)`
     *          - Core state is updated:
     *              - `isCollateralDeactivated(deactivatedCollateralIndex)` is `false`.
     *              - `isCollateralAssetTransferPaused(deactivatedCollateralIndex)` is `false`.
     *
     *  - After reactivation:
     *      - A `transferAsset` of the previously deactivated collateral from `dave` to
     *        `alice` is allowed and:
     *          - Decreases `dave`’s `userCollateral(...).balance` by the transfer amount.
     *          - Increases `alice`’s collateral balance by the same amount.
     *      - A base token `transfer` from `dave` to `alice` is now permitted again, and
     *        subsequent checks (not shown in the snippet above) verify that principals and
     *        overall accounting behave as expected.
     *
     *  In summary, these tests confirm that:
     *  - Deactivating collateral prevents both **collateral token transfers** and
     *    **borrower base transfers** that depend on that collateral.
     *  - Reactivating collateral restores both transfer paths.
     *  - The system’s safety behavior around deactivated collateral is enforced at the
     *    transfer level, consistent with the broader collateral deactivation design.
     */
    describe('deactivated collateral transfer flow', function () {
      let deactivateCollateralTx: ContractTransaction;
      let activateCollateralTx: ContractTransaction;
      
      it('allows pause guardian to deactivate a token', async function () {
        await snapshot.restore();

        deactivateCollateralTx = await cometWithExtendedAssetList.connect(pauseGuardian).deactivateCollateral(deactivatedCollateralIndex);
        await expect(deactivateCollateralTx).to.not.be.reverted;
      });

      it('emits CollateralAssetTransferPauseAction event with true argument', async function () {
        expect(deactivateCollateralTx).to.emit(cometWithExtendedAssetList, 'CollateralAssetTransferPauseAction').withArgs(deactivatedCollateralIndex, true);
      });

      it('emits CollateralDeactivated event', async function () {
        expect(deactivateCollateralTx).to.emit(cometWithExtendedAssetList, 'CollateralDeactivated').withArgs(deactivatedCollateralIndex);
      });

      it('sets collateral as deactivated in comet', async function () {
        expect(await cometWithExtendedAssetList.isCollateralDeactivated(deactivatedCollateralIndex)).to.be.true;
      });
      
      it('updates collateral transfer pause flag in comet storage', async function () {
        expect(await cometWithExtendedAssetList.isCollateralAssetTransferPaused(deactivatedCollateralIndex)).to.be.true;
      });

      it('asset transfer call reverts', async function () {
        await expect(
          cometWithExtendedAssetList
            .connect(dave)
            .transferAsset(
              alice.address,
              collateralToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetList,
          'CollateralAssetTransferPaused'
        ).withArgs(deactivatedCollateralIndex);
      });

      it('base token transfer reverts when user has deactivated collateral and borrow position', async function () {
        expect((await cometWithExtendedAssetList.userBasic(dave.address)).principal).to.be.lessThan(0);
        
        await expect(
          cometWithExtendedAssetList
            .connect(dave)
            .transfer(
              alice.address,
              baseTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetList,
          'TokenIsDeactivated'
        ).withArgs(collateralToken.address);
      });

      it('allows governor to activate a token', async function () {
        activateCollateralTx = await cometWithExtendedAssetList.connect(governor).activateCollateral(deactivatedCollateralIndex);
        await expect(activateCollateralTx).to.not.be.reverted;
      });

      it('emits CollateralAssetTransferPauseAction event with false argument', async function () {
        expect(activateCollateralTx).to.emit(cometWithExtendedAssetList, 'CollateralAssetTransferPauseAction').withArgs(deactivatedCollateralIndex, false);
      });

      it('emits CollateralActivated event', async function () {
        expect(activateCollateralTx).to.emit(cometWithExtendedAssetList, 'CollateralActivated').withArgs(deactivatedCollateralIndex);
      });
      

      it('sets collateral as activated in comet', async function () {
        expect(await cometWithExtendedAssetList.isCollateralDeactivated(deactivatedCollateralIndex)).to.be.false;
      });
      
      it('updates collateral transfer pause flag in comet storage', async function () {
        expect(await cometWithExtendedAssetList.isCollateralAssetTransferPaused(deactivatedCollateralIndex)).to.be.false;
      });

      it('allows to transfer activated collateral', async function () { 
        await cometWithExtendedAssetList
          .connect(dave)
          .transferAsset(alice.address, collateralToken.address, collateralTokenTransferAmount);
      });

      it('updates users collateral balances', async function () {
        const daveCollateralAfter = await cometWithExtendedAssetList.userCollateral(dave.address, collateralToken.address);
        const aliceCollateralAfter = await cometWithExtendedAssetList.userCollateral(alice.address, collateralToken.address);

        expect(daveCollateralBefore.balance.sub(daveCollateralAfter.balance)).to.eq(collateralTokenTransferAmount);
        expect(aliceCollateralAfter.balance.sub(aliceCollateralBefore.balance)).to.eq(collateralTokenTransferAmount);
      });

      it('allows to transfer base token', async function () {
        await cometWithExtendedAssetList
          .connect(dave)
          .transfer(alice.address, baseTokenSupplyAmount);
      });

      it('updates users principals', async function () {
        const aliceBasicAfter = await cometWithExtendedAssetList.userBasic(alice.address);
        const daveBasicAfter = await cometWithExtendedAssetList.userBasic(dave.address);

        expect(aliceBasicAfter.principal.sub(aliceBasicBefore.principal)).to.be.closeTo(baseTokenSupplyAmount, 1);
        expect(daveBasicAfter.principal.sub(daveBasicBefore.principal)).to.be.closeTo(-baseTokenSupplyAmount, 1);
      });

      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`transfer reverts if collateral asset ${i} transfer is paused`, async () => {
          // Get the asset at index i-1
          const assetIndex = i - 1;
          const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
          
          // Supply the asset first
          await assetToken.allocateTo(dave.address, collateralTokenSupplyAmount);
          await assetToken
            .connect(dave)
            .approve(
              cometWithExtendedAssetListMaxAssets.address,
              collateralTokenSupplyAmount
            );

          await cometWithExtendedAssetListMaxAssets
            .connect(dave)
            .supply(assetToken.address, collateralTokenSupplyAmount);

          // Pause specific collateral asset transfer at index assetIndex
          await cometWithExtendedAssetListMaxAssets
            .connect(pauseGuardian)
            .pauseCollateralAssetTransfer(assetIndex, true);

          await expect(
            cometWithExtendedAssetListMaxAssets
              .connect(dave)
              .transferAsset(
                alice.address,
                assetToken.address,
                collateralTokenSupplyAmount
              )
          ).to.be.revertedWithCustomError(
            cometWithExtendedAssetListMaxAssets,
            'CollateralAssetTransferPaused'
          ).withArgs(assetIndex);
        });
      }
    });
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

    it('reverts if collateral transfer paused', async () => {
      // Pause collateral transfer
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseCollateralTransfer(true);

      await cometWithExtendedAssetList.connect(bob).allow(alice.address, true);
      await expect(
        cometWithExtendedAssetList
          .connect(alice)
          .transferAssetFrom(
            bob.address,
            alice.address,
            collateralToken.address,
            collateralTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'CollateralTransferPaused'
      );
    });

    it('reverts if lenders transfer is paused', async () => {
      const userBasic = await cometWithExtendedAssetList.userBasic(bob.address);
      expect(userBasic.principal).to.be.greaterThanOrEqual(0);

      // Pause lenders transfer
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseLendersTransfer(true);

      await expect(
        cometWithExtendedAssetList
          .connect(alice)
          .transferAssetFrom(
            bob.address,
            alice.address,
            baseToken.address,
            baseTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'LendersTransferPaused'
      );
    });

    it('reverts if borrower transfer is paused', async () => {
      // Borrow some USDC
      await cometWithExtendedAssetList
        .connect(bob)
        .withdraw(baseToken.address, baseTokenSupplyAmount * 2n);

      // Check that alice is a borrower
      const userBasic = await cometWithExtendedAssetList.userBasic(bob.address);
      expect(userBasic.principal).to.be.lessThan(0);

      // Pause borrowers transfer
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseBorrowersTransfer(true);

      await expect(
        cometWithExtendedAssetList
          .connect(alice)
          .transferAssetFrom(
            bob.address,
            alice.address,
            baseToken.address,
            baseTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'BorrowersTransferPaused'
      );
    });

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`transferFrom reverts if collateral asset ${i} transfer is paused`, async () => {
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

        // Pause specific collateral asset transfer at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetTransfer(assetIndex, true);

        await expect(
          cometWithExtendedAssetListMaxAssets
            .connect(bob)
            .transferAssetFrom(
              bob.address,
              alice.address,
              assetToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetListMaxAssets,
          'CollateralAssetTransferPaused'
        );
      });
    }

    for(let i = 1; i <= MAX_ASSETS; i++) {
      it(`allows to transferFrom collateral asset ${i} when asset becomes unpaused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
        const collateralBalanceBob = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const collateralBalanceAlice = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);

        // Unpause specific collateral asset transfer at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetTransfer(assetIndex, false);

        // Transfer the asset
        await cometWithExtendedAssetListMaxAssets.connect(alice).transferAssetFrom(bob.address, alice.address, assetToken.address, collateralTokenSupplyAmount);

        const collateralBalanceBobAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        const collateralBalanceAliceAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);
        expect(collateralBalanceBobAfter).to.be.equal(collateralBalanceBob.sub(collateralTokenSupplyAmount));
        expect(collateralBalanceAliceAfter).to.be.equal(collateralBalanceAlice.add(collateralTokenSupplyAmount));
      });
    }

    describe('deactivated collateral transferFrom flow', function () {
      let deactivateCollateralTx: ContractTransaction;
      let activateCollateralTx: ContractTransaction;

      it('allows pause guardian to deactivate a token', async function () {
        await snapshot.restore();

        deactivateCollateralTx = await cometWithExtendedAssetList
          .connect(pauseGuardian)
          .deactivateCollateral(deactivatedCollateralIndex);
        await expect(deactivateCollateralTx).to.not.be.reverted;
      });

      it('emits CollateralAssetTransferPauseAction event with true argument', async function () {
        expect(deactivateCollateralTx)
          .to.emit(cometWithExtendedAssetList, 'CollateralAssetTransferPauseAction')
          .withArgs(deactivatedCollateralIndex, true);
      });

      it('emits CollateralDeactivated event', async function () {
        expect(deactivateCollateralTx)
          .to.emit(cometWithExtendedAssetList, 'CollateralDeactivated')
          .withArgs(deactivatedCollateralIndex);
      });

      it('sets collateral as deactivated in comet', async function () {
        expect(
          await cometWithExtendedAssetList.isCollateralDeactivated(deactivatedCollateralIndex)
        ).to.be.true;
      });

      it('updates collateral transfer pause flag in comet storage', async function () {
        expect(
          await cometWithExtendedAssetList.isCollateralAssetTransferPaused(
            deactivatedCollateralIndex
          )
        ).to.be.true;
      });

      it('asset transferFrom call reverts', async function () {
        await expect(
          cometWithExtendedAssetList
            .connect(alice)
            .transferAssetFrom(
              dave.address,
              alice.address,
              collateralToken.address,
              collateralTokenSupplyAmount
            )
        )
          .to.be.revertedWithCustomError(
            cometWithExtendedAssetList,
            'CollateralAssetTransferPaused'
          )
          .withArgs(deactivatedCollateralIndex);
      });

      it('base token transferFrom reverts when user has deactivated collateral and borrow position', async function () {
        expect((await cometWithExtendedAssetList.userBasic(dave.address)).principal).to.be.lessThan(
          0
        );

        await expect(
          cometWithExtendedAssetList
            .connect(alice)
            .transferFrom(dave.address, alice.address, baseTokenSupplyAmount)
        )
          .to.be.revertedWithCustomError(cometWithExtendedAssetList, 'TokenIsDeactivated')
          .withArgs(collateralToken.address);
      });

      it('allows governor to activate a token', async function () {
        activateCollateralTx = await cometWithExtendedAssetList
          .connect(governor)
          .activateCollateral(deactivatedCollateralIndex);
        await expect(activateCollateralTx).to.not.be.reverted;
      });

      it('emits CollateralAssetTransferPauseAction event with false argument', async function () {
        expect(activateCollateralTx)
          .to.emit(cometWithExtendedAssetList, 'CollateralAssetTransferPauseAction')
          .withArgs(deactivatedCollateralIndex, false);
      });

      it('emits CollateralActivated event', async function () {
        expect(activateCollateralTx)
          .to.emit(cometWithExtendedAssetList, 'CollateralActivated')
          .withArgs(deactivatedCollateralIndex);
      });

      it('sets collateral as activated in comet', async function () {
        expect(
          await cometWithExtendedAssetList.isCollateralDeactivated(deactivatedCollateralIndex)
        ).to.be.false;
      });

      it('updates collateral transfer pause flag in comet storage', async function () {
        expect(
          await cometWithExtendedAssetList.isCollateralAssetTransferPaused(
            deactivatedCollateralIndex
          )
        ).to.be.false;
      });

      it('allows to transferFrom activated collateral', async function () {
        await cometWithExtendedAssetList
          .connect(alice)
          .transferAssetFrom(
            dave.address,
            alice.address,
            collateralToken.address,
            collateralTokenTransferAmount
          );
      });

      it('updates users collateral balances', async function () {
        const daveCollateralAfter = await cometWithExtendedAssetList.userCollateral(
          dave.address,
          collateralToken.address
        );
        const aliceCollateralAfter = await cometWithExtendedAssetList.userCollateral(
          alice.address,
          collateralToken.address
        );

        expect(daveCollateralBefore.balance.sub(daveCollateralAfter.balance)).to.eq(
          collateralTokenTransferAmount
        );
        expect(aliceCollateralAfter.balance.sub(aliceCollateralBefore.balance)).to.eq(
          collateralTokenTransferAmount
        );
      });

      it('allows to transferFrom base token', async function () {
        await cometWithExtendedAssetList
          .connect(alice)
          .transferFrom(dave.address, alice.address, baseTokenSupplyAmount);
      });

      it('updates users principals', async function () {
        const aliceBasicAfter = await cometWithExtendedAssetList.userBasic(alice.address);
        const daveBasicAfter = await cometWithExtendedAssetList.userBasic(dave.address);

        expect(aliceBasicAfter.principal.sub(aliceBasicBefore.principal)).to.be.closeTo(
          baseTokenSupplyAmount,
          1
        );
        expect(daveBasicAfter.principal.sub(daveBasicBefore.principal)).to.be.closeTo(
          -baseTokenSupplyAmount,
          1
        );
      });

      for (let i = 1; i <= MAX_ASSETS; i++) {
        it(`transferFrom reverts if collateral asset ${i} transfer is paused`, async () => {
          // Get the asset at index i-1
          const assetIndex = i - 1;
          const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
          
          // Supply the asset first
          await assetToken.allocateTo(dave.address, collateralTokenSupplyAmount);
          await assetToken
            .connect(dave)
            .approve(
              cometWithExtendedAssetListMaxAssets.address,
              collateralTokenSupplyAmount
            );

          await cometWithExtendedAssetListMaxAssets
            .connect(dave)
            .supply(assetToken.address, collateralTokenSupplyAmount);

          await cometWithExtendedAssetListMaxAssets.connect(dave).allow(alice.address, true);

          // Pause specific collateral asset transfer at index assetIndex
          await cometWithExtendedAssetListMaxAssets
            .connect(pauseGuardian)
            .pauseCollateralAssetTransfer(assetIndex, true);

          await expect(
            cometWithExtendedAssetListMaxAssets
              .connect(alice)
              .transferAssetFrom(
                dave.address,
                alice.address,
                assetToken.address,
                collateralTokenSupplyAmount
              )
          ).to.be.revertedWithCustomError(
            cometWithExtendedAssetListMaxAssets,
            'CollateralAssetTransferPaused'
          ).withArgs(assetIndex);
        });
      }
    });
  });
});
