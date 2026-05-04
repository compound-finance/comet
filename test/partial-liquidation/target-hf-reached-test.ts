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
describe.only('partial liquidation: target health factor restoration', function() {
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

  context.only('2 collaterals: partial AAVE seizure restores targetHF, LDO untouched (assets index 15 and 16)', function () {
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

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates expected partial seizure amounts for AAVE', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const aavePrice = (await priceFeeds['AAVE'].latestRoundData())[1].toBigInt();
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();

      // debtRemainingValue = $66 in Chainlink 8-decimal price units = 6600000000.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // 1 AAVE * $80 / 1e18 = 8000000000.
      aaveValue = mulPrice(aaveAmount, aavePrice, aaveInfo.scale);

      // 10 LDO * $2 / 1e18 = 2000000000.
      ldoValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);

      // BCF-weighted: 0.60 * $80 + 0.55 * $20 = $59.
      totalCollateralizedValue =
        mulFactor(aaveValue, aaveInfo.borrowCollateralFactor) +
        mulFactor(ldoValue, ldoInfo.borrowCollateralFactor);

      // S = (1.05 * $66 - $59) * 1e18 / (1.05 * 0.85 - 0.60) ~= $35.21.
      aaveWantedCollateralValue =
        (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(aaveInfo.liquidationFactor, targetHealthFactor) - aaveInfo.borrowCollateralFactor.toBigInt());

      // seizeAmount = floor($35.21 * 1e18 / $80) ~= 0.44017 AAVE.
      aaveSeizeAmount = divPrice(aaveWantedCollateralValue, aavePrice, aaveInfo.scale);

      // seizedValue = $35.21 * 0.85 ~= $29.93.
      aaveSeizedValue = mulFactor(aaveWantedCollateralValue, aaveInfo.liquidationFactor);

      // After seizing AAVE, the remaining debt and BCF-weighted collateral satisfy targetHF.
      debtAfterAave = debtRemainingValue - aaveSeizedValue;
      totalCVAfterAave = totalCollateralizedValue - mulFactor(aaveWantedCollateralValue, aaveInfo.borrowCollateralFactor);
    });

    it('wantedCollateralValue is less than AAVE collateral value: partial seizure confirmed', () => {
      expect(aaveWantedCollateralValue).to.be.lessThan(aaveValue);
    });

    it('after AAVE partial seizure, targetHF condition is met: loop breaks before touching LDO', () => {
      expect(mulFactor(debtAfterAave, targetHealthFactor)).to.be.at.most(totalCVAfterAave);
    });

    it('calculates newBalance after partial debt reduction', () => {
      newBalance = -(debtAfterAave * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address)).toBigInt();
      expect(newBalance).to.be.greaterThan(oldBalance);
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
    });

    it('alice borrow balance is less than the original borrow amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.lessThan(borrowAmount);
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
});
