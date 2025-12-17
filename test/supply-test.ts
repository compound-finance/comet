import { ethers, event, expect, exp, makeProtocol, portfolio, ReentryAttack, setTotalsBasic, wait, fastForward, defaultAssets,SnapshotRestorer,
  takeSnapshot, MAX_ASSETS, UserCollateral } from './helpers';
import { EvilToken, EvilToken__factory, NonStandardFaucetFeeToken__factory, NonStandardFaucetFeeToken,CometHarnessInterfaceExtendedAssetList,FaucetToken } from '../build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';
import { TotalsCollateralStruct } from 'build/types/CometHarness';

describe('supply functionality', function () {
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

  // Constants
  const baseTokenSupplyAmount = BigInt(100e6);
  const collateralTokenSupplyAmount = BigInt(8e8);

  // Storage
  let deactivatedCollateralIndex: number;
  let totalsCollateralBefore: TotalsCollateralStruct;
  let aliceUserCollateralBefore: UserCollateral;
  let bobUserCollateralBefore: UserCollateral;

  before(async () => {
    const protocol = await makeProtocol({ base: 'USDC' });
    cometWithExtendedAssetList = protocol.cometWithExtendedAssetList;
    baseToken = protocol.tokens.USDC;
    collateralToken = protocol.tokens.COMP;
    pauseGuardian = protocol.pauseGuardian;
    governor = protocol.governor;
    alice = protocol.users[0];
    bob = protocol.users[1];

    const collateralAssetInfo = await cometWithExtendedAssetList.getAssetInfoByAddress(collateralToken.address);
    deactivatedCollateralIndex = collateralAssetInfo.offset;

    await baseToken.allocateTo(bob.address, baseTokenSupplyAmount);
    await collateralToken.allocateTo(bob.address, collateralTokenSupplyAmount);

    const collaterals = Object.fromEntries(
      Array.from({ length: MAX_ASSETS }, (_, j) => [`ASSET${j}`, {}])
    );
    const protocolWithMaxAssets = await makeProtocol({
      assets: { USDC: {}, ...collaterals },
    });
    cometWithExtendedAssetListMaxAssets =
      protocolWithMaxAssets.cometWithExtendedAssetList;
    tokensWithMaxAssets = protocolWithMaxAssets.tokens;

    totalsCollateralBefore = await cometWithExtendedAssetList.totalsCollateral(collateralToken.address);
    aliceUserCollateralBefore = await cometWithExtendedAssetList.userCollateral(alice.address, collateralToken.address);
    bobUserCollateralBefore = await cometWithExtendedAssetList.userCollateral(bob.address, collateralToken.address);

    await cometWithExtendedAssetList.connect(bob).allow(alice.address, true);

    await collateralToken
      .connect(bob)
      .approve(
        cometWithExtendedAssetList.address,
        collateralTokenSupplyAmount
      );
    await cometWithExtendedAssetListMaxAssets.connect(bob).allow(alice.address, true);

    snapshot = await takeSnapshot();
  });

  describe('supplyTo', function () {
    this.afterAll(async () => await snapshot.restore());

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
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(124000);
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
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(124000);
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
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(153000);
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

    it('reverts if collateral supply is paused', async () => {
      // Pause collateral supply
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseCollateralSupply(true);

      await collateralToken
        .connect(bob)
        .approve(
          cometWithExtendedAssetList.address,
          collateralTokenSupplyAmount
        );
      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .supplyTo(
            alice.address,
            collateralToken.address,
            collateralTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'CollateralSupplyPaused'
      );
    });

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`supplyTo reverts if collateral asset ${i} supply is paused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];

        // Allocate tokens to bob
        await assetToken.allocateTo(bob.address, collateralTokenSupplyAmount);

        // Pause specific collateral asset supply at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetSupply(assetIndex, true);

        await assetToken
          .connect(bob)
          .approve(
            cometWithExtendedAssetListMaxAssets.address,
            collateralTokenSupplyAmount
          );
        await expect(
          cometWithExtendedAssetListMaxAssets
            .connect(bob)
            .supplyTo(
              alice.address,
              assetToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetListMaxAssets,
          'CollateralAssetSupplyPaused'
        );
      });
    }

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`allows to supplyTo collateral asset ${i} when asset becomes unpaused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
        const collateralBalance = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);

        // Unpause specific collateral asset supply at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetSupply(assetIndex, false);

        await cometWithExtendedAssetListMaxAssets.connect(bob).supplyTo(alice.address, assetToken.address, collateralTokenSupplyAmount);

        const collateralBalanceAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);
        expect(collateralBalanceAfter).to.be.equal(collateralBalance.add(collateralTokenSupplyAmount));
      });
    }

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
  
    it('supplies base the correct amount in a fee-like situation', async () => {
      const assets = defaultAssets();
      // Add USDT to assets on top of default assets
      assets['USDT'] = {
        initial: 1e6,
        decimals: 6,
        factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
      };
      const protocol = await makeProtocol({ base: 'USDT', assets: assets });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { USDT } = tokens;
  
      // Set fee to 0.1%
      await (USDT as NonStandardFaucetFeeToken).setParams(10, 10);
  
      const _i0 = await USDT.allocateTo(bob.address, 1000e6);
      const baseAsB = USDT.connect(bob);
      const cometAsB = comet.connect(bob);
  
      const t0 = await comet.totalsBasic();
      const p0 = await portfolio(protocol, alice.address);
      const q0 = await portfolio(protocol, bob.address);
      const _a0 = await wait(baseAsB.approve(comet.address, 1000e6));
      const s0 = await wait(cometAsB.supplyTo(alice.address, USDT.address, 1000e6));
      const t1 = await comet.totalsBasic();
      const p1 = await portfolio(protocol, alice.address);
      const q1 = await portfolio(protocol, bob.address);
  
      expect(event(s0, 0)).to.be.deep.equal({
        Transfer: {
          from: bob.address,
          to: comet.address,
          amount: BigInt(999e6),
        }
      });
      expect(event(s0, 1)).to.be.deep.equal({
        Supply: {
          from: bob.address,
          dst: alice.address,
          amount: BigInt(999e6),
        }
      });
      expect(event(s0, 2)).to.be.deep.equal({
        Transfer: {
          from: ethers.constants.AddressZero,
          to: alice.address,
          amount: BigInt(999e6),
        }
      });
  
      expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, USDT: 0n });
      expect(p0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, USDT: 0n });
      expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, USDT: 0n });
      expect(q0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, USDT: exp(1000, 6) });
      expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, USDT: exp(999, 6) });
      expect(p1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, USDT: 0n });
      expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, USDT: 0n });
      expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, USDT: 0n });
      expect(t1.totalSupplyBase).to.be.equal(t0.totalSupplyBase.add(999e6));
      expect(t1.totalBorrowBase).to.be.equal(t0.totalBorrowBase);
      // Fee Token logics will cost a bit more gas than standard ERC20 token with no fee calculation
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(151000);
    });
  
    it('supplies collateral the correct amount in a fee-like situation', async () => {
      const assets = defaultAssets();
      // Add FeeToken Collateral to assets on top of default assets
      assets['FeeToken'] = {
        initial: 1e8,
        decimals: 18,
        factory: (await ethers.getContractFactory('NonStandardFaucetFeeToken')) as NonStandardFaucetFeeToken__factory,
      };
  
      const protocol = await makeProtocol({ base: 'USDC', assets: assets });
      const { comet, tokens, users: [alice, bob] } = protocol;
      const { FeeToken } = tokens;
  
      // Set fee to 0.1%
      await (FeeToken as NonStandardFaucetFeeToken).setParams(10, 10);
  
      const _i0 = await FeeToken.allocateTo(bob.address, 2000e8);
      const baseAsB = FeeToken.connect(bob);
      const cometAsB = comet.connect(bob);
  
      const t0 = await comet.totalsCollateral(FeeToken.address);
      const p0 = await portfolio(protocol, alice.address);
      const q0 = await portfolio(protocol, bob.address);
      const _a0 = await wait(baseAsB.approve(comet.address, 2000e8));
      const s0 = await wait(cometAsB.supplyTo(alice.address, FeeToken.address, 2000e8));
      const t1 = await comet.totalsCollateral(FeeToken.address);
      const p1 = await portfolio(protocol, alice.address);
      const q1 = await portfolio(protocol, bob.address);
  
      expect(event(s0, 0)).to.be.deep.equal({
        Transfer: {
          from: bob.address,
          to: comet.address,
          amount: BigInt(1998e8),
        }
      });
      expect(event(s0, 1)).to.be.deep.equal({
        SupplyCollateral: {
          from: bob.address,
          dst: alice.address,
          asset: FeeToken.address,
          amount: BigInt(1998e8),
        }
      });
  
      expect(p0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, FeeToken: 0n });
      expect(p0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, FeeToken: 0n });
      expect(q0.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, FeeToken: 0n });
      expect(q0.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, FeeToken: exp(2000, 8) });
      expect(p1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, FeeToken: exp(1998, 8) });
      expect(p1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, FeeToken: 0n });
      expect(q1.internal).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, FeeToken: 0n });
      expect(q1.external).to.be.deep.equal({ USDC: 0n, COMP: 0n, WETH: 0n, WBTC: 0n, FeeToken: 0n });
      expect(t1.totalSupplyAsset).to.be.equal(t0.totalSupplyAsset.add(1998e8));
      // Fee Token logics will cost a bit more gas than standard ERC20 token with no fee calculation
      expect(Number(s0.receipt.gasUsed)).to.be.lessThan(186000);
    });
  
    it('blocks reentrancy from exceeding the supply cap', async () => {
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
      await wait(EVIL.connect(alice).approve(comet.address, 75e6));
      await EVIL.allocateTo(alice.address, 75e6);
      await expect(
        comet.connect(alice).supplyTo(bob.address, EVIL.address, 75e6)
      ).to.be.revertedWithCustomError(comet, 'ReentrantCallBlocked');
    });

    /**
     * @notice End-to-end supply behavior when collateral is deactivated and reactivated
     * @dev
     *  This block focuses specifically on how the **supply path** behaves when a collateral
     *  asset is deactivated by the `pauseGuardian` and later reactivated by the `governor`.
     *  It complements the dedicated collateral-deactivation tests by exercising the
     *  user-facing `supplyTo` flow against deactivated collateral.
     *
     *  High-level flow:
     *  - Start from a snapshot where a particular collateral (`deactivatedCollateralIndex`)
     *    and users (`alice`, `bob`) are set up with balances and approvals.
     *  - The `pauseGuardian` calls `deactivateCollateral(deactivatedCollateralIndex)` on
     *    `CometWithExtendedAssetList`:
     *      - We assert that the transaction succeeds and emits:
     *          - `CollateralAssetSupplyPauseAction(deactivatedCollateralIndex, true)`
     *          - `CollateralDeactivated(deactivatedCollateralIndex)`
     *      - We confirm that core state is updated:
     *          - `isCollateralDeactivated(deactivatedCollateralIndex)` is `true`.
     *          - `isCollateralAssetSupplyPaused(deactivatedCollateralIndex)` is `true`.
     *      - We then try to `supplyTo` that collateral and expect it to revert with the
     *        `CollateralAssetSupplyPaused(deactivatedCollateralIndex)` custom error,
     *        proving that the pause flag is enforced on the supply entry point.
     *
     *  - Next, the `governor` calls `activateCollateral(deactivatedCollateralIndex)`:
     *      - We assert that the transaction succeeds and emits:
     *          - `CollateralAssetSupplyPauseAction(deactivatedCollateralIndex, false)`
     *          - `CollateralActivated(deactivatedCollateralIndex)`
     *      - We confirm that core state is updated:
     *          - `isCollateralDeactivated(deactivatedCollateralIndex)` is `false`.
     *          - `isCollateralAssetSupplyPaused(deactivatedCollateralIndex)` is `false`.
     *      - We perform a `supplyTo` call with the same collateral and assert that:
     *          - The transaction does not revert.
     *          - `totalsCollateral(collateralToken).totalSupplyAsset` increases by the
     *            supplied amount.
     *          - `alice`’s `userCollateral` balance for that token increases, while `bob`’s
     *            balance remains unchanged (since Bob is just the source).
     *
     *  - Finally, to validate **MAX_ASSETS** coverage on the supply path:
     *      - A separate `CometWithExtendedAssetListMaxAssets` instance is used with a full
     *        `MAX_ASSETS` collateral configuration.
     *      - For each `assetIndex` in `[0, MAX_ASSETS - 1]`:
     *          - The `pauseGuardian` deactivates that asset via `deactivateCollateral(assetIndex)`.
     *          - A corresponding token `ASSET{assetIndex}` is allocated and approved for
     *            `bob`.
     *          - A `supplyTo` call into that asset is expected to revert with
     *            `CollateralAssetSupplyPaused(assetIndex)`.
     *      - This demonstrates that the per-asset supply pause behavior:
     *          - Scales across the entire configured collateral set, and
     *          - Correctly aligns the asset index used in deactivation with the index
     *            checked in the `CollateralAssetSupplyPaused` error.
     *
     *  In the broader context of the wUSDM / deUSD incident, these tests show that once
     *  a collateral is deactivated for safety reasons, **no new supply** of that collateral
     *  can enter the system until governance explicitly reactivates it, and that this holds
     *  consistently for all supported collateral indices.
     */
    describe('deactivated token supply flow', function () {
      let deactivateCollateralTx: ContractTransaction;
      let activateCollateralTx: ContractTransaction;
      
      it('allows pause guardian to deactivate a token', async function () {
        await snapshot.restore();

        deactivateCollateralTx = await cometWithExtendedAssetList.connect(pauseGuardian).deactivateCollateral(deactivatedCollateralIndex);
        await expect(deactivateCollateralTx).to.not.be.reverted;
      });

      it('emits CollateralAssetSupplyPauseAction event with true argument', async function () {
        expect(deactivateCollateralTx).to.emit(cometWithExtendedAssetList, 'CollateralAssetSupplyPauseAction').withArgs(deactivatedCollateralIndex, true);
      });

      it('emits CollateralDeactivated event', async function () {
        expect(deactivateCollateralTx).to.emit(cometWithExtendedAssetList, 'CollateralDeactivated').withArgs(deactivatedCollateralIndex);
      });

      it('sets collateral as deactivated in comet', async function () {
        expect(await cometWithExtendedAssetList.isCollateralDeactivated(deactivatedCollateralIndex)).to.be.true;
      });
      
      it('updates collateral supply pause flag in comet storage', async function () {
        expect(await cometWithExtendedAssetList.isCollateralAssetSupplyPaused(deactivatedCollateralIndex)).to.be.true;
      });

      it('supplyTo call reverts', async function () {
        await expect(
          cometWithExtendedAssetList
            .connect(bob)
            .supplyTo(
              alice.address,
              collateralToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetList,
          'CollateralAssetSupplyPaused'
        ).withArgs(deactivatedCollateralIndex);
      });

      it('allows governor to activate a token', async function () {
        activateCollateralTx = await cometWithExtendedAssetList.connect(governor).activateCollateral(deactivatedCollateralIndex);
        await expect(activateCollateralTx).to.not.be.reverted;
      });

      it('emits CollateralAssetSupplyPauseAction event with false argument', async function () {
        expect(activateCollateralTx).to.emit(cometWithExtendedAssetList, 'CollateralAssetSupplyPauseAction').withArgs(deactivatedCollateralIndex, false);
      });

      it('emits CollateralActivated event', async function () {
        expect(activateCollateralTx).to.emit(cometWithExtendedAssetList, 'CollateralActivated').withArgs(deactivatedCollateralIndex);
      });

      it('sets collateral as activated in comet', async function () {
        expect(await cometWithExtendedAssetList.isCollateralDeactivated(deactivatedCollateralIndex)).to.be.false;
      });

      it('updates collateral supply pause flag in comet storage', async function () {
        expect(await cometWithExtendedAssetList.isCollateralAssetSupplyPaused(deactivatedCollateralIndex)).to.be.false;
      });

      it('allows to supplyTo activated collateral', async function () {
        await expect(
          cometWithExtendedAssetList
            .connect(bob)
            .supplyTo(
              alice.address,
              collateralToken.address,
              collateralTokenSupplyAmount
            )
        ).to.not.be.reverted;
      });

      it('updates total supply asset amount in comet', async function () {
        const expectedTotalSupplyAsset = ethers.BigNumber.from(totalsCollateralBefore.totalSupplyAsset).add(collateralTokenSupplyAmount);
        expect((await cometWithExtendedAssetList.totalsCollateral(collateralToken.address)).totalSupplyAsset).to.be.equal(expectedTotalSupplyAsset);
      });

      it('updates user collateral in comet', async function () {
        const expectedAliceUserCollateral = ethers.BigNumber.from(aliceUserCollateralBefore.balance).add(collateralTokenSupplyAmount);
        expect((await cometWithExtendedAssetList.userCollateral(alice.address, collateralToken.address)).balance).to.be.equal(expectedAliceUserCollateral);
      });

      it('updates user collateral in comet', async function () {
        expect((await cometWithExtendedAssetList.userCollateral(bob.address, collateralToken.address)).balance).to.be.equal(bobUserCollateralBefore.balance);
      });

      for(let i = 1; i <= MAX_ASSETS; i++) {
        const assetIndex = i - 1;
        
        it(`reverts on deactivated collateral supplyTo with index ${i}`, async function () {
          await cometWithExtendedAssetListMaxAssets.connect(pauseGuardian).deactivateCollateral(assetIndex);

          const supplyToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
          await supplyToken.allocateTo(bob.address, collateralTokenSupplyAmount);
          await supplyToken.connect(bob).approve(cometWithExtendedAssetListMaxAssets.address, collateralTokenSupplyAmount);

          await expect(
            cometWithExtendedAssetListMaxAssets
              .connect(bob)
              .supplyTo(
                alice.address,
                supplyToken.address,
                collateralTokenSupplyAmount
              )
          ).to.be.revertedWithCustomError(
            cometWithExtendedAssetListMaxAssets,
            'CollateralAssetSupplyPaused'
          ).withArgs(assetIndex);
        });

        it(`allows to supplyTo re-activated collateral with index ${i}`, async function () {
          await cometWithExtendedAssetListMaxAssets.connect(governor).activateCollateral(assetIndex);

          const supplyToken = tokensWithMaxAssets[`ASSET${assetIndex}`];

          await expect(
            cometWithExtendedAssetListMaxAssets
              .connect(bob)
              .supplyTo(
                alice.address,
                supplyToken.address,
                collateralTokenSupplyAmount
              )
          ).to.not.be.reverted;

          expect((await cometWithExtendedAssetListMaxAssets.userCollateral(bob.address, supplyToken.address)).balance)
            .to.be.equal(bobUserCollateralBefore.balance);
        });
      }
    });
  });

  describe('supply', function () {
    this.afterAll(async () => await snapshot.restore());

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

    it('reverts if base supply is paused', async () => {
      // Pause base supply
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseBaseSupply(true);

      await baseToken
        .connect(bob)
        .approve(cometWithExtendedAssetList.address, baseTokenSupplyAmount);
      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .supply(baseToken.address, baseTokenSupplyAmount)
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'BaseSupplyPaused'
      );
    });

    it('reverts if collateral supply is paused', async () => {
      // Pause collateral supply
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseCollateralSupply(true);

      await collateralToken
        .connect(bob)
        .approve(
          cometWithExtendedAssetList.address,
          collateralTokenSupplyAmount
        );
      await expect(
        cometWithExtendedAssetList
          .connect(bob)
          .supply(collateralToken.address, collateralTokenSupplyAmount)
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'CollateralSupplyPaused'
      );
    });

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`supply reverts if collateral asset ${i} supply is paused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];

        // Allocate tokens to bob
        await assetToken.allocateTo(bob.address, collateralTokenSupplyAmount);

        // Pause specific collateral asset supply at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetSupply(assetIndex, true);

        await assetToken
          .connect(bob)
          .approve(
            cometWithExtendedAssetListMaxAssets.address,
            collateralTokenSupplyAmount
          );
        await expect(
          cometWithExtendedAssetListMaxAssets
            .connect(bob)
            .supply(assetToken.address, collateralTokenSupplyAmount)
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetListMaxAssets,
          'CollateralAssetSupplyPaused'
        );
      });
    }

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`allows to supply collateral asset ${i} when asset becomes unpaused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
        const collateralBalance = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);

        // Unpause specific collateral asset supply at index assetIndex
        await cometWithExtendedAssetListMaxAssets.connect(pauseGuardian).pauseCollateralAssetSupply(assetIndex, false);

        // Supply the asset
        await cometWithExtendedAssetListMaxAssets.connect(bob).supply(assetToken.address, collateralTokenSupplyAmount);

        const collateralBalanceAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(bob.address, assetToken.address);
        expect(collateralBalanceAfter).to.be.equal(collateralBalance.add(collateralTokenSupplyAmount));
      });
    }

    describe('deactivated token supply flow', function () {
      it('allows pause guardian to deactivate a token', async function () {
        await snapshot.restore();

        await expect(cometWithExtendedAssetList.connect(pauseGuardian).deactivateCollateral(deactivatedCollateralIndex)).to.not.be.reverted;
      });

      it('supply call reverts', async function () {
        await expect(
          cometWithExtendedAssetList
            .connect(bob)
            .supply(
              collateralToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetList,
          'CollateralAssetSupplyPaused'
        ).withArgs(deactivatedCollateralIndex);
      });

      it('allows governor to activate a token', async function () {
        await expect(cometWithExtendedAssetList.connect(governor).activateCollateral(deactivatedCollateralIndex)).to.not.be.reverted;
      });

      it('allows to supply activated collateral', async function () {
        await expect(
          cometWithExtendedAssetList
            .connect(bob)
            .supply(
              collateralToken.address,
              collateralTokenSupplyAmount
            )
        ).to.not.be.reverted;
      });

      it('updates total supply asset amount in comet', async function () {
        const expectedTotalSupplyAsset = ethers.BigNumber.from(totalsCollateralBefore.totalSupplyAsset).add(collateralTokenSupplyAmount);
        expect((await cometWithExtendedAssetList.totalsCollateral(collateralToken.address)).totalSupplyAsset).to.be.equal(expectedTotalSupplyAsset);
      });

      it('updates user collateral in comet', async function () {
        const expectedBobUserCollateral = ethers.BigNumber.from(bobUserCollateralBefore.balance).add(collateralTokenSupplyAmount);
        expect((await cometWithExtendedAssetList.userCollateral(bob.address, collateralToken.address)).balance).to.be.equal(expectedBobUserCollateral);
      });

      for(let i = 1; i <= MAX_ASSETS; i++) {
        const assetIndex = i - 1;

        it(`reverts on deactivated collateral supply with index ${i}`, async function () {
          await cometWithExtendedAssetListMaxAssets.connect(pauseGuardian).deactivateCollateral(assetIndex);

          const supplyToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
          await supplyToken.allocateTo(bob.address, collateralTokenSupplyAmount);
          await supplyToken.connect(bob).approve(cometWithExtendedAssetListMaxAssets.address, collateralTokenSupplyAmount);

          await expect(
            cometWithExtendedAssetListMaxAssets
              .connect(bob)
              .supply(
                supplyToken.address,
                collateralTokenSupplyAmount
              )
          ).to.be.revertedWithCustomError(
            cometWithExtendedAssetListMaxAssets,
            'CollateralAssetSupplyPaused'
          ).withArgs(assetIndex);
        });

        it(`allows to supplyTo re-activated collateral with index ${i}`, async function () {
          await cometWithExtendedAssetListMaxAssets.connect(governor).activateCollateral(assetIndex);

          const supplyToken = tokensWithMaxAssets[`ASSET${assetIndex}`];

          await expect(
            cometWithExtendedAssetListMaxAssets
              .connect(bob)
              .supply(supplyToken.address, collateralTokenSupplyAmount)
          ).to.not.be.reverted;

          expect((await cometWithExtendedAssetListMaxAssets.userCollateral(bob.address, supplyToken.address)).balance)
            .to.be.equal(collateralTokenSupplyAmount);
        });
      }
    });
  });

  describe('supplyFrom', function () {
    this.afterAll(async () => await snapshot.restore());
    
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

    it('reverts if base supply is paused', async () => {
      // Pause base supply
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseBaseSupply(true);

      await baseToken
        .connect(bob)
        .approve(cometWithExtendedAssetList.address, baseTokenSupplyAmount);
      await cometWithExtendedAssetList.connect(bob).allow(alice.address, true);
      await expect(
        cometWithExtendedAssetList
          .connect(alice)
          .supplyFrom(
            bob.address,
            alice.address,
            baseToken.address,
            baseTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'BaseSupplyPaused'
      );
    });

    it('reverts if collateral supply is paused', async () => {
      // Pause collateral supply
      await cometWithExtendedAssetList
        .connect(pauseGuardian)
        .pauseCollateralSupply(true);

      await collateralToken
        .connect(bob)
        .approve(
          cometWithExtendedAssetList.address,
          collateralTokenSupplyAmount
        );
      await cometWithExtendedAssetList.connect(bob).allow(alice.address, true);
      await expect(
        cometWithExtendedAssetList
          .connect(alice)
          .supplyFrom(
            bob.address,
            alice.address,
            collateralToken.address,
            collateralTokenSupplyAmount
          )
      ).to.be.revertedWithCustomError(
        cometWithExtendedAssetList,
        'CollateralSupplyPaused'
      );
    });

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`supplyFrom reverts if collateral asset ${i} supply is paused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];

        // Allocate tokens to bob
        await assetToken.allocateTo(bob.address, collateralTokenSupplyAmount);

        // Pause specific collateral asset supply at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetSupply(assetIndex, true);

        await assetToken
          .connect(bob)
          .approve(
            cometWithExtendedAssetListMaxAssets.address,
            collateralTokenSupplyAmount
          );
        
        await expect(
          cometWithExtendedAssetListMaxAssets
            .connect(alice)
            .supplyFrom(
              bob.address,
              alice.address,
              assetToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetListMaxAssets,
          'CollateralAssetSupplyPaused'
        );
      });
    }

    for (let i = 1; i <= MAX_ASSETS; i++) {
      it(`allows to supplyFrom collateral asset ${i} when asset becomes unpaused`, async () => {
        // Get the asset at index i-1
        const assetIndex = i - 1;
        const assetToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
        const collateralBalance = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);

        // Unpause specific collateral asset supply at index assetIndex
        await cometWithExtendedAssetListMaxAssets
          .connect(pauseGuardian)
          .pauseCollateralAssetSupply(assetIndex, false);

        // Supply the asset
        await cometWithExtendedAssetListMaxAssets.connect(alice).supplyFrom(bob.address, alice.address, assetToken.address, collateralTokenSupplyAmount);

        const collateralBalanceAfter = await cometWithExtendedAssetListMaxAssets.collateralBalanceOf(alice.address, assetToken.address);
        expect(collateralBalanceAfter).to.be.equal(collateralBalance.add(collateralTokenSupplyAmount));
      });
    }

    describe('deactivated token supply flow', function () { 
      it('allows pause guardian to deactivate a token', async function () {
        await snapshot.restore();

        await expect(cometWithExtendedAssetList.connect(pauseGuardian).deactivateCollateral(deactivatedCollateralIndex)).to.not.be.reverted;
      });

      it('supplyFrom call reverts', async function () {
        await expect(
          cometWithExtendedAssetList
            .connect(alice)
            .supplyFrom(
              bob.address,
              alice.address,
              collateralToken.address,
              collateralTokenSupplyAmount
            )
        ).to.be.revertedWithCustomError(
          cometWithExtendedAssetList,
          'CollateralAssetSupplyPaused'
        ).withArgs(deactivatedCollateralIndex);
      });

      it('allows governor to activate a token', async function () {
        await expect(cometWithExtendedAssetList.connect(governor).activateCollateral(deactivatedCollateralIndex)).to.not.be.reverted;
      });

      it('allows to supplyFrom activated collateral', async function () {
        await expect(
          cometWithExtendedAssetList
            .connect(alice)
            .supplyFrom(
              bob.address,
              alice.address,
              collateralToken.address,
              collateralTokenSupplyAmount
            )
        ).to.not.be.reverted;
      });

      it('updates total supply asset amount in comet', async function () {
        const expectedTotalSupplyAsset = ethers.BigNumber.from(totalsCollateralBefore.totalSupplyAsset).add(collateralTokenSupplyAmount);
        expect((await cometWithExtendedAssetList.totalsCollateral(collateralToken.address)).totalSupplyAsset).to.be.equal(expectedTotalSupplyAsset);
      });

      it('updates user collateral in comet', async function () {
        const expectedAliceUserCollateral = ethers.BigNumber.from(aliceUserCollateralBefore.balance).add(collateralTokenSupplyAmount);
        expect((await cometWithExtendedAssetList.userCollateral(alice.address, collateralToken.address)).balance).to.be.equal(expectedAliceUserCollateral);
      });

      it('updates user collateral in comet', async function () {
        expect((await cometWithExtendedAssetList.userCollateral(bob.address, collateralToken.address)).balance).to.be.equal(bobUserCollateralBefore.balance);
      });

      for(let i = 1; i <= MAX_ASSETS; i++) {
        const assetIndex = i - 1;

        it(`reverts on deactivated collateral supplyFrom with index ${i}`, async function () {
          await cometWithExtendedAssetListMaxAssets.connect(pauseGuardian).deactivateCollateral(assetIndex);

          const supplyToken = tokensWithMaxAssets[`ASSET${assetIndex}`];
          await supplyToken.allocateTo(bob.address, collateralTokenSupplyAmount);
          await supplyToken.connect(bob).approve(cometWithExtendedAssetListMaxAssets.address, collateralTokenSupplyAmount);
          await cometWithExtendedAssetListMaxAssets.connect(bob).allow(alice.address, true);

          await expect(
            cometWithExtendedAssetListMaxAssets
              .connect(alice)
              .supplyFrom(
                bob.address,
                alice.address,
                supplyToken.address,
                collateralTokenSupplyAmount
              )
          ).to.be.revertedWithCustomError(
            cometWithExtendedAssetListMaxAssets,
            'CollateralAssetSupplyPaused'
          ).withArgs(assetIndex);
        });

        it(`allows to supplyFrom re-activated collateral with index ${i}`, async function () {
          await cometWithExtendedAssetListMaxAssets.connect(governor).activateCollateral(assetIndex);

          const supplyToken = tokensWithMaxAssets[`ASSET${assetIndex}`];

          await expect(
            cometWithExtendedAssetListMaxAssets
              .connect(alice)
              .supplyFrom(bob.address, alice.address, supplyToken.address, collateralTokenSupplyAmount)
          ).to.not.be.reverted;

          expect((await cometWithExtendedAssetListMaxAssets.userCollateral(alice.address, supplyToken.address)).balance)
            .to.be.equal(collateralTokenSupplyAmount);
        });
      }
    });
  });
});
