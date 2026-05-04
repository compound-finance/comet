import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, default24Assets, divPrice } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

// Tests for the targetHF break condition inside absorbInternal's collateral loop.
// The loop breaks early when (mulFactor(debtRemaining, targetHF) <= totalCollateralizedValue),
// meaning the remaining collateral already brings the position to targetHF without further seizure.
// These tests verify that untouched collateral assets are truly left alone and the account
// ends up healthy rather than fully liquidated.
describe('partial liquidation: target health factor restoration', function() {
  let comet: CometHarnessInterfaceExtendedAssetList;

  const baseTokenPrice = exp(1, 8);
  const initialBaseFunding = baseTokenPrice * 10_000n;
  const baseBorrowMin = exp(10, 6);

  let tokens: { [symbol: string]: FaucetToken } = {};
  let baseToken: FaucetToken;
  let priceFeeds: { [symbol: string]: SimplePriceFeed } = {};

  let alice: SignerWithAddress;
  let absorber: SignerWithAddress;

  const baseScale: bigint = 10n ** 6n;
  const factorScale: bigint = 10n ** 18n;
  let targetHealthFactor: bigint;

  let snapshot: SnapshotRestorer;

  before(async function() {
    const protocol = await makeProtocol({
      base: 'USDC',
      assets: {
        USDC: { decimals: 6, initialPrice: 1 },
        ...default24Assets(),
      },
      baseTrackingBorrowSpeed: 0,
      baseBorrowMin: baseBorrowMin,
    });
    comet = protocol.cometWithExtendedAssetList;
    for (let asset in protocol.tokens) {
      if (asset === 'USDC') continue;
      tokens[asset] = protocol.tokens[asset] as FaucetToken;
      priceFeeds[asset] = protocol.priceFeeds[asset];
    }
    baseToken = protocol.tokens['USDC'] as FaucetToken;
    priceFeeds['USDC'] = protocol.priceFeeds['USDC'];

    [alice, absorber] = protocol.users;

    const allocateAmount = exp(1_000_000, 18);
    for (const token of Object.values(protocol.tokens)) {
      await (token as FaucetToken).allocateTo(alice.address, allocateAmount);
      await (token as FaucetToken).connect(alice).approve(comet.address, ethers.constants.MaxUint256);
    }

    await baseToken.allocateTo(comet.address, initialBaseFunding);
    targetHealthFactor = (await comet.targetHealthFactor()).toBigInt();
    snapshot = await takeSnapshot();
  });

  context('2 collaterals: partial COMP seizure restores targetHF, WETH untouched (assets index 0 and 1)', function () {
    const compAmount = exp(1, 18); // $100
    const wethAmount = exp(0.001, 18); // $2
    const borrowAmount = exp(80, 6);
    const compDroppedPrice = exp(90, 8); // $90 per COMP
    const wethPrice = exp(2000, 8); // $2000 per WETH

    let compAsset: FaucetToken;
    let wethAsset: FaucetToken;
    let absorbTx: ContractTransaction;

    let compTotalsCollateralBefore: BigNumber;
    let wethTotalsCollateralBefore: BigNumber;
    let compCollateralReservesBefore: BigNumber;
    let wethCollateralReservesBefore: BigNumber;
    let cometCompTokenBalanceBefore: BigNumber;
    let cometWethTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let totalSupplyBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;

    let debtRemainingValue: bigint;
    let compValue: bigint;
    let wethValue: bigint;
    let totalCollateralizedValue: bigint;
    let compWantedCollateralValue: bigint;
    let compSeizeAmount: bigint;
    let compSeizedValue: bigint;
    let debtAfterComp: bigint;
    let totalCVAfterComp: bigint;

    before(async function() {
      compAsset = tokens['COMP'];
      wethAsset = tokens['WETH'];

      await comet.connect(alice).supply(compAsset.address, compAmount);
      await comet.connect(alice).supply(wethAsset.address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop COMP 10%: $100 → $90. Position becomes liquidatable:
      // LCF_weighted = 0.85×$90 + 0.80×$2 = $78.1 < debt $80
      await priceFeeds['COMP'].connect(alice).setRoundData(0, compDroppedPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice COMP collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(compAmount);
    });

    it('alice WETH collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(wethAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn includes both COMP and WETH', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const expectedAssetsIn = (1 << compInfo.offset) | (1 << wethInfo.offset);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved is equal to zero', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied COMP is equal to alice supplied COMP', async () => {
      compTotalsCollateralBefore = (await comet.totalsCollateral(compAsset.address)).totalSupplyAsset;
      expect(compTotalsCollateralBefore).to.be.equal(compAmount);
    });

    it('comet total supplied WETH is equal to alice supplied WETH', async () => {
      wethTotalsCollateralBefore = (await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset;
      expect(wethTotalsCollateralBefore).to.be.equal(wethAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('comet COMP collateral reserves are zero before absorb', async () => {
      compCollateralReservesBefore = await comet.getCollateralReserves(compAsset.address);
      expect(compCollateralReservesBefore).to.be.equal(0);
    });

    it('comet WETH collateral reserves are zero before absorb', async () => {
      wethCollateralReservesBefore = await comet.getCollateralReserves(wethAsset.address);
      expect(wethCollateralReservesBefore).to.be.equal(0);
    });

    it('comet ERC20 COMP token balance is equal to supplied COMP before absorb', async () => {
      cometCompTokenBalanceBefore = await compAsset.balanceOf(comet.address);
      expect(cometCompTokenBalanceBefore).to.be.equal(compAmount);
    });

    it('comet ERC20 WETH token balance is equal to supplied WETH before absorb', async () => {
      cometWethTokenBalanceBefore = await wethAsset.balanceOf(comet.address);
      expect(cometWethTokenBalanceBefore).to.be.equal(wethAmount);
    });

    it('comet ERC20 base token balance is reduced by the borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('alice simple base balance is zero before absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      const principal = (await comet.userBasic(alice.address)).principal;
      expect(principal).to.be.equal(-borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates expected partial seizure amounts for COMP', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);

      // debtRemainingValue = $80 in Chainlink 8-decimal price units = 8000000000
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // 1 COMP × $90 / 1e18 = 9000000000
      compValue = mulPrice(compAmount, compDroppedPrice, compInfo.scale);

      // 0.001 WETH × $2000 / 1e18 = 200000000
      wethValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);

      // BCF-weighted: 0.80 × $90 + 0.75 × $2 = $73.5 = 7350000000
      totalCollateralizedValue =
        mulFactor(compValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethValue, wethInfo.borrowCollateralFactor);

      // S = (1.05 × $80 − $73.5) × 1e18 / (1.05 × 0.9 − 0.8) × 1e18 ≈ $72.41 = 7241379310
      compWantedCollateralValue =
        (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());

      // seizeAmount = floor($72.41 × 1e18 / $90) ≈ 804597701111111111 (≈0.8046 COMP)
      compSeizeAmount = divPrice(compWantedCollateralValue, compDroppedPrice, compInfo.scale);

      // seizedValue = $72.41 × 0.9 = $65.17 = 6517241379
      compSeizedValue = mulFactor(compWantedCollateralValue, compInfo.liquidationFactor);

      // After seizing COMP: remaining debt and BCF-weighted collateral used for targetHF check
      // debtAfterComp = $80 − $65.17 = $14.83 = 1482758621
      debtAfterComp = debtRemainingValue - compSeizedValue;

      // totalCVAfterComp = $73.5 − 0.80 × $72.41 = $15.57 = 1556896552
      totalCVAfterComp = totalCollateralizedValue - mulFactor(compWantedCollateralValue, compInfo.borrowCollateralFactor);
    });

    it('wantedCollateralValue is less than COMP collateral value: partial seizure confirmed', () => {
      expect(compWantedCollateralValue).to.be.lessThan(compValue);
    });

    it('after COMP partial seizure, targetHF condition is met: loop breaks before touching WETH', () => {
      expect(mulFactor(debtAfterComp, targetHealthFactor)).to.be.equal(totalCVAfterComp);
    });

    it('calculates newBalance after partial debt reduction', () => {
      newBalance = -(debtAfterComp * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address));
      expect(newBalance).to.be.greaterThan(oldBalance);
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('AbsorbCollateral is emitted for COMP with partial seized amount', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        compAsset.address,
        compSeizeAmount,
        compWantedCollateralValue
      );
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to newBalance', async () => {
      const principal = (await comet.userBasic(alice.address)).principal;
      expect(principal).to.be.equal(newBalance);
    });

    it('alice COMP balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(
        compAmount - compSeizeAmount
      );
    });

    it('alice WETH balance is unchanged: WETH was not seized', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(wethAmount);
    });

    it('alice still has remaining debt after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(0);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal((debtAfterComp * baseScale / baseTokenPrice));
    });

    it('alice is no longer liquidatable after partial seizure restored targetHF', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.false;
    });

    it('alice assetsIn still includes both COMP and WETH after partial seizure', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied COMP is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(compAsset.address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(compTotalsCollateralBefore.sub(compSeizeAmount));
    });

    it('comet total supplied WETH is unchanged', async () => {
      expect((await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset).to.be.equal(
        wethTotalsCollateralBefore
      );
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet COMP collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(compAsset.address)).to.be.equal(
        compCollateralReservesBefore.add(compSeizeAmount)
      );
    });

    it('comet WETH collateral reserves remain zero', async () => {
      expect(await comet.getCollateralReserves(wethAsset.address)).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ERC20 COMP token balance does not change during absorb', async () => {
      expect(await compAsset.balanceOf(comet.address)).to.be.equal(cometCompTokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance does not change during absorb', async () => {
      expect(await wethAsset.balanceOf(comet.address)).to.be.equal(cometWethTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });
  });

  context('2 collaterals: partial AAVE seizure restores targetHF, LDO untouched (assets index 15 and 16)', function () {
    const aaveAmount = exp(1, 18); // $100 before the price drop
    const ldoAmount = exp(10, 18); // $20
    const borrowAmount = exp(66, 6);

    let aaveAsset: FaucetToken;
    let ldoAsset: FaucetToken;
    let absorbTx: ContractTransaction;

    let aaveTotalsCollateralBefore: BigNumber;
    let ldoTotalsCollateralBefore: BigNumber;
    let aaveCollateralReservesBefore: BigNumber;
    let ldoCollateralReservesBefore: BigNumber;
    let cometAaveTokenBalanceBefore: BigNumber;
    let cometLdoTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let totalSupplyBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;

    let debtRemainingValue: bigint;
    let aaveValue: bigint;
    let ldoValue: bigint;
    let totalCollateralizedValue: bigint;
    let aaveWantedCollateralValue: bigint;
    let aaveSeizeAmount: bigint;
    let aaveSeizedValue: bigint;
    let debtAfterAave: bigint;
    let totalCVAfterAave: bigint;

    before(async function() {
      aaveAsset = tokens['AAVE'];
      ldoAsset = tokens['LDO'];

      await comet.connect(alice).supply(aaveAsset.address, aaveAmount);
      await comet.connect(alice).supply(ldoAsset.address, ldoAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop AAVE 20%: $100 -> $80. Position becomes liquidatable:
      // LCF_weighted = 0.65*$80 + 0.62*$20 = $64.40 < debt $66.
      const aavePrice = (await priceFeeds['AAVE'].latestRoundData())[1].toBigInt();
      await priceFeeds['AAVE'].connect(alice).setRoundData(0, aavePrice * 80n / 100n, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice AAVE collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, aaveAsset.address)).to.be.equal(aaveAmount);
    });

    it('alice LDO collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ldoAsset.address)).to.be.equal(ldoAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn includes only AAVE', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);

      expect(aaveInfo.offset).to.be.equal(15);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(1 << aaveInfo.offset);
    });

    it('alice reserved includes only LDO', async () => {
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);

      expect(ldoInfo.offset).to.be.equal(16);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (ldoInfo.offset - 16));
    });

    it('comet total supplied AAVE is equal to alice supplied AAVE', async () => {
      aaveTotalsCollateralBefore = (await comet.totalsCollateral(aaveAsset.address)).totalSupplyAsset;
      expect(aaveTotalsCollateralBefore).to.be.equal(aaveAmount);
    });

    it('comet total supplied LDO is equal to alice supplied LDO', async () => {
      ldoTotalsCollateralBefore = (await comet.totalsCollateral(ldoAsset.address)).totalSupplyAsset;
      expect(ldoTotalsCollateralBefore).to.be.equal(ldoAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('comet AAVE collateral reserves are zero before absorb', async () => {
      aaveCollateralReservesBefore = await comet.getCollateralReserves(aaveAsset.address);
      expect(aaveCollateralReservesBefore).to.be.equal(0);
    });

    it('comet LDO collateral reserves are zero before absorb', async () => {
      ldoCollateralReservesBefore = await comet.getCollateralReserves(ldoAsset.address);
      expect(ldoCollateralReservesBefore).to.be.equal(0);
    });

    it('comet ERC20 AAVE token balance is equal to supplied AAVE before absorb', async () => {
      cometAaveTokenBalanceBefore = await aaveAsset.balanceOf(comet.address);
      expect(cometAaveTokenBalanceBefore).to.be.equal(aaveAmount);
    });

    it('comet ERC20 LDO token balance is equal to supplied LDO before absorb', async () => {
      cometLdoTokenBalanceBefore = await ldoAsset.balanceOf(comet.address);
      expect(cometLdoTokenBalanceBefore).to.be.equal(ldoAmount);
    });

    it('comet ERC20 base token balance is reduced by the borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('alice simple base balance is zero before absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates expected partial seizure amounts for AAVE', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const aavePrice = (await priceFeeds['AAVE'].latestRoundData())[1].toBigInt();
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      aaveValue = mulPrice(aaveAmount, aavePrice, aaveInfo.scale);
      ldoValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);

      // BCF-weighted: 0.60 * $80 + 0.55 * $20 = $59.
      totalCollateralizedValue =
        mulFactor(aaveValue, aaveInfo.borrowCollateralFactor) +
        mulFactor(ldoValue, ldoInfo.borrowCollateralFactor);

      // S = (1.05 * $66 - $59) * 1e18 / (1.05 * 0.85 - 0.60) ~= $35.21.
      aaveWantedCollateralValue =
        (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(aaveInfo.liquidationFactor, targetHealthFactor) - aaveInfo.borrowCollateralFactor.toBigInt());

      aaveSeizeAmount = divPrice(aaveWantedCollateralValue, aavePrice, aaveInfo.scale);
      aaveSeizedValue = mulFactor(aaveWantedCollateralValue, aaveInfo.liquidationFactor);

      // After seizing AAVE, the remaining debt and BCF-weighted collateral satisfy targetHF.
      debtAfterAave = debtRemainingValue - aaveSeizedValue;
      totalCVAfterAave = totalCollateralizedValue - mulFactor(aaveWantedCollateralValue, aaveInfo.borrowCollateralFactor);
    });

    it('wantedCollateralValue is less than AAVE collateral value: partial seizure confirmed', () => {
      expect(aaveWantedCollateralValue).to.be.lessThan(aaveValue);
    });

    it('after AAVE partial seizure, targetHF condition is met: loop breaks before touching LDO', () => {
      expect(mulFactor(debtAfterAave, targetHealthFactor)).to.be.equal(totalCVAfterAave);
    });

    it('calculates newBalance after partial debt reduction', () => {
      newBalance = -(debtAfterAave * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address));
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('AbsorbCollateral is emitted for AAVE with partial seized amount', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        aaveAsset.address,
        aaveSeizeAmount,
        aaveWantedCollateralValue
      );
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice AAVE balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, aaveAsset.address)).to.be.equal(
        aaveAmount - aaveSeizeAmount
      );
    });

    it('alice LDO balance is unchanged: LDO was not seized', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ldoAsset.address)).to.be.equal(ldoAmount);
    });

    it('alice still has remaining debt after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(0);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal((debtAfterAave * baseScale / baseTokenPrice));
    });

    it('alice is no longer liquidatable after partial seizure restored targetHF', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.false;
    });

    it('alice assetsIn still includes AAVE after partial seizure', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved still includes LDO after partial seizure', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to newBalance', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(newBalance);
    });

    it('comet total supplied AAVE is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(aaveAsset.address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(aaveTotalsCollateralBefore.sub(aaveSeizeAmount));
    });

    it('comet total supplied LDO is unchanged', async () => {
      expect((await comet.totalsCollateral(ldoAsset.address)).totalSupplyAsset).to.be.equal(
        ldoTotalsCollateralBefore
      );
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet AAVE collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(aaveAsset.address)).to.be.equal(
        aaveCollateralReservesBefore.add(aaveSeizeAmount)
      );
    });

    it('comet LDO collateral reserves remain zero', async () => {
      expect(await comet.getCollateralReserves(ldoAsset.address)).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ERC20 AAVE token balance does not change during absorb', async () => {
      expect(await aaveAsset.balanceOf(comet.address)).to.be.equal(cometAaveTokenBalanceBefore);
    });

    it('comet ERC20 LDO token balance does not change during absorb', async () => {
      expect(await ldoAsset.balanceOf(comet.address)).to.be.equal(cometLdoTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });
  });

  context('2 non-adjacent collaterals: partial rETH seizure restores targetHF, LDO untouched (assets index 8 and 16)', function () {
    const rEthAmount = exp(0.025, 18); // $87.50 before the price drop
    const ldoAmount = exp(10, 18); // $20
    const borrowAmount = exp(70, 6);

    let rEthAsset: FaucetToken;
    let ldoAsset: FaucetToken;
    let absorbTx: ContractTransaction;

    let rEthTotalsCollateralBefore: BigNumber;
    let ldoTotalsCollateralBefore: BigNumber;
    let rEthCollateralReservesBefore: BigNumber;
    let ldoCollateralReservesBefore: BigNumber;
    let cometREthTokenBalanceBefore: BigNumber;
    let cometLdoTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let totalSupplyBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;

    let debtRemainingValue: bigint;
    let rEthValue: bigint;
    let ldoValue: bigint;
    let totalCollateralizedValue: bigint;
    let rEthWantedCollateralValue: bigint;
    let rEthSeizeAmount: bigint;
    let rEthSeizedValue: bigint;
    let debtAfterREth: bigint;
    let totalCVAfterREth: bigint;

    before(async function() {
      rEthAsset = tokens['rETH'];
      ldoAsset = tokens['LDO'];

      await comet.connect(alice).supply(rEthAsset.address, rEthAmount);
      await comet.connect(alice).supply(ldoAsset.address, ldoAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop rETH 20%: $87.50 -> $70. Position becomes liquidatable:
      // LCF_weighted = 0.78*$70 + 0.62*$20 = $67 < debt $70.
      const rEthPrice = (await priceFeeds['rETH'].latestRoundData())[1].toBigInt();
      await priceFeeds['rETH'].connect(alice).setRoundData(0, rEthPrice * 80n / 100n, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice rETH collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, rEthAsset.address)).to.be.equal(rEthAmount);
    });

    it('alice LDO collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ldoAsset.address)).to.be.equal(ldoAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn includes only rETH', async () => {
      const rEthInfo = await comet.getAssetInfoByAddress(rEthAsset.address);

      expect(rEthInfo.offset).to.be.equal(8);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(1 << rEthInfo.offset);
    });

    it('alice reserved includes only LDO', async () => {
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);

      expect(ldoInfo.offset).to.be.equal(16);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (ldoInfo.offset - 16));
    });

    it('comet total supplied rETH is equal to alice supplied rETH', async () => {
      rEthTotalsCollateralBefore = (await comet.totalsCollateral(rEthAsset.address)).totalSupplyAsset;
      expect(rEthTotalsCollateralBefore).to.be.equal(rEthAmount);
    });

    it('comet total supplied LDO is equal to alice supplied LDO', async () => {
      ldoTotalsCollateralBefore = (await comet.totalsCollateral(ldoAsset.address)).totalSupplyAsset;
      expect(ldoTotalsCollateralBefore).to.be.equal(ldoAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('comet rETH collateral reserves are zero before absorb', async () => {
      rEthCollateralReservesBefore = await comet.getCollateralReserves(rEthAsset.address);
      expect(rEthCollateralReservesBefore).to.be.equal(0);
    });

    it('comet LDO collateral reserves are zero before absorb', async () => {
      ldoCollateralReservesBefore = await comet.getCollateralReserves(ldoAsset.address);
      expect(ldoCollateralReservesBefore).to.be.equal(0);
    });

    it('comet ERC20 rETH token balance is equal to supplied rETH before absorb', async () => {
      cometREthTokenBalanceBefore = await rEthAsset.balanceOf(comet.address);
      expect(cometREthTokenBalanceBefore).to.be.equal(rEthAmount);
    });

    it('comet ERC20 LDO token balance is equal to supplied LDO before absorb', async () => {
      cometLdoTokenBalanceBefore = await ldoAsset.balanceOf(comet.address);
      expect(cometLdoTokenBalanceBefore).to.be.equal(ldoAmount);
    });

    it('comet ERC20 base token balance is reduced by the borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('alice simple base balance is zero before absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates expected partial seizure amounts for rETH', async () => {
      const rEthInfo = await comet.getAssetInfoByAddress(rEthAsset.address);
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const rEthPrice = (await priceFeeds['rETH'].latestRoundData())[1].toBigInt();
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      rEthValue = mulPrice(rEthAmount, rEthPrice, rEthInfo.scale);
      ldoValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);

      // BCF-weighted: 0.72 * $70 + 0.55 * $20 = $61.40.
      totalCollateralizedValue =
        mulFactor(rEthValue, rEthInfo.borrowCollateralFactor) +
        mulFactor(ldoValue, ldoInfo.borrowCollateralFactor);

      // S = (1.05 * $70 - $61.40) * 1e18 / (1.05 * 0.92 - 0.72) ~= $49.19.
      rEthWantedCollateralValue =
        (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(rEthInfo.liquidationFactor, targetHealthFactor) - rEthInfo.borrowCollateralFactor.toBigInt());

      rEthSeizeAmount = divPrice(rEthWantedCollateralValue, rEthPrice, rEthInfo.scale);
      rEthSeizedValue = mulFactor(rEthWantedCollateralValue, rEthInfo.liquidationFactor);

      // When the loop later reaches LDO, the remaining debt is already healthy at targetHF.
      debtAfterREth = debtRemainingValue - rEthSeizedValue;
      totalCVAfterREth = totalCollateralizedValue - mulFactor(rEthWantedCollateralValue, rEthInfo.borrowCollateralFactor);
    });

    it('wantedCollateralValue is less than rETH collateral value: partial seizure confirmed', () => {
      expect(rEthWantedCollateralValue).to.be.lessThan(rEthValue);
    });

    it('after rETH partial seizure, targetHF condition is met when the loop reaches LDO', () => {
      expect(mulFactor(debtAfterREth, targetHealthFactor)).to.be.lessThan(totalCVAfterREth);
    });

    it('calculates newBalance after partial debt reduction', () => {
      newBalance = -(debtAfterREth * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      expect(-(await comet.borrowBalanceOf(alice.address))).to.be.equal(newBalance);
    });

    it('AbsorbCollateral is emitted for rETH with partial seized amount', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        rEthAsset.address,
        rEthSeizeAmount,
        rEthWantedCollateralValue
      );
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice rETH balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, rEthAsset.address)).to.be.equal(
        rEthAmount - rEthSeizeAmount
      );
    });

    it('alice LDO balance is unchanged: LDO was not seized', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ldoAsset.address)).to.be.equal(ldoAmount);
    });

    it('alice still has remaining debt after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(0);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal((debtAfterREth * baseScale / baseTokenPrice));
    });

    it('alice is no longer liquidatable after partial seizure restored targetHF', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.false;
    });

    it('alice assetsIn still includes rETH after partial seizure', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved still includes LDO after partial seizure', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to newBalance', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(newBalance);
    });

    it('comet total supplied rETH is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(rEthAsset.address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(rEthTotalsCollateralBefore.sub(rEthSeizeAmount));
    });

    it('comet total supplied LDO is unchanged', async () => {
      expect((await comet.totalsCollateral(ldoAsset.address)).totalSupplyAsset).to.be.equal(
        ldoTotalsCollateralBefore
      );
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet rETH collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(rEthAsset.address)).to.be.equal(
        rEthCollateralReservesBefore.add(rEthSeizeAmount)
      );
    });

    it('comet LDO collateral reserves remain zero', async () => {
      expect(await comet.getCollateralReserves(ldoAsset.address)).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ERC20 rETH token balance does not change during absorb', async () => {
      expect(await rEthAsset.balanceOf(comet.address)).to.be.equal(cometREthTokenBalanceBefore);
    });

    it('comet ERC20 LDO token balance does not change during absorb', async () => {
      expect(await ldoAsset.balanceOf(comet.address)).to.be.equal(cometLdoTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });
  });

  context('3 collaterals: rETH fully seized, AAVE partially seized, LDO untouched (assets index 8, 15 and 16)', function () {
    const rEthAmount = exp(0.01, 18); // $30 after the price change
    const aaveAmount = exp(1, 18); // $80 after the price change
    const ldoAmount = exp(10, 18); // $20
    const borrowAmount = exp(90, 6);
    const rEthDroppedPrice = exp(3000, 8);
    const aaveDroppedPrice = exp(80, 8);

    let rEthAsset: FaucetToken;
    let aaveAsset: FaucetToken;
    let ldoAsset: FaucetToken;
    let absorbTx: ContractTransaction;

    let rEthTotalsCollateralBefore: BigNumber;
    let aaveTotalsCollateralBefore: BigNumber;
    let ldoTotalsCollateralBefore: BigNumber;
    let rEthCollateralReservesBefore: BigNumber;
    let aaveCollateralReservesBefore: BigNumber;
    let ldoCollateralReservesBefore: BigNumber;
    let cometREthTokenBalanceBefore: BigNumber;
    let cometAaveTokenBalanceBefore: BigNumber;
    let cometLdoTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldPrincipal: bigint;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;

    let debtRemainingValue: bigint;
    let rEthValue: bigint;
    let aaveValue: bigint;
    let ldoValue: bigint;
    let totalCollateralizedValue: bigint;
    let rEthWantedCollateralValue: bigint;
    let rEthSeizeAmount: bigint;
    let rEthSeizedValue: bigint;
    let aaveWantedCollateralValue: bigint;
    let aaveSeizeAmount: bigint;
    let aaveSeizedValue: bigint;
    let debtAfterREth: bigint;
    let debtAfterAave: bigint;
    let totalCVAfterAave: bigint;

    before(async function() {
      rEthAsset = tokens['rETH'];
      aaveAsset = tokens['AAVE'];
      ldoAsset = tokens['LDO'];

      await comet.connect(alice).supply(rEthAsset.address, rEthAmount);
      await comet.connect(alice).supply(aaveAsset.address, aaveAmount);
      await comet.connect(alice).supply(ldoAsset.address, ldoAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // rETH becomes worth $30 and AAVE becomes worth $80.
      // LCF_weighted = 0.78*$30 + 0.65*$80 + 0.62*$20 = $87.80 < debt $90.
      await priceFeeds['rETH'].connect(alice).setRoundData(0, rEthDroppedPrice, 0, 0, 0);
      await priceFeeds['AAVE'].connect(alice).setRoundData(0, aaveDroppedPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldPrincipal = principal.toBigInt();
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice rETH collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, rEthAsset.address)).to.be.equal(rEthAmount);
    });

    it('alice AAVE collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, aaveAsset.address)).to.be.equal(aaveAmount);
    });

    it('alice LDO collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ldoAsset.address)).to.be.equal(ldoAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn includes rETH and AAVE', async () => {
      const rEthInfo = await comet.getAssetInfoByAddress(rEthAsset.address);
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);
      const expectedAssetsIn = (1 << rEthInfo.offset) | (1 << aaveInfo.offset);

      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved includes only LDO', async () => {
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);

      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (ldoInfo.offset - 16));
    });

    it('comet total supplied rETH is equal to alice supplied rETH', async () => {
      rEthTotalsCollateralBefore = (await comet.totalsCollateral(rEthAsset.address)).totalSupplyAsset;
      expect(rEthTotalsCollateralBefore).to.be.equal(rEthAmount);
    });

    it('comet total supplied AAVE is equal to alice supplied AAVE', async () => {
      aaveTotalsCollateralBefore = (await comet.totalsCollateral(aaveAsset.address)).totalSupplyAsset;
      expect(aaveTotalsCollateralBefore).to.be.equal(aaveAmount);
    });

    it('comet total supplied LDO is equal to alice supplied LDO', async () => {
      ldoTotalsCollateralBefore = (await comet.totalsCollateral(ldoAsset.address)).totalSupplyAsset;
      expect(ldoTotalsCollateralBefore).to.be.equal(ldoAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(-oldPrincipal);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('comet rETH collateral reserves are zero before absorb', async () => {
      rEthCollateralReservesBefore = await comet.getCollateralReserves(rEthAsset.address);
      expect(rEthCollateralReservesBefore).to.be.equal(0);
    });

    it('comet AAVE collateral reserves are zero before absorb', async () => {
      aaveCollateralReservesBefore = await comet.getCollateralReserves(aaveAsset.address);
      expect(aaveCollateralReservesBefore).to.be.equal(0);
    });

    it('comet LDO collateral reserves are zero before absorb', async () => {
      ldoCollateralReservesBefore = await comet.getCollateralReserves(ldoAsset.address);
      expect(ldoCollateralReservesBefore).to.be.equal(0);
    });

    it('comet ERC20 rETH token balance is equal to supplied rETH before absorb', async () => {
      cometREthTokenBalanceBefore = await rEthAsset.balanceOf(comet.address);
      expect(cometREthTokenBalanceBefore).to.be.equal(rEthAmount);
    });

    it('comet ERC20 AAVE token balance is equal to supplied AAVE before absorb', async () => {
      cometAaveTokenBalanceBefore = await aaveAsset.balanceOf(comet.address);
      expect(cometAaveTokenBalanceBefore).to.be.equal(aaveAmount);
    });

    it('comet ERC20 LDO token balance is equal to supplied LDO before absorb', async () => {
      cometLdoTokenBalanceBefore = await ldoAsset.balanceOf(comet.address);
      expect(cometLdoTokenBalanceBefore).to.be.equal(ldoAmount);
    });

    it('comet ERC20 base token balance is reduced by the borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('alice simple base balance is zero before absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(oldPrincipal);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates rETH full seizure values', async () => {
      const rEthInfo = await comet.getAssetInfoByAddress(rEthAsset.address);
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      rEthValue = mulPrice(rEthAmount, rEthDroppedPrice, rEthInfo.scale);
      aaveValue = mulPrice(aaveAmount, aaveDroppedPrice, aaveInfo.scale);
      ldoValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);

      // BCF-weighted: 0.72*$30 + 0.60*$80 + 0.55*$20 = $80.60.
      totalCollateralizedValue =
        mulFactor(rEthValue, rEthInfo.borrowCollateralFactor) +
        mulFactor(aaveValue, aaveInfo.borrowCollateralFactor) +
        mulFactor(ldoValue, ldoInfo.borrowCollateralFactor);

      // The target HF formula wants more than $30 of rETH, so rETH is fully seized.
      rEthWantedCollateralValue =
        (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(rEthInfo.liquidationFactor, targetHealthFactor) - rEthInfo.borrowCollateralFactor.toBigInt());
      expect(rEthWantedCollateralValue).to.be.greaterThan(rEthValue);

      rEthSeizeAmount = rEthAmount;
      rEthSeizedValue = mulFactor(rEthValue, rEthInfo.liquidationFactor);
    });

    it('calculates AAVE partial seizure values', async () => {
      const rEthInfo = await comet.getAssetInfoByAddress(rEthAsset.address);
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);

      debtAfterREth = debtRemainingValue - rEthSeizedValue;
      const totalCVAfterREth = totalCollateralizedValue - mulFactor(rEthValue, rEthInfo.borrowCollateralFactor);

      // After rETH full seizure, debt is $90 - $27.60 = $62.40.
      // AAVE and LDO still provide $59 of BCF-weighted collateral.
      aaveWantedCollateralValue =
        (mulFactor(debtAfterREth, targetHealthFactor) - totalCVAfterREth) * factorScale
        / (mulFactor(aaveInfo.liquidationFactor, targetHealthFactor) - aaveInfo.borrowCollateralFactor.toBigInt());
      expect(aaveWantedCollateralValue).to.be.lessThan(aaveValue);

      aaveSeizeAmount = divPrice(aaveWantedCollateralValue, aaveDroppedPrice, aaveInfo.scale);
      aaveSeizedValue = mulFactor(aaveWantedCollateralValue, aaveInfo.liquidationFactor);

      debtAfterAave = debtAfterREth - aaveSeizedValue;
      totalCVAfterAave = totalCVAfterREth - mulFactor(aaveWantedCollateralValue, aaveInfo.borrowCollateralFactor);
    });

    it('after AAVE partial seizure, targetHF condition is met before touching LDO', () => {
      expect(mulFactor(debtAfterAave, targetHealthFactor)).to.be.equal(totalCVAfterAave);
    });

    it('calculates newBalance after rETH and AAVE reduce debt', () => {
      newBalance = -(debtAfterAave * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address));
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('AbsorbCollateral is emitted for rETH with full seized amount', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        rEthAsset.address,
        rEthSeizeAmount,
        rEthValue
      );
    });

    it('AbsorbCollateral is emitted for AAVE with partial seized amount', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        aaveAsset.address,
        aaveSeizeAmount,
        aaveWantedCollateralValue
      );
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice rETH balance is zero after full seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, rEthAsset.address)).to.be.equal(0);
    });

    it('alice AAVE balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, aaveAsset.address)).to.be.equal(
        aaveAmount - aaveSeizeAmount
      );
    });

    it('alice LDO balance is unchanged: LDO was not seized', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ldoAsset.address)).to.be.equal(ldoAmount);
    });

    it('alice still has remaining debt after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(0);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal((debtAfterAave * baseScale / baseTokenPrice));
    });

    it('alice is no longer liquidatable after partial seizure restored targetHF', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.false;
    });

    it('alice assetsIn keeps only AAVE after rETH full seizure', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);

      expect(assetsInBefore).to.not.be.equal(1 << aaveInfo.offset);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(1 << aaveInfo.offset);
    });

    it('alice reserved still includes LDO after absorb', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to newBalance', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(newBalance);
    });

    it('comet total supplied rETH is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(rEthAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(rEthTotalsCollateralBefore.sub(rEthSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied AAVE is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(aaveAsset.address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(aaveTotalsCollateralBefore.sub(aaveSeizeAmount));
    });

    it('comet total supplied LDO is unchanged', async () => {
      expect((await comet.totalsCollateral(ldoAsset.address)).totalSupplyAsset).to.be.equal(
        ldoTotalsCollateralBefore
      );
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
      const newPrincipal = (await comet.userBasic(alice.address)).principal.toBigInt();
      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(newPrincipal - oldPrincipal));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet rETH collateral reserves increase by all seized rETH', async () => {
      expect(await comet.getCollateralReserves(rEthAsset.address)).to.be.equal(
        rEthCollateralReservesBefore.add(rEthSeizeAmount)
      );
    });

    it('comet AAVE collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(aaveAsset.address)).to.be.equal(
        aaveCollateralReservesBefore.add(aaveSeizeAmount)
      );
    });

    it('comet LDO collateral reserves remain zero', async () => {
      expect(await comet.getCollateralReserves(ldoAsset.address)).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ERC20 rETH token balance does not change during absorb', async () => {
      expect(await rEthAsset.balanceOf(comet.address)).to.be.equal(cometREthTokenBalanceBefore);
    });

    it('comet ERC20 AAVE token balance does not change during absorb', async () => {
      expect(await aaveAsset.balanceOf(comet.address)).to.be.equal(cometAaveTokenBalanceBefore);
    });

    it('comet ERC20 LDO token balance does not change during absorb', async () => {
      expect(await ldoAsset.balanceOf(comet.address)).to.be.equal(cometLdoTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });
  });

  context('24 collaterals: assets 0-4 fully seized, asset 5 partially seized, assets 6-23 untouched', function () {
    const assetSymbols = [
      'COMP', 'WETH', 'USDT', 'WBTC', 'DAI', 'wstETH',
      'rsETH', 'cbETH', 'rETH', 'weETH', 'ezETH', 'cbBTC',
      'tBTC', 'LINK', 'UNI', 'AAVE', 'LDO', 'CRV',
      'MKR', 'ARB', 'OP', 'GMX', 'USDe', 'sUSDe',
    ];
    const borrowAmount = exp(103, 6);
    const firstFullSeizureCount = 5;
    const partialSeizureIndex = 5;

    let collateralAssets: FaucetToken[] = [];
    let collateralAmounts: bigint[] = [];
    let collateralValues: bigint[] = [];
    let collateralPrices: bigint[] = [];
    let wantedCollateralValues: bigint[] = [];
    let seizeAmounts: bigint[] = [];
    let seizedValues: bigint[] = [];
    let totalsCollateralBefore: BigNumber[] = [];
    let collateralReservesBefore: BigNumber[] = [];
    let cometCollateralTokenBalancesBefore: BigNumber[] = [];
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldPrincipal: bigint;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let totalCollateralizedValue: bigint;
    let debtAfterPartialSeizure: bigint;
    let totalCVAfterPartialSeizure: bigint;

    before(async function() {
      const smallCollateralValue = baseTokenPrice / 100n; // $0.01
      const targetCollateralValues = [
        baseTokenPrice * 5n,
        baseTokenPrice * 5n,
        baseTokenPrice * 5n,
        baseTokenPrice * 5n,
        baseTokenPrice * 5n,
        baseTokenPrice * 100n,
        ...Array(assetSymbols.length - 6).fill(smallCollateralValue),
      ];

      collateralAssets = [];
      collateralAmounts = [];
      collateralValues = [];
      collateralPrices = [];
      wantedCollateralValues = Array(assetSymbols.length).fill(0n);
      seizeAmounts = Array(assetSymbols.length).fill(0n);
      seizedValues = Array(assetSymbols.length).fill(0n);

      for (let i = 0; i < assetSymbols.length; i++) {
        const asset = tokens[assetSymbols[i]];
        const assetInfo = await comet.getAssetInfoByAddress(asset.address);
        const initialAssetPrice = (await priceFeeds[assetSymbols[i]].latestRoundData())[1].toBigInt();
        const finalAssetPrice = initialAssetPrice / 2n;
        const amount = divPrice(targetCollateralValues[i], finalAssetPrice, assetInfo.scale);

        collateralAssets.push(asset);
        collateralAmounts.push(amount);
        collateralPrices.push(finalAssetPrice);
        collateralValues.push(mulPrice(amount, finalAssetPrice, assetInfo.scale));
        await comet.connect(alice).supply(asset.address, amount);
      }
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // The borrow is opened while prices are healthy, then every collateral is repriced
      // to the target liquidation value used by the seizure math below.
      for (let i = 0; i < assetSymbols.length; i++) {
        await priceFeeds[assetSymbols[i]].connect(alice).setRoundData(0, collateralPrices[i], 0, 0, 0);
      }
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldPrincipal = principal.toBigInt();
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice collateral balances are equal to supplied amounts before absorb', async () => {
      for (let i = 0; i < assetSymbols.length; i++) {
        expect(await comet.collateralBalanceOf(alice.address, collateralAssets[i].address)).to.be.equal(collateralAmounts[i]);
      }
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn includes asset indexes 0 through 15', async () => {
      for (let i = 0; i < 16; i++) {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAssets[i].address);
        expect(assetInfo.offset).to.be.equal(i);
      }

      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal((1 << 16) - 1);
    });

    it('alice reserved includes asset indexes 16 through 23', async () => {
      for (let i = 16; i < assetSymbols.length; i++) {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAssets[i].address);
        expect(assetInfo.offset).to.be.equal(i);
      }

      expect((await comet.userBasic(alice.address))._reserved).to.be.equal((1 << 8) - 1);
    });

    it('comet total supplied collateral amounts are equal to alice supplied amounts', async () => {
      totalsCollateralBefore = [];

      for (let i = 0; i < assetSymbols.length; i++) {
        const totalSupplyAsset = (await comet.totalsCollateral(collateralAssets[i].address)).totalSupplyAsset;
        totalsCollateralBefore.push(totalSupplyAsset);
        expect(totalSupplyAsset).to.be.equal(collateralAmounts[i]);
      }
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.approximately(-oldPrincipal, 1n); // 1 wei tolerance
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('comet collateral reserves are zero before absorb', async () => {
      collateralReservesBefore = [];

      for (let i = 0; i < assetSymbols.length; i++) {
        const collateralReserves = await comet.getCollateralReserves(collateralAssets[i].address);
        collateralReservesBefore.push(collateralReserves);
        expect(collateralReserves).to.be.equal(0);
      }
    });

    it('comet ERC20 collateral token balances are equal to supplied collateral before absorb', async () => {
      cometCollateralTokenBalancesBefore = [];

      for (let i = 0; i < assetSymbols.length; i++) {
        const cometCollateralTokenBalance = await collateralAssets[i].balanceOf(comet.address);
        cometCollateralTokenBalancesBefore.push(cometCollateralTokenBalance);
        expect(cometCollateralTokenBalance).to.be.equal(collateralAmounts[i]);
      }
    });

    it('comet ERC20 base token balance is reduced by the borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('alice simple base balance is zero before absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(oldPrincipal);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates full seizure values for asset indexes 0 through 4', async () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      totalCollateralizedValue = 0n;

      for (let i = 0; i < assetSymbols.length; i++) {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAssets[i].address);
        totalCollateralizedValue += mulFactor(collateralValues[i], assetInfo.borrowCollateralFactor);
      }

      for (let i = 0; i < firstFullSeizureCount; i++) {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAssets[i].address);

        // S = (targetHF * debt - totalCollateralValue) / (targetHF * LF - BCF)
        // The first five supplied collateral values are small, so each wanted value exceeds what Alice has.
        wantedCollateralValues[i] =
          (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
          / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
        expect(wantedCollateralValues[i]).to.be.greaterThan(collateralValues[i]);

        wantedCollateralValues[i] = collateralValues[i];
        seizeAmounts[i] = collateralAmounts[i];
        seizedValues[i] = mulFactor(collateralValues[i], assetInfo.liquidationFactor);
        debtRemainingValue -= seizedValues[i];
        totalCollateralizedValue -= mulFactor(collateralValues[i], assetInfo.borrowCollateralFactor);
      }
    });

    it('calculates partial seizure values for asset index 5', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAssets[partialSeizureIndex].address);

      // After the first five assets are fully seized, wstETH has enough value to restore targetHF partially.
      wantedCollateralValues[partialSeizureIndex] =
        (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValues[partialSeizureIndex]).to.be.lessThan(collateralValues[partialSeizureIndex]);

      seizeAmounts[partialSeizureIndex] = divPrice(
        wantedCollateralValues[partialSeizureIndex],
        collateralPrices[partialSeizureIndex],
        assetInfo.scale
      );
      seizedValues[partialSeizureIndex] = mulFactor(wantedCollateralValues[partialSeizureIndex], assetInfo.liquidationFactor);

      debtAfterPartialSeizure = debtRemainingValue - seizedValues[partialSeizureIndex];
      totalCVAfterPartialSeizure =
        totalCollateralizedValue - mulFactor(wantedCollateralValues[partialSeizureIndex], assetInfo.borrowCollateralFactor);
    });

    it('after asset index 5 partial seizure, targetHF condition is met before touching asset indexes 6 through 23', () => {
      expect(mulFactor(debtAfterPartialSeizure, targetHealthFactor)).to.be.lessThan(totalCVAfterPartialSeizure);
    });

    it('calculates newBalance after seized assets reduce debt', () => {
      newBalance = -(debtAfterPartialSeizure * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      expect(-(await comet.borrowBalanceOf(alice.address))).to.be.equal(newBalance);
    });

    it('AbsorbCollateral is emitted for each fully seized asset', async () => {
      for (let i = 0; i < firstFullSeizureCount; i++) {
        await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
          absorber.address,
          alice.address,
          collateralAssets[i].address,
          seizeAmounts[i],
          wantedCollateralValues[i]
        );
      }
    });

    it('AbsorbCollateral is emitted for the partially seized asset', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        collateralAssets[partialSeizureIndex].address,
        seizeAmounts[partialSeizureIndex],
        wantedCollateralValues[partialSeizureIndex]
      );
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice balances for asset indexes 0 through 4 are zero after full seizure', async () => {
      for (let i = 0; i < firstFullSeizureCount; i++) {
        expect(await comet.collateralBalanceOf(alice.address, collateralAssets[i].address)).to.be.equal(0);
      }
    });

    it('alice balance for asset index 5 is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, collateralAssets[partialSeizureIndex].address)).to.be.equal(
        collateralAmounts[partialSeizureIndex] - seizeAmounts[partialSeizureIndex]
      );
    });

    it('alice balances for asset indexes 6 through 23 are unchanged', async () => {
      for (let i = partialSeizureIndex + 1; i < assetSymbols.length; i++) {
        expect(await comet.collateralBalanceOf(alice.address, collateralAssets[i].address)).to.be.equal(collateralAmounts[i]);
      }
    });

    it('alice still has remaining debt after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(0);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal((debtAfterPartialSeizure * baseScale / baseTokenPrice));
    });

    it('alice is no longer liquidatable after partial seizure restored targetHF', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.false;
    });

    it('alice assetsIn removes fully seized indexes and keeps remaining indexes 5 through 15', async () => {
      const expectedAssetsIn = ((1 << 16) - 1) - ((1 << firstFullSeizureCount) - 1);

      expect(assetsInBefore).to.be.equal((1 << 16) - 1);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved still includes asset indexes 16 through 23 after absorb', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is equal to newBalance', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(newBalance);
    });

    it('comet total supplied collateral for asset indexes 0 through 4 is zero', async () => {
      for (let i = 0; i < firstFullSeizureCount; i++) {
        const totalSupplyAsset = (await comet.totalsCollateral(collateralAssets[i].address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore[i].sub(seizeAmounts[i]));
        expect(totalSupplyAsset).to.be.equal(0);
      }
    });

    it('comet total supplied collateral for asset index 5 is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAssets[partialSeizureIndex].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(
        totalsCollateralBefore[partialSeizureIndex].sub(seizeAmounts[partialSeizureIndex])
      );
    });

    it('comet total supplied collateral for asset indexes 6 through 23 is unchanged', async () => {
      for (let i = partialSeizureIndex + 1; i < assetSymbols.length; i++) {
        expect((await comet.totalsCollateral(collateralAssets[i].address)).totalSupplyAsset).to.be.equal(totalsCollateralBefore[i]);
      }
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
      const newPrincipal = (await comet.userBasic(alice.address)).principal.toBigInt();
      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(newPrincipal - oldPrincipal));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet collateral reserves increase for asset indexes 0 through 5', async () => {
      for (let i = 0; i <= partialSeizureIndex; i++) {
        expect(await comet.getCollateralReserves(collateralAssets[i].address)).to.be.equal(
          collateralReservesBefore[i].add(seizeAmounts[i])
        );
      }
    });

    it('comet collateral reserves remain zero for asset indexes 6 through 23', async () => {
      for (let i = partialSeizureIndex + 1; i < assetSymbols.length; i++) {
        expect(await comet.getCollateralReserves(collateralAssets[i].address)).to.be.equal(0);
      }
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ERC20 collateral token balances do not change during absorb', async () => {
      for (let i = 0; i < assetSymbols.length; i++) {
        expect(await collateralAssets[i].balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalancesBefore[i]);
      }
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });
  });
});
