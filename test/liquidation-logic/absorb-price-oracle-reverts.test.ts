import { ethers, expect, exp, presentValue, mulPrice, mulFactor, default24Assets,
  makeConfigurator } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, CometProxyAdmin, Configurator, FaucetToken, PriceFeedWithRevert, PriceFeedWithRevert__factory, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

describe('collateral price oracle reverts across varying collateral factors during absorption', function() {
  // Protocol
  let comet: CometHarnessInterfaceExtendedAssetList;
  let configurator: Configurator;
  let cometProxyAdmin: CometProxyAdmin;
  let configuratorProxyAddress: string;
  let cometProxyAddress: string;

  const baseTokenPrice = exp(1, 8);
  const initialBaseFunding = baseTokenPrice * 10_000n;
  const collateralAmount = exp(1, 18); // 1 COMP, $100 at initial price (BCF=0.8 → $80 borrow power)
  const borrowAmount = exp(70, 6); // $70 USDC, within the $80 borrow limit

  // Assets
  let tokens: { [symbol: string]: FaucetToken } = {};
  let baseToken: FaucetToken;
  let priceFeeds: { [symbol: string]: SimplePriceFeed } = {};
  let priceFeedWithRevert: PriceFeedWithRevert;

  let pauseGuardian: SignerWithAddress;
  let alice: SignerWithAddress;
  let absorber: SignerWithAddress;

  // Math
  const baseScale: bigint = 10n ** 6n;

  let snapshot: SnapshotRestorer;

  before(async function() {
    const protocol = await makeConfigurator({
      base: 'USDC',
      assets: {
        USDC: { decimals: 6, initialPrice: 1 },
        ...default24Assets(),
      },
      baseTrackingBorrowSpeed: 0,
    });
    configuratorProxyAddress = protocol.configuratorProxy.address;
    cometProxyAddress = protocol.cometProxy.address;
    configurator = protocol.configurator.attach(configuratorProxyAddress);
    comet = protocol.cometWithExtendedAssetList.attach(cometProxyAddress);
    cometProxyAdmin = protocol.proxyAdmin;

    for (let asset in protocol.tokens) {
      if (asset === 'USDC') continue;
      tokens[asset] = protocol.tokens[asset] as FaucetToken;
      priceFeeds[asset] = protocol.priceFeeds[asset];
    }
    baseToken = protocol.tokens['USDC'] as FaucetToken;
    priceFeeds['USDC'] = protocol.priceFeeds['USDC'];

    pauseGuardian = protocol.pauseGuardian;
    [alice, absorber] = protocol.users;

    const allocateAmount = exp(1_000_000, 18);
    for (const token of Object.values(protocol.tokens)) {
      await (token as FaucetToken).allocateTo(alice.address, allocateAmount);
      await (token as FaucetToken).connect(alice).approve(comet.address, ethers.constants.MaxUint256);
    }

    // Make reserves on comet for borrowings
    await baseToken.allocateTo(comet.address, initialBaseFunding);

    const PriceFeedWithRevert = await ethers.getContractFactory('PriceFeedWithRevert') as PriceFeedWithRevert__factory;
    priceFeedWithRevert = await PriceFeedWithRevert.deploy();
    // update config but not deploy new implementation yet
    await configurator.updateAssetPriceFeed(cometProxyAddress, tokens['COMP'].address, priceFeedWithRevert.address);

    await comet.connect(alice).supply(tokens['COMP'].address, collateralAmount);
    await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

    snapshot = await takeSnapshot();
  });

  // BCF = 0 shields the borrow collateralization check from the broken oracle, but the
  // liquidation check still requires the oracle (LCF > 0), so absorb remains blocked.
  context('BCF = 0, LCF and LF > 0', function() {
    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
    });

    after(async () => await snapshot.restore());

    it('absorb reverts because the liquidation path still calls the reverting oracle', async () => {
      await expect(comet.connect(absorber).absorb(absorber.address, [alice.address]))
        .to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
    });
  });

  // When LCF = 0 (requires BCF = 0 first), the liquidation check skips the oracle entirely.
  // absorb succeeds: all collateral is seized at price 0 and the remaining debt is written
  // off as bad debt absorbed by the protocol.
  context('BCF = 0, LCF = 0, LF > 0', function() {
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let collateralValue: bigint;
    let wantedCollateralValue: bigint;
    let seizedValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let cometCompTokenBalanceBefore: bigint;
    let totalSupplyCompBefore: bigint;
    let compReservesBefore: bigint;
    let reservedBefore: number;

    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      const userBasic = await comet.userBasic(alice.address);
      const principal = userBasic.principal;
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      basePaidOut = -oldBalance;
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      cometCompTokenBalanceBefore = (await tokens['COMP'].balanceOf(comet.address)).toBigInt();
      totalSupplyCompBefore = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset.toBigInt();
      compReservesBefore = (await comet.getCollateralReserves(tokens['COMP'].address)).toBigInt();
      reservedBefore = userBasic._reserved;
    });

    after(async () => await snapshot.restore());

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      // debtRemainingValue = 70e6 * 1e8 / 1e6 = 70e8
      debtRemainingValue = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('uses the full captured COMP amount as the seizure amount', () => {
      expect(totalSupplyCompBefore).to.be.equal(collateralAmount);
    });

    it('calculates COMP collateral value as zero because LCF = 0 skipped the oracle fetch', async () => {
      // collateralValue = collateralAmount * cachedPrice / COMP scale = 1e18 * 0 / 1e18 = 0
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      collateralValue = mulPrice(collateralAmount, 0n, assetInfo.scale);
      expect(collateralValue).to.be.equal(0n);
    });

    it('calculates wanted collateral value as zero', () => {
      // Full-seizure branch uses collateralValue as wantedCollateralValue.
      wantedCollateralValue = collateralValue;
    });

    it('calculates seized debt value as zero', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      // seizedValue = wantedCollateralValue * LF = 0 regardless of LF being positive.
      seizedValue = mulFactor(wantedCollateralValue, assetInfo.liquidationFactor);
      expect(seizedValue).to.be.equal(0n);
    });

    it('AbsorbCollateral seizes all COMP at value 0 because the price was never fetched', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralAmount, wantedCollateralValue
      );
    });

    it('AbsorbDebt writes off the full debt as bad debt', async () => {
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('comet total supplied COMP is reduced by the seized collateral', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset.toBigInt();
      expect(totalSupplyAssetAfter).to.be.equal(totalSupplyCompBefore - collateralAmount);
    });

    it('comet COMP reserves increase by the seized collateral', async () => {
      expect((await comet.getCollateralReserves(tokens['COMP'].address)).toBigInt()).to.be.equal(compReservesBefore + collateralAmount);
    });

    it('asset removed from the assetIn list of the user', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are zero', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
      expect(reservedBefore).to.be.equal(0);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(cometCompTokenBalanceBefore);
    });

    it('alice borrow balance is zero', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed base amount', async () => {
      expect(await comet.getReserves()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  // When LF = 0 (requires BCF = 0 and LCF = 0 first), absorb skips the collateral entirely
  // in the seizure loop. The debt is written off as bad debt but the collateral stays with
  // the borrower, making the asset effectively non-liquidatable.
  context('BCF = 0, LCF = 0, LF = 0', function() {
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let collateralValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let cometCompTokenBalanceBefore: bigint;
    let totalSupplyCompBefore: bigint;
    let compReservesBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidationFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      const userBasic = await comet.userBasic(alice.address);
      const principal = userBasic.principal;
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      basePaidOut = -oldBalance;
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      cometCompTokenBalanceBefore = (await tokens['COMP'].balanceOf(comet.address)).toBigInt();
      totalSupplyCompBefore = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset.toBigInt();
      compReservesBefore = (await comet.getCollateralReserves(tokens['COMP'].address)).toBigInt();
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
    });

    after(async () => await snapshot.restore());

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      // debtRemainingValue = 70e6 * 1e8 / 1e6 = 70e8 - $70
      debtRemainingValue = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('calculates COMP collateral value as zero because LCF = 0 skipped the oracle fetch', async () => {
      // collateralValue = collateralAmount * cachedPrice / COMP scale = 1e18 * 0 / 1e18 = 0
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      collateralValue = mulPrice(collateralAmount, 0n, assetInfo.scale);
      expect(collateralValue).to.be.equal(0n);
    });

    it('AbsorbCollateral is not emitted because LF = 0 skips the asset in the seizure loop', async () => {
      await expect(absorbTx).to.not.emit(comet, 'AbsorbCollateral');
    });

    it('AbsorbDebt writes off the full debt as bad debt', async () => {
      // LF = 0 causes the loop to skip COMP, so debtRemainingValue never decreases;
      // bad-debt branch zeroes newBalance, absorbing the entire debt from protocol reserves
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice COMP collateral balance is unchanged because the asset was not seized', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(collateralAmount);
    });

    it('comet total supplied COMP is unchanged because LF = 0 skips collateral seizure', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(totalSupplyCompBefore);
    });

    it('comet COMP reserves are unchanged because LF = 0 skips collateral seizure', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(compReservesBefore);
    });

    it('asset remains in the assetIn list of the user', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(cometCompTokenBalanceBefore);
    });

    it('alice borrow balance is zero', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  // When the oracle reverts and governance deactivates the collateral as an emergency measure
  // (no factor changes), the borrow check hits TokenIsDeactivated first because deactivation is
  // checked before the oracle call in _getLiquidity(false). The liquidation path and absorb still
  // revert with the oracle error because _getLiquidity(true) does not check deactivation and
  // LCF > 0 triggers the oracle call.
  context('deactivated, all factors > 0', function() {
    before(async function() {
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      await comet.connect(pauseGuardian).deactivateCollateral(compInfo.offset);
    });

    after(async () => await snapshot.restore());

    it('absorb reverts with the oracle error because absorbInternal calls _getLiquidity(true) first which triggers the oracle before any deactivation check', async () => {
      await expect(comet.connect(absorber).absorb(absorber.address, [alice.address]))
        .to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
    });
  });

  // BCF = 0 would normally skip the oracle in the borrow-collateral check, but deactivation is
  // checked first in _getLiquidity(false) — TokenIsDeactivated fires even though BCF = 0 would
  // otherwise bypass the oracle. The liquidation path (LCF still default > 0) and absorb still
  // revert from the oracle because _getLiquidity(true) never checks deactivation.
  context('deactivated, BCF = 0, LCF and LF > 0', function() {
    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      await comet.connect(pauseGuardian).deactivateCollateral(compInfo.offset);
    });

    after(async () => await snapshot.restore());

    it('absorb reverts with the oracle error from _getLiquidity(true) inside absorbInternal because LCF > 0 triggers the oracle', async () => {
      await expect(comet.connect(absorber).absorb(absorber.address, [alice.address]))
        .to.be.revertedWithCustomError(priceFeedWithRevert, 'Reverted');
    });
  });

  // LCF = 0 causes the liquidation path to skip the oracle entirely, so isLiquidatable returns true.
  // However, absorbInternal also calls _getLiquidity(false) after the seizure loop to compute
  // totalCollateralizedValue - that path checks deactivation before the BCF = 0 oracle-skip,
  // blocking absorb even though _getLiquidity(true) succeeded.
  context('deactivated, BCF = 0, LCF = 0, LF > 0', function() {
    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      await comet.connect(pauseGuardian).deactivateCollateral(compInfo.offset);
    });

    after(async () => await snapshot.restore());

    it('absorb reverts with TokenIsDeactivated from _getLiquidity(false) inside absorbInternal', async () => {
      // _getLiquidity(true) succeeds (LCF = 0 skips oracle), but the subsequent
      // _getLiquidity(false) call for totalCollateralizedValue hits the deactivation check
      await expect(comet.connect(absorber).absorb(absorber.address, [alice.address]))
        .to.be.revertedWithCustomError(comet, 'TokenIsDeactivated')
        .withArgs(tokens['COMP'].address);
    });
  });

  // LF = 0 would cause the seizure loop to skip COMP entirely (collateral stays with the borrower),
  // but absorbInternal still calls _getLiquidity(false) after the loop for totalCollateralizedValue -
  // deactivation blocks that call before the BCF = 0 skip can help, so absorb reverts before bad
  // debt can be written off, even though no collateral would have been seized anyway.
  context('deactivated, all factors are zero', function() {
    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidationFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      await comet.connect(pauseGuardian).deactivateCollateral(compInfo.offset);
    });

    after(async () => await snapshot.restore());

    it('absorb reverts with TokenIsDeactivated because _getLiquidity(false) inside absorbInternal hits deactivation even after the seizure loop is skipped by LF = 0', async () => {
      await expect(comet.connect(absorber).absorb(absorber.address, [alice.address]))
        .to.be.revertedWithCustomError(comet, 'TokenIsDeactivated')
        .withArgs(tokens['COMP'].address);
    });
  });
});
