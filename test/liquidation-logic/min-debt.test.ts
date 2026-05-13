import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, default24Assets, divPrice, CollateralState, makeCollateralStates } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

describe('partial liquidation: min debt', function() {
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

  // Note: this test flow covers event AbsorbCollateral emission when
  // the collateral is partially seized when debt is below min debt.
  context('1 collateral: debt below min debt and collateral can partially cover it', function () {
    const collateralAmount = exp(0.13, 18); // 0.13 COMP, worth $13 before the price drop
    const borrowAmount = exp(10.2, 6); // $10.20, initially above baseBorrowMin
    const repayAmount = exp(0.7, 6); // leaves $9.50 debt, below baseBorrowMin
    const droppedCompPrice = exp(85.9, 8); // collateral value becomes $11.167

    const collateralKeys = ['COMP'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let collateralValue: bigint;
    let collateralValueLeft: bigint;
    let wantedCollateralValue: bigint;
    let seizedValue: bigint;
    let seizeAmount: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);
      await comet.connect(alice).supply(baseToken.address, repayAmount);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    it('sanity check: alice borrow balance is below baseBorrowMin after repay', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount - repayAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.lessThan(baseBorrowMin);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('min debt branch can close the debt by partially seizing COMP', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);
      collateralValue = mulPrice(collateralAmount, droppedCompPrice, assetInfo.scale);
      collateralValueLeft = mulFactor(collateralValue, assetInfo.liquidationFactor);

      // debtRemainingValue = 9.5e8, minDebtValue = 10e8, so absorb enters
      // _processDebtClosing. collateralValueLeft = 11.167e8 * 0.90 = 10.0503e8,
      // so COMP can close the debt with a partial seizure.
      expect(debtRemainingValue).to.be.lessThan(minDebtValue);
      expect(debtRemainingValue).to.be.lessThan(collateralValueLeft);

      wantedCollateralValue = debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt();
      seizeAmount = divPrice(wantedCollateralValue, droppedCompPrice, assetInfo.scale);
      seizedValue = debtRemainingValue;
      wantedCollateralValue = mulPrice(seizeAmount, droppedCompPrice, assetInfo.scale);
    });

    it('calculates newBalance as zero after debt is fully closed', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;

      expect(debtRemainingValueAfterSeize).to.be.equal(0n);
      newBalance = 0n;
    });

    it('alice borrow balance is zero after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(collateralAmount - seizeAmount);
    });

    it('alice assetsIn does not change because collateral remains', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(seizeAmount));
      expect(totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  // Note: this flow proves that the baseBorrowMin branch can be reached after
  // an earlier collateral is fully seized in the same absorb cycle.
  context('multi-collateral: first collateral fully seized, second collateral closes debt below min debt', function () {
    const compAmount = exp(0.1, 18); // 0.1 COMP, worth $10
    const wethAmount = exp(0.008, 18); // 0.008 WETH, worth $16 before the price drop
    const borrowAmount = exp(18.5, 6); // leaves $9.50 debt after COMP full seizure
    const droppedWethPrice = exp(1500, 8); // WETH value becomes $12

    const collateralKeys = ['COMP', 'WETH'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let compSeizeAmount: bigint;
    let compSeizedValue: bigint;
    let compWantedCollateralValue: bigint;
    let wethSeizeAmount: bigint;
    let wethSeizedValue: bigint;
    let wethWantedCollateralValue: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, compAmount);
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['WETH'].connect(alice).setRoundData(0, droppedWethPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates COMP full seizure values', async () => {
      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);

      // COMP value = 0.1 * $100 = $10. WETH value after drop = 0.008 * $1500 = $12.
      const compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale);
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      // The target HF formula wants more than $10 from COMP, so COMP is fully seized.
      const wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);

      compSeizeAmount = compAmount;
      compWantedCollateralValue = compCollateralValue;
      compSeizedValue = mulFactor(compWantedCollateralValue, compInfo.liquidationFactor);
    });

    it('calculates WETH partial seizure values through the min debt branch', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // COMP full seizure covers $9, leaving $9.50 debt, below the $10 baseBorrowMin.
      debtRemainingValue -= compSeizedValue;
      expect(debtRemainingValue).to.be.lessThan(minDebtValue);

      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const wethCollateralValueLeft = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);

      // WETH LF-weighted value is $10.80, so _processDebtClosing can close the debt partially.
      expect(debtRemainingValue).to.be.lessThan(wethCollateralValueLeft);

      wethWantedCollateralValue = debtRemainingValue * factorScale / wethInfo.liquidationFactor.toBigInt();
      wethSeizeAmount = divPrice(wethWantedCollateralValue, wethPrice, wethInfo.scale);
      wethSeizedValue = debtRemainingValue;
      wethWantedCollateralValue = mulPrice(wethSeizeAmount, wethPrice, wethInfo.scale);
    });

    it('calculates newBalance as zero after WETH closes the remaining debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - wethSeizedValue;

      expect(debtRemainingValueAfterSeize).to.be.equal(0n);
      newBalance = 0n;
    });

    it('alice borrow balance is zero after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 COMP token balance does not change during absorb', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance does not change during absorb', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(wethAmount - wethSeizeAmount);
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.greaterThan(0); // to prevent zero balance case
    });

    it('alice assetsIn keeps only WETH', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);

      expect((await comet.userBasic(alice.address)).assetsIn).to.not.be.equal(assetsInBefore);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(1 << wethInfo.offset);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied COMP is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(compSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['WETH'].totalsCollateralBefore.sub(wethSeizeAmount));
      expect(totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet COMP collateral reserves increase by all seized COMP', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore.add(compSeizeAmount));
    });

    it('comet WETH collateral reserves increase by seized WETH', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(collateralsState['WETH'].collateralReservesBefore.add(wethSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  // Note: this flow covers the minDebt guard inside the formula branch.
  // The formula's target-HF partial seizure would leave remaining debt below
  // baseBorrowMin, so the guard redirects to _processDebtClosing which
  // closes the debt in full with a slightly smaller collateral seizure.
  context('1 collateral: formula gives partial seizure but guard fires because S*LF leaves debt below minDebt, closes debt fully', function () {
    // COMP: BCF=0.8, LCF=0.85, LF=0.9; baseBorrowMin=$10; targetHF=1.1
    // At $85: collateralValue=$17, LCF*$17=$14.45<$15 → liquidatable
    // Formula S = (1.1*15 - 0.8*17) / (1.1*0.9 - 0.8) = 2.9/0.19 ≈ $15.26
    // formulaSeizedValue = 0.9*$15.26 = $13.74; guard: $15-$13.74=$1.26 ≤ $10 → fires
    // _processDebtClosing case 1: $15 < 0.9*$17=$15.30 → debt fully closed
    const collateralAmount = exp(0.2, 18); // $20
    const borrowAmount = exp(15, 6);       // $15, above baseBorrowMin of $10
    const droppedCompPrice = exp(85, 8);   // $85 → collateralValue = $17

    const collateralKeys = ['COMP'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let seizeAmount: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let collateralValue: bigint;
    let collateralValueLeft: bigint;
    let formulaWantedCollateralValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    it('remaining debt is larger than the minimum borrow', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);
      collateralValue = mulPrice(collateralAmount, droppedCompPrice, assetInfo.scale);
      collateralValueLeft = mulFactor(collateralValue, assetInfo.liquidationFactor);

      // debtRemainingValue=$15e8 > minDebtValue=$10e8
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
    });

    it('reaching target health only needs part of the collateral, not all of it', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);

      // Formula: S = (targetHF*D - BCF*C) / (targetHF*LF - BCF)
      // = (1.1*15e8 - 0.8*17e8) / (1.1*0.9 - 0.8) = 2.9e8 / 0.19 ≈ 15.26e8
      const totalBCFvalue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      formulaWantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalBCFvalue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());

      // formulaWantedCollateralValue ≈ $15.26e8 < collateralValue $17e8
      expect(formulaWantedCollateralValue).to.be.lessThan(collateralValue);
    });

    it('that partial path would leave debt at or under the minimum', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);

      // formulaSeizedValue = LF * formulaWantedCollateralValue = 0.9 * $15.26e8 ≈ $13.74e8
      const formulaSeizedValue = mulFactor(formulaWantedCollateralValue, assetInfo.liquidationFactor);

      // Guard: debtRemainingValue - formulaSeizedValue = $1.26e8 ≤ minDebtValue $10e8 → guard fires.
      expect(debtRemainingValue - formulaSeizedValue).to.be.lessThanOrEqual(minDebtValue);
    });

    it('at liquidation pricing, collateral can still cover the full debt', async () => {
      // debtRemainingValue $15e8 < collateralValueLeft $15.3e8 → debt fully closed.
      expect(debtRemainingValue).to.be.lessThan(collateralValueLeft);
    });

    it('full close: expected seize size and no borrow left', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);

      // seizeAmount = divPrice(debtRemaining * FACTOR_SCALE / LF, price, scale) ≈ 0.196 COMP
      const seize = debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt();
      seizeAmount = divPrice(seize, droppedCompPrice, assetInfo.scale);
    });

    it('debt remaining value is zero after full close and new balance becomes zero', async () => {
      newBalance = 0n;
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('alice borrow balance is zero after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice collateral balance is reduced by the seized amount with leftover remaining', async () => {
      const remainingCollateral = await comet.collateralBalanceOf(alice.address, tokens['COMP'].address);
      expect(remainingCollateral).to.be.equal(collateralAmount - seizeAmount);
      expect(remainingCollateral).to.be.greaterThan(0);
    });

    it('alice assetsIn does not change because collateral remains', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the seized amount but remains positive', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(seizeAmount));
      expect(totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  // Note: this flow proves the minDebt guard inside the formula branch survives a preceding
  // full seizure. COMP is fully seized (formula demands more than available), leaving
  // remaining debt of $11 — above baseBorrowMin — so Branch A does not fire on WETH.
  // WETH enters the formula path, the guard fires because S*LF leaves $2.33 dust,
  // and _processDebtClosing case 1 closes the debt fully. Alice retains leftover WETH.
  context('2 collaterals: first fully seized then second formula gives partial seizure but guard fires because S*LF leaves debt at or under minDebt, closes debt fully', function () {
    // COMP: BCF=0.8, LCF=0.85, LF=0.9; WETH: BCF=0.75, LCF=0.80, LF=0.9
    // BCF limit at initial $2000 WETH: 0.8*$10 + 0.75*$17.4 = $21.05 → $20 borrow fits
    // Drop WETH to $1500: wethValue=$13.05, LCF total=$8.5+$10.44=$18.94 < $20 → liquidatable
    // COMP formula S≈$22.17 > compValue $10 → seize all COMP; debtRemaining=$20-$9=$11
    // WETH formula S=(1.1*$11-0.75*$13.05)/0.24≈$9.64; seizedValue≈$8.67
    //   guard: $11-$8.67=$2.33 ≤ $10 → fires; case 1: $11<0.9*$13.05=$11.745 → closed
    const compAmount = exp(0.1, 18);       // $10
    const wethAmount = exp(0.0087, 18);    // 0.0087 WETH; dropped $1500 → $13.05
    const borrowAmount = exp(20, 6);       // $20, above baseBorrowMin of $10
    const droppedWethPrice = exp(1500, 8); // $1500 → wethValue = $13.05

    const collateralKeys = ['COMP', 'WETH'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let formulaWantedWethValue: bigint;
    let wethCollateralValueLeft: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, compAmount);
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['WETH'].connect(alice).setRoundData(0, droppedWethPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates COMP full seizure values', async () => {
      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);

      // compValue=$10e8, wethValue=$13.05e8
      const compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale);
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      // The target HF formula demands more than $10 from COMP → COMP fully seized.
      const wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);

      collateralsState['COMP'].seizeAmount = compAmount;
      collateralsState['COMP'].seizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
    });

    it('after COMP is fully seized, remaining debt is still above the minimum borrow', async () => {
      // After COMP full seizure: debtRemaining = $11e8, still above minDebt $10e8.
      debtRemainingValue -= collateralsState['COMP'].seizedValue;
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
    });

    it('reaching target health only needs part of the WETH, not all of it', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // wethValue = $13.05e8
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      wethCollateralValueLeft = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);
      const totalBCFvalue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      // Formula: S = (1.1*$11 - 0.75*$13.05) / (1.1*0.9 - 0.75) = $2.3125/0.24 ≈ $9.64e8
      formulaWantedWethValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalBCFvalue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());

      // formulaWantedWethValue ≈ $9.64e8 < wethCollateralValue $13.05e8 → partial WETH, not full.
      expect(formulaWantedWethValue).to.be.lessThan(wethCollateralValue);
    });

    it('wanted weth collateral value is less than borrow minimum value', async () => {
      expect(formulaWantedWethValue).to.be.lessThan(minDebtValue);
    });

    it('that partial WETH path would leave debt at or under the minimum', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);

      // formulaSeizedValue = 0.9 * $9.64e8 ≈ $8.67e8
      const formulaSeizedValue = mulFactor(formulaWantedWethValue, wethInfo.liquidationFactor);

      // Guard: $11e8 - $8.67e8 = $2.33e8 ≤ minDebt $10e8 → redirect to full close path.
      expect(debtRemainingValue - formulaSeizedValue).to.be.lessThanOrEqual(minDebtValue);
    });

    it('at liquidation pricing, WETH can still cover the full remaining debt', async () => {
      // $11e8 < LF*wethValue $11.745e8 → debt can be fully closed from WETH.
      expect(debtRemainingValue).to.be.lessThan(wethCollateralValueLeft);
    });

    it('full close: expected WETH seize size and no borrow left', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // seizeAmount = divPrice(debtRemaining * FACTOR_SCALE / LF, price, scale) ≈ 0.00815 WETH
      const seize = debtRemainingValue * factorScale / wethInfo.liquidationFactor.toBigInt();
      collateralsState['WETH'].seizeAmount = divPrice(seize, wethPrice, wethInfo.scale);
    });

    it('debt remaining value is zero after full close and new balance becomes zero', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 COMP token balance does not change during absorb', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance does not change during absorb', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice COMP collateral balance is zero after full seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is reduced by the seized amount with leftover remaining', async () => {
      const remainingWeth = await comet.collateralBalanceOf(alice.address, tokens['WETH'].address);
      expect(remainingWeth).to.be.equal(wethAmount - collateralsState['WETH'].seizeAmount);
      expect(remainingWeth).to.be.greaterThan(0);
    });

    it('alice assetsIn no longer contains COMP after full seizure', async () => {
      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      expect((await comet.userBasic(alice.address)).assetsIn & (1 << compInfo.offset)).to.be.equal(0);
    });

    it('alice assetsIn still contains WETH because collateral remains', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      expect((await comet.userBasic(alice.address)).assetsIn & (1 << wethInfo.offset)).to.not.be.equal(0);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied COMP is zero after full seizure', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH is reduced by the seized amount but remains positive', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['WETH'].totalsCollateralBefore.sub(collateralsState['WETH'].seizeAmount));
      expect(totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet COMP collateral reserves increase by all seized COMP', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount));
    });

    it('comet WETH collateral reserves increase by the seized WETH amount', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  // Note: On COMP the target-health partial slice would leave debt under baseBorrowMin,
  // so the min-borrow guard widens to full seizure—but that still does not repay everything.
  // On WETH the guard path applies again to the small debt; liquidation pricing still lets
  // WETH cover what remains, so absorb wipes borrow and the account is no longer a borrower.
  context('2 collaterals: first hits min-borrow guard, partial paydown would leave debt under minimum so full seizure; second hits guard but can cover the rest and becomes non-borrower', function () {
    // COMP at index 0, WETH at index 1.
    // COMP value = $20; WETH drops from $16 to $8.
    // Borrow $23.45 is:
    //   - collateralized before drop (BCF: 0.8*$20 + 0.75*$16 = $28)
    //   - liquidatable after drop (LCF: 0.85*$20 + 0.8*$8 = $23.4 < $23.45)
    const compAmount = exp(0.2, 18);       // $20 at $100
    const wethAmount = exp(0.008, 18);     // $16 at $2000, $8 at $1000
    const borrowAmount = exp(23.45, 6);    // above baseBorrowMin ($10)
    const droppedWethPrice = exp(1000, 8); // WETH drops to $1000

    const collateralKeys = ['COMP', 'WETH'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;
    let compCollateralValue: bigint;
    let compCollateralValueLeft: bigint;
    let formulaWantedCompValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, compAmount);
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['WETH'].connect(alice).setRoundData(0, droppedWethPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    it('alice borrow balance is equal to borrowed amount and above baseBorrowMin', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(baseBorrowMin);
    });

    it('reaching target health only needs part of the COMP, not the full position', async () => {
      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);

      compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale); // $20e8
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale); // $8e8 after drop
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      formulaWantedCompValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      compCollateralValueLeft = mulFactor(compCollateralValue, compInfo.liquidationFactor);

      expect(formulaWantedCompValue).to.be.lessThan(compCollateralValue);
    });

    it('that partial COMP path would leave debt at or under the minimum', async () => {
      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const formulaSeizedCompValue = mulFactor(formulaWantedCompValue, compInfo.liquidationFactor);

      expect(debtRemainingValue - formulaSeizedCompValue).to.be.lessThanOrEqual(minDebtValue);
    });

    it('total debt is still at least the liquidation value of the entire COMP position', async () => {
      // So liquidation takes all COMP (full seizure), not a smaller partial slice.
      expect(debtRemainingValue).to.be.greaterThanOrEqual(compCollateralValueLeft);
    });

    it('expected full COMP seizure: entire balance at full mark, repay up to liquidation value', async () => {
      collateralsState['COMP'].seizeAmount = compAmount;
      collateralsState['COMP'].seizedValue = compCollateralValueLeft;
    });

    it('after full COMP seizure, remaining debt is below minimum borrow but positive', async () => {
      debtRemainingValue -= collateralsState['COMP'].seizedValue;

      expect(debtRemainingValue).to.be.lessThan(minDebtValue);
      expect(debtRemainingValue).to.be.greaterThan(0);
    });

    it('at liquidation pricing, WETH still covers the remaining debt', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const wethCollateralValueLeft = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);

      expect(debtRemainingValue).to.be.lessThan(wethCollateralValueLeft);
    });

    it('expected WETH seize amount and collateral value for closing the remainder', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // Mirrors closing the small debt with partial WETH (wanted value → wei → rounded token amount → repriced).
      const grossWethValue = debtRemainingValue * factorScale / wethInfo.liquidationFactor.toBigInt();
      collateralsState['WETH'].seizeAmount = divPrice(grossWethValue, wethPrice, wethInfo.scale);
      collateralsState['WETH'].seizedValue = debtRemainingValue;
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('newBalance is zero after WETH closes the remaining debt', () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['WETH'].seizedValue;
      expect(debtRemainingValueAfterSeize).to.be.equal(0n);
      newBalance = 0n;
    });

    it('alice borrow balance and principal are zero after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('AbsorbCollateral events are emitted for COMP full seizure and WETH minDebt close', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        tokens['COMP'].address,
        collateralsState['COMP'].seizeAmount,
        compCollateralValue
      );
    });

    it('AbsorbCollateral event is emitted for WETH minDebt close', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();
      const wethWantedCollateralValue = mulPrice(collateralsState['WETH'].seizeAmount, wethPrice, wethInfo.scale);

      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        tokens['WETH'].address,
        collateralsState['WETH'].seizeAmount,
        wethWantedCollateralValue
      );
    });

    it('comet ERC20 COMP balance on Comet is unchanged during absorb', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH balance on Comet is unchanged during absorb', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('comet ERC20 base balance on Comet is unchanged during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice COMP collateral balance is zero after full seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice WETH collateral balance drops by the seized WETH amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(wethAmount - collateralsState['WETH'].seizeAmount);
    });

    it('alice still holds WETH collateral after partial seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.greaterThan(0);
    });

    it('alice assetsIn keeps only WETH and reserved bits do not change', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(1 << wethInfo.offset);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied COMP collateral is reduced by the seized COMP amount', async () => {
      const compTotalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;

      expect(compTotalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount));
    });

    it('comet total supplied COMP collateral is zero', async () => {
      expect((await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH collateral is reduced by the seized WETH amount', async () => {
      const wethTotalSupplyAsset = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;

      expect(wethTotalSupplyAsset).to.be.equal(collateralsState['WETH'].totalsCollateralBefore.sub(collateralsState['WETH'].seizeAmount));
    });

    it('comet total supplied WETH collateral is still positive', async () => {
      expect((await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is reduced by the base paid out on absorb', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet total borrow base is zero', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet COMP collateral reserves increase by the seized COMP amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount));
    });

    it('comet WETH collateral reserves increase by the seized WETH amount', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });
});
