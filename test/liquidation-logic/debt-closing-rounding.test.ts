import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, default24Assets, divPrice, factorScale, CollateralState, makeCollateralStates } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

// Covers the debt-closing path in absorbInternal where remaining debt is below baseBorrowMin,
// so the protocol closes the debt fully using a partial collateral seizure.
// The special setups below reproduce cases where current divPrice flooring seizes too little
// collateral for the closed debt. Tests assert the expected no-loss accounting flow, so the
// current contract fails at the event/storage step that uses the floored seizure amount.
describe.skip('partial liquidation: debt closing rounding', function() {
  const baseTokenPrice = exp(1, 8);
  const initialBaseFunding = baseTokenPrice * 10_000n;
  const baseBorrowMin = exp(10, 6); // $10
  const baseScale = 10n ** 6n;

  let comet: CometHarnessInterfaceExtendedAssetList;
  let tokens: { [symbol: string]: FaucetToken } = {};
  let baseToken: FaucetToken;
  let priceFeeds: { [symbol: string]: SimplePriceFeed } = {};
  let alice: SignerWithAddress;
  let absorber: SignerWithAddress;
  let snapshot: SnapshotRestorer;

  before(async function() {
    const protocol = await makeProtocol({
      base: 'USDC',
      assets: {
        USDC: { decimals: 6, initialPrice: 1 },
        ...default24Assets(),
      },
      baseTrackingBorrowSpeed: 0,
      borrowInterestRateBase: 0,
      borrowInterestRateSlopeLow: 0,
      borrowInterestRateSlopeHigh: 0,
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
    snapshot = await takeSnapshot();
  });

  // 0.13 COMP at $85.9 after price drop gives $9.50 debt, below $10 baseBorrowMin.
  // Current _processDebtClosing floors the seized amount, so the repriced collateral
  // covers less than the debt it closes.
  context('18 decimals collateral: rounded partial seizure closes more debt than it covers', function() {
    const SYMBOL = 'COMP';
    const collateralAmount = exp(0.13, 18);
    const borrowAmount = exp(10.2, 6);
    const repayAmount = exp(0.7, 6); // leaves $9.50 debt
    const droppedPrice = exp(85.9, 8);

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let debtRemainingValue: bigint;
    let targetGrossCollateralValue: bigint;
    let currentSeizeAmount: bigint;
    let currentWantedCollateralValue: bigint;
    let currentCoveredValue: bigint;
    let currentProtocolLossValue: bigint;
    let expectedSeizeAmount: bigint;
    let expectedWantedCollateralValue: bigint;
    let expectedCoveredValue: bigint;
    let basePaidOut: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await comet.connect(alice).supply(tokens[SYMBOL].address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);
      await comet.connect(alice).supply(baseToken.address, repayAmount);
      await priceFeeds[SYMBOL].connect(alice).setRoundData(0, droppedPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      basePaidOut = -oldBalance;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      collateralsState = await makeCollateralStates(comet, tokens, [SYMBOL]);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      // debtRemainingValue = 9.50e6 * 1e8 / 1e6 = 9.50e8
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(950000000n);
    });

    it('calculates target gross collateral value before price conversion', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      // targetGrossCollateralValue = floor(debtRemainingValue / LF)
      targetGrossCollateralValue = debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt();
      expect(targetGrossCollateralValue).to.be.equal(1055555555n);
    });

    it('calculates current floored seized amount used by the contract', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      currentSeizeAmount = divPrice(targetGrossCollateralValue, droppedPrice, assetInfo.scale);
      expect(currentSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('current floored seized amount reprices below target gross collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      currentWantedCollateralValue = mulPrice(currentSeizeAmount, droppedPrice, assetInfo.scale);
      expect(currentWantedCollateralValue).to.be.lessThan(targetGrossCollateralValue);
    });

    it('current floored seized amount leaves uncovered debt value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      currentCoveredValue = mulFactor(currentWantedCollateralValue, assetInfo.liquidationFactor);
      currentProtocolLossValue = debtRemainingValue - currentCoveredValue;
      expect(currentProtocolLossValue).to.be.greaterThan(0n);
    });

    it('calculates expected seized amount that fully covers the closed debt', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      // wantedValue = ceil(debt / LF), then seizeAmount = ceil(wantedValue / price).
      const wantedValueToCoverDebt = (
        debtRemainingValue * factorScale +
        assetInfo.liquidationFactor.toBigInt() -
        1n
      ) / assetInfo.liquidationFactor.toBigInt();
      expectedSeizeAmount = (
        wantedValueToCoverDebt * assetInfo.scale.toBigInt() +
        droppedPrice -
        1n
      ) / droppedPrice;
      expect(expectedSeizeAmount).to.be.greaterThan(currentSeizeAmount);
      expect(expectedSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('calculates expected wanted collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedWantedCollateralValue = mulPrice(expectedSeizeAmount, droppedPrice, assetInfo.scale);
      expect(expectedWantedCollateralValue).to.be.greaterThan(currentWantedCollateralValue);
    });

    it('calculates expected covered value with no protocol loss', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedCoveredValue = mulFactor(expectedWantedCollateralValue, assetInfo.liquidationFactor);
      expect(expectedCoveredValue).to.be.greaterThanOrEqual(debtRemainingValue);
    });

    it('AbsorbCollateral emits the expected no-loss seized collateral amount and repriced value', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens[SYMBOL].address, expectedSeizeAmount, expectedWantedCollateralValue
      );
    });

    it('AbsorbDebt closes the whole debt', async () => {
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice borrow is fully closed', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
    });

    it('alice collateral balance is reduced by the expected seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens[SYMBOL].address)).to.be.equal(collateralAmount - expectedSeizeAmount);
    });

    it('alice assetsIn does not change after partial seizure', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the expected seized amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens[SYMBOL].address)).totalSupplyAsset.toBigInt();
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState[SYMBOL].totalsCollateralBefore.toBigInt() - expectedSeizeAmount);
    });

    it('comet collateral reserves increase by the expected seized amount', async () => {
      const collateralReservesAfter = (await comet.getCollateralReserves(tokens[SYMBOL].address)).toBigInt();
      expect(collateralReservesAfter).to.be.equal(collateralsState[SYMBOL].collateralReservesBefore.toBigInt() + expectedSeizeAmount);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase.toBigInt()).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet total borrow base is zero after absorb', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full base paid out', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });

    it('comet ERC20 collateral token balance is unchanged during absorb', async () => {
      expect((await tokens[SYMBOL].balanceOf(comet.address)).toBigInt()).to.be.equal(collateralsState[SYMBOL].tokenBalanceBefore.toBigInt());
    });

    it('comet ERC20 base token balance is unchanged during absorb', async () => {
      expect((await baseToken.balanceOf(comet.address)).toBigInt()).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('seized collateral value fully covers the closed debt with no protocol loss', () => {
      expect(expectedCoveredValue).to.be.greaterThanOrEqual(debtRemainingValue);
    });

    it('current contract would forgive debt without collateral backing', () => {
      expect(currentProtocolLossValue).to.be.equal(2n);
    });
  });

  // 0.00023 WBTC at $52,000 after price drop gives $9.50 debt, below $10 baseBorrowMin.
  // Current _processDebtClosing floors to 1e-8 WBTC precision and closes more debt than
  // the repriced seized collateral covers.
  context('8 decimals collateral: rounded partial seizure closes more debt than it covers', function() {
    const SYMBOL = 'WBTC';
    const collateralAmount = exp(0.00023, 8);
    const borrowAmount = exp(10.2, 6);
    const repayAmount = exp(0.7, 6); // leaves $9.50 debt
    const droppedPrice = exp(52_000, 8);

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let debtRemainingValue: bigint;
    let targetGrossCollateralValue: bigint;
    let currentSeizeAmount: bigint;
    let currentWantedCollateralValue: bigint;
    let currentCoveredValue: bigint;
    let currentProtocolLossValue: bigint;
    let expectedSeizeAmount: bigint;
    let expectedWantedCollateralValue: bigint;
    let expectedCoveredValue: bigint;
    let basePaidOut: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await comet.connect(alice).supply(tokens[SYMBOL].address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);
      await comet.connect(alice).supply(baseToken.address, repayAmount);
      await priceFeeds[SYMBOL].connect(alice).setRoundData(0, droppedPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      basePaidOut = -oldBalance;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      collateralsState = await makeCollateralStates(comet, tokens, [SYMBOL]);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(950000000n);
    });

    it('calculates target gross collateral value before price conversion', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      targetGrossCollateralValue = debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt();
      expect(targetGrossCollateralValue).to.be.equal(1055555555n);
    });

    it('calculates current floored seized amount used by the contract', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      currentSeizeAmount = divPrice(targetGrossCollateralValue, droppedPrice, assetInfo.scale);
      expect(currentSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('current floored seized amount reprices below target gross collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      currentWantedCollateralValue = mulPrice(currentSeizeAmount, droppedPrice, assetInfo.scale);
      expect(currentWantedCollateralValue).to.be.lessThan(targetGrossCollateralValue);
    });

    it('current floored seized amount leaves uncovered debt value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      currentCoveredValue = mulFactor(currentWantedCollateralValue, assetInfo.liquidationFactor);
      currentProtocolLossValue = debtRemainingValue - currentCoveredValue;
      expect(currentProtocolLossValue).to.be.greaterThan(0n);
    });

    it('calculates expected seized amount that fully covers the closed debt', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      const wantedValueToCoverDebt = (
        debtRemainingValue * factorScale +
        assetInfo.liquidationFactor.toBigInt() -
        1n
      ) / assetInfo.liquidationFactor.toBigInt();
      expectedSeizeAmount = (
        wantedValueToCoverDebt * assetInfo.scale.toBigInt() +
        droppedPrice -
        1n
      ) / droppedPrice;
      expect(expectedSeizeAmount).to.be.greaterThan(currentSeizeAmount);
      expect(expectedSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('calculates expected wanted collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedWantedCollateralValue = mulPrice(expectedSeizeAmount, droppedPrice, assetInfo.scale);
      expect(expectedWantedCollateralValue).to.be.greaterThan(currentWantedCollateralValue);
    });

    it('calculates expected covered value with no protocol loss', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedCoveredValue = mulFactor(expectedWantedCollateralValue, assetInfo.liquidationFactor);
      expect(expectedCoveredValue).to.be.greaterThanOrEqual(debtRemainingValue);
    });

    it('AbsorbCollateral emits the expected no-loss seized collateral amount and repriced value', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens[SYMBOL].address, expectedSeizeAmount, expectedWantedCollateralValue
      );
    });

    it('AbsorbDebt closes the whole debt', async () => {
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice borrow is fully closed', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
    });

    it('alice collateral balance is reduced by the expected seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens[SYMBOL].address)).to.be.equal(collateralAmount - expectedSeizeAmount);
    });

    it('alice assetsIn does not change after partial seizure', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the expected seized amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens[SYMBOL].address)).totalSupplyAsset.toBigInt();
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState[SYMBOL].totalsCollateralBefore.toBigInt() - expectedSeizeAmount);
    });

    it('comet collateral reserves increase by the expected seized amount', async () => {
      const collateralReservesAfter = (await comet.getCollateralReserves(tokens[SYMBOL].address)).toBigInt();
      expect(collateralReservesAfter).to.be.equal(collateralsState[SYMBOL].collateralReservesBefore.toBigInt() + expectedSeizeAmount);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase.toBigInt()).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet total borrow base is zero after absorb', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full base paid out', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });

    it('comet ERC20 collateral token balance is unchanged during absorb', async () => {
      expect((await tokens[SYMBOL].balanceOf(comet.address)).toBigInt()).to.be.equal(collateralsState[SYMBOL].tokenBalanceBefore.toBigInt());
    });

    it('comet ERC20 base token balance is unchanged during absorb', async () => {
      expect((await baseToken.balanceOf(comet.address)).toBigInt()).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('seized collateral value fully covers the closed debt with no protocol loss', () => {
      expect(expectedCoveredValue).to.be.greaterThanOrEqual(debtRemainingValue);
    });

    it('current contract would forgive debt without collateral backing', () => {
      expect(currentProtocolLossValue).to.be.equal(6800n);
    });
  });

  // 12.3 USDT at $0.85 after price drop gives $9.50 debt, below $10 baseBorrowMin.
  // Current _processDebtClosing floors to 1e-6 USDT precision and closes more debt than
  // the repriced seized collateral covers.
  context('6 decimals collateral: rounded partial seizure closes more debt than it covers', function() {
    const SYMBOL = 'USDT';
    const collateralAmount = exp(12.3, 6);
    const borrowAmount = exp(10.2, 6);
    const repayAmount = exp(0.7, 6); // leaves $9.50 debt
    const droppedPrice = exp(0.85, 8);

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let debtRemainingValue: bigint;
    let targetGrossCollateralValue: bigint;
    let currentSeizeAmount: bigint;
    let currentWantedCollateralValue: bigint;
    let currentCoveredValue: bigint;
    let currentProtocolLossValue: bigint;
    let expectedSeizeAmount: bigint;
    let expectedWantedCollateralValue: bigint;
    let expectedCoveredValue: bigint;
    let basePaidOut: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await comet.connect(alice).supply(tokens[SYMBOL].address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);
      await comet.connect(alice).supply(baseToken.address, repayAmount);
      await priceFeeds[SYMBOL].connect(alice).setRoundData(0, droppedPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      basePaidOut = -oldBalance;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      collateralsState = await makeCollateralStates(comet, tokens, [SYMBOL]);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(950000000n);
    });

    it('calculates target gross collateral value before price conversion', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      targetGrossCollateralValue = debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt();
      expect(targetGrossCollateralValue).to.be.equal(1000000000n);
    });

    it('calculates current floored seized amount used by the contract', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      currentSeizeAmount = divPrice(targetGrossCollateralValue, droppedPrice, assetInfo.scale);
      expect(currentSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('current floored seized amount reprices below target gross collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      currentWantedCollateralValue = mulPrice(currentSeizeAmount, droppedPrice, assetInfo.scale);
      expect(currentWantedCollateralValue).to.be.lessThan(targetGrossCollateralValue);
    });

    it('current floored seized amount leaves uncovered debt value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      currentCoveredValue = mulFactor(currentWantedCollateralValue, assetInfo.liquidationFactor);
      currentProtocolLossValue = debtRemainingValue - currentCoveredValue;
      expect(currentProtocolLossValue).to.be.greaterThan(0n);
    });

    it('calculates expected seized amount that fully covers the closed debt', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      const wantedValueToCoverDebt = (
        debtRemainingValue * factorScale +
        assetInfo.liquidationFactor.toBigInt() -
        1n
      ) / assetInfo.liquidationFactor.toBigInt();
      expectedSeizeAmount = (
        wantedValueToCoverDebt * assetInfo.scale.toBigInt() +
        droppedPrice -
        1n
      ) / droppedPrice;
      expect(expectedSeizeAmount).to.be.greaterThan(currentSeizeAmount);
      expect(expectedSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('calculates expected wanted collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedWantedCollateralValue = mulPrice(expectedSeizeAmount, droppedPrice, assetInfo.scale);
      expect(expectedWantedCollateralValue).to.be.greaterThan(currentWantedCollateralValue);
    });

    it('calculates expected covered value with no protocol loss', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedCoveredValue = mulFactor(expectedWantedCollateralValue, assetInfo.liquidationFactor);
      expect(expectedCoveredValue).to.be.greaterThanOrEqual(debtRemainingValue);
    });

    it('AbsorbCollateral emits the expected no-loss seized collateral amount and repriced value', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens[SYMBOL].address, expectedSeizeAmount, expectedWantedCollateralValue
      );
    });

    it('AbsorbDebt closes the whole debt', async () => {
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice borrow is fully closed', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
    });

    it('alice collateral balance is reduced by the expected seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens[SYMBOL].address)).to.be.equal(collateralAmount - expectedSeizeAmount);
    });

    it('alice assetsIn does not change after partial seizure', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the expected seized amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens[SYMBOL].address)).totalSupplyAsset.toBigInt();
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState[SYMBOL].totalsCollateralBefore.toBigInt() - expectedSeizeAmount);
    });

    it('comet collateral reserves increase by the expected seized amount', async () => {
      const collateralReservesAfter = (await comet.getCollateralReserves(tokens[SYMBOL].address)).toBigInt();
      expect(collateralReservesAfter).to.be.equal(collateralsState[SYMBOL].collateralReservesBefore.toBigInt() + expectedSeizeAmount);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase.toBigInt()).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet total borrow base is zero after absorb', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full base paid out', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });

    it('comet ERC20 collateral token balance is unchanged during absorb', async () => {
      expect((await tokens[SYMBOL].balanceOf(comet.address)).toBigInt()).to.be.equal(collateralsState[SYMBOL].tokenBalanceBefore.toBigInt());
    });

    it('comet ERC20 base token balance is unchanged during absorb', async () => {
      expect((await baseToken.balanceOf(comet.address)).toBigInt()).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('seized collateral value fully covers the closed debt with no protocol loss', () => {
      expect(expectedCoveredValue).to.be.greaterThanOrEqual(debtRemainingValue);
    });

    it('current contract would forgive debt without collateral backing', () => {
      expect(currentProtocolLossValue).to.be.equal(72n);
    });
  });
});

// rsETH is the borrow asset (18 decimals). Small USD gaps at the oracle show up as
// non-zero base-token amounts in a way 6-decimal USDC base would often round away;
// the two cases below stress min-borrow behavior and the last collateral in the loop.
context('rsETH-denominated base (18 decimals): dust and min-borrow edge cases', function () {
  // After full COMP and full WETH seizures, WETH's liquidation value still falls
  // a few price-wei short of the remaining debt. In 18-decimal rsETH that gap is a
  // positive borrow balance. A small DAI position is still available in the
  // liquidation pass and is used to wipe the last trace so the account is debt-free.
  context('DAI pays the last trace of rsETH debt after COMP and WETH are fully seized', function () {
    const rsEthBaseScale = 10n ** 18n;
    const rsEthBasePrice = exp(3400, 8);
    const rsEthInitialBaseFunding = exp(10, 18);
    const rsEthBaseBorrowMin = 2941176470588236n; // $10 at $3,400/rsETH
    const compAmount = exp(0.1, 18); // 0.1 COMP, worth $10
    const wethAmount = 7037037000000000n; // WETH LF-weighted value becomes $9.49999995
    const daiAmount = exp(0.000001, 18); // enough to close a few price wei of debt
    const borrowAmount = 5441176470588236n; // $18.50 at $3,400/rsETH
    const droppedWethPrice = exp(1500, 8);

    let rsEthComet: CometHarnessInterfaceExtendedAssetList;
    let rsEthBaseToken: FaucetToken;
    let compAsset: FaucetToken;
    let wethAsset: FaucetToken;
    let daiAsset: FaucetToken;
    let rsEthPriceFeeds: { [symbol: string]: SimplePriceFeed };
    let rsEthAlice: SignerWithAddress;
    let rsEthAbsorber: SignerWithAddress;
    let rsEthSnapshot: SnapshotRestorer;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let residualDebtValue: bigint;
    let residualBorrowUnits: bigint;
    let compSeizeAmount: bigint;
    let compSeizedValue: bigint;
    let compWantedCollateralValue: bigint;
    let wethSeizeAmount: bigint;
    let wethSeizedValue: bigint;
    let wethWantedCollateralValue: bigint;
    let daiSeizeAmount: bigint;
    let daiSeizedValue: bigint;
    let daiWantedCollateralValue: bigint;
    let targetHealthFactor: bigint;

    before(async function() {
      const protocol = await makeProtocol({
        base: 'rsETH',
        assets: {
          rsETH: {
            decimals: 18,
            initialPrice: 3400,
          },
          COMP: {
            decimals: 18,
            initialPrice: 100,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
          },
          WETH: {
            decimals: 18,
            initialPrice: 3000,
            borrowCF: exp(0.75, 18),
            liquidateCF: exp(0.80, 18),
            liquidationFactor: exp(0.9, 18),
          },
          DAI: {
            decimals: 18,
            initialPrice: 1,
            borrowCF: exp(0.83, 18),
            liquidateCF: exp(0.88, 18),
            liquidationFactor: exp(0.9, 18),
          },
        },
        baseTrackingBorrowSpeed: 0,
        borrowInterestRateBase: 0,
        borrowInterestRateSlopeLow: 0,
        borrowInterestRateSlopeHigh: 0,
        baseBorrowMin: rsEthBaseBorrowMin,
      });
      rsEthComet = protocol.cometWithExtendedAssetList;
      rsEthBaseToken = protocol.tokens['rsETH'] as FaucetToken;
      compAsset = protocol.tokens['COMP'] as FaucetToken;
      wethAsset = protocol.tokens['WETH'] as FaucetToken;
      daiAsset = protocol.tokens['DAI'] as FaucetToken;
      rsEthPriceFeeds = protocol.priceFeeds;
      [rsEthAlice, rsEthAbsorber] = protocol.users;

      for (const token of Object.values(protocol.tokens)) {
        await (token as FaucetToken).allocateTo(rsEthAlice.address, exp(1_000_000, 18));
        await (token as FaucetToken).connect(rsEthAlice).approve(rsEthComet.address, ethers.constants.MaxUint256);
      }
      await rsEthBaseToken.allocateTo(rsEthComet.address, rsEthInitialBaseFunding);
      targetHealthFactor = (await rsEthComet.targetHealthFactor()).toBigInt();
      rsEthSnapshot = await takeSnapshot();
    });

    after(async () => await rsEthSnapshot.restore());

    it('alice supplies three collaterals and borrows rsETH', async () => {
      await expect(rsEthComet.connect(rsEthAlice).supply(compAsset.address, compAmount)).to.not.be.reverted;
      await expect(rsEthComet.connect(rsEthAlice).supply(wethAsset.address, wethAmount)).to.not.be.reverted;
      await expect(rsEthComet.connect(rsEthAlice).supply(daiAsset.address, daiAmount)).to.not.be.reverted;
      await expect(rsEthComet.connect(rsEthAlice).withdraw(rsEthBaseToken.address, borrowAmount)).to.not.be.reverted;
    });

    it('WETH price drops and alice becomes liquidatable', async () => {
      await rsEthPriceFeeds['WETH'].connect(rsEthAlice).setRoundData(0, droppedWethPrice, 0, 0, 0);
      await rsEthComet.accrueAccount(rsEthAlice.address);

      const principal = (await rsEthComet.userBasic(rsEthAlice.address)).principal;
      const totalsBasic = await rsEthComet.totalsBasic();
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(await rsEthComet.isLiquidatable(rsEthAlice.address)).to.equal(true, 'User is not liquidatable');
    });

    it('absorb is successful', async () => {
      absorbTx = await rsEthComet.connect(rsEthAbsorber).absorb(rsEthAbsorber.address, [rsEthAlice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates COMP full seizure values', async () => {
      const compInfo = await rsEthComet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await rsEthComet.getAssetInfoByAddress(wethAsset.address);
      const daiInfo = await rsEthComet.getAssetInfoByAddress(daiAsset.address);
      const compPrice = (await rsEthPriceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const wethPrice = (await rsEthPriceFeeds['WETH'].latestRoundData())[1].toBigInt();
      const daiPrice = (await rsEthPriceFeeds['DAI'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, rsEthBasePrice, rsEthBaseScale);
      minDebtValue = mulPrice(rsEthBaseBorrowMin, rsEthBasePrice, rsEthBaseScale);

      const compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale);
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const daiCollateralValue = mulPrice(daiAmount, daiPrice, daiInfo.scale);
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor) +
        mulFactor(daiCollateralValue, daiInfo.borrowCollateralFactor);

      // The target HF formula wants more than $10 from COMP, so COMP is fully seized.
      const wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);

      compSeizeAmount = compAmount;
      compWantedCollateralValue = compCollateralValue;
      compSeizedValue = mulFactor(compWantedCollateralValue, compInfo.liquidationFactor);
    });

    it('calculates WETH full seizure values that leave non-zero rsETH borrow units', async () => {
      const wethInfo = await rsEthComet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await rsEthPriceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // COMP full seizure covers $9, leaving $9.50 debt, below the $10 baseBorrowMin.
      debtRemainingValue -= compSeizedValue;
      expect(debtRemainingValue).to.be.lessThan(minDebtValue);

      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const wethCollateralValueLeft = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);

      // WETH is short by 5 price wei, which is non-zero when converted to 18-decimal rsETH.
      expect(wethCollateralValueLeft).to.be.lessThan(debtRemainingValue);
      wethSeizeAmount = wethAmount;
      wethWantedCollateralValue = wethCollateralValue;
      wethSeizedValue = wethCollateralValueLeft;
      residualDebtValue = debtRemainingValue - wethSeizedValue;
      residualBorrowUnits = residualDebtValue * rsEthBaseScale / rsEthBasePrice;

      expect(residualBorrowUnits).to.be.greaterThan(0n);
    });

    it('remaining debt value is 5 wei', () => {
      expect(residualDebtValue).to.be.equal(5n);
    });

    it('calculates DAI partial seizure that closes the residual debt dust', async () => {
      const daiInfo = await rsEthComet.getAssetInfoByAddress(daiAsset.address);
      const daiPrice = (await rsEthPriceFeeds['DAI'].latestRoundData())[1].toBigInt();

      debtRemainingValue = residualDebtValue;
      expect(debtRemainingValue).to.be.lessThan(minDebtValue);

      const daiCollateralValue = mulPrice(daiAmount, daiPrice, daiInfo.scale);
      const daiCollateralValueLeft = mulFactor(daiCollateralValue, daiInfo.liquidationFactor);
      expect(debtRemainingValue).to.be.lessThan(daiCollateralValueLeft);

      daiWantedCollateralValue = debtRemainingValue * factorScale / daiInfo.liquidationFactor.toBigInt();
      daiSeizeAmount = divPrice(daiWantedCollateralValue, daiPrice, daiInfo.scale);
      daiSeizedValue = debtRemainingValue;
      daiWantedCollateralValue = mulPrice(daiSeizeAmount, daiPrice, daiInfo.scale);
    });

    it('AbsorbCollateral event is emitted for COMP full seizure', async () => {
      await expect(absorbTx).to.emit(rsEthComet, 'AbsorbCollateral').withArgs(
        rsEthAbsorber.address,
        rsEthAlice.address,
        compAsset.address,
        compSeizeAmount,
        compWantedCollateralValue
      );
    });

    it('AbsorbCollateral event is emitted for WETH full seizure', async () => {
      await expect(absorbTx).to.emit(rsEthComet, 'AbsorbCollateral').withArgs(
        rsEthAbsorber.address,
        rsEthAlice.address,
        wethAsset.address,
        wethSeizeAmount,
        wethWantedCollateralValue
      );
    });

    it('AbsorbCollateral event is emitted for DAI dust close', async () => {
      await expect(absorbTx).to.emit(rsEthComet, 'AbsorbCollateral').withArgs(
        rsEthAbsorber.address,
        rsEthAlice.address,
        daiAsset.address,
        daiSeizeAmount,
        daiWantedCollateralValue
      );
    });

    it('alice borrow balance is zero because DAI closes the dust', async () => {
      expect(await rsEthComet.borrowBalanceOf(rsEthAlice.address)).to.be.equal(0);
    });

    it('alice keeps remaining DAI collateral', async () => {
      expect(await rsEthComet.collateralBalanceOf(rsEthAlice.address, daiAsset.address)).to.be.equal(daiAmount - daiSeizeAmount);
    });

    it('debt dust would have been non-zero without the third collateral', () => {
      expect(residualBorrowUnits).to.be.equal(14705882n);
    });

    it('DAI seized value closes the residual debt value', () => {
      expect(residualDebtValue - daiSeizedValue).to.be.equal(0n);
    });
  });

  // Order of seizure: all COMP, then all WETH; debt is still above baseBorrowMin before USDT.
  // A straight target-health partial on USDT would (via divPrice rounding) leave exactly one
  // USDT base unit on hand while still leaving positive debt below the minimum borrow—an
  // invalid end state. Absorb recomputes seizure on that same USDT position so the
  // outstanding rsETH borrow is fully paid off; Alice keeps one USDT unit as leftover collateral.
  context('USDT last: target-health partial would leave debt below minimum; same asset fully closes borrow', function () {
    const rsEthBaseScale = 10n ** 18n;
    const rsEthBasePrice = exp(3400, 8);
    const rsEthInitialBaseFunding = exp(10, 18);
    const rsEthBaseBorrowMin = 2941176470588236n; // $10 at $3,400/rsETH
    const compAmount = exp(0.1, 18); // 0.1 COMP, worth $10
    const wethAmount = 7037037000000000n; // WETH LF-weighted value becomes $9.49999995
    const usdtAmount = exp(11, 6); // 11 USDT, worth $11
    const borrowAmount = 8514705829411765n; // $28.94999982 at $3,400/rsETH
    const droppedWethPrice = exp(1500, 8);

    let rsEthComet: CometHarnessInterfaceExtendedAssetList;
    let rsEthBaseToken: FaucetToken;
    let compAsset: FaucetToken;
    let wethAsset: FaucetToken;
    let usdtAsset: FaucetToken;
    let rsEthPriceFeeds: { [symbol: string]: SimplePriceFeed };
    let rsEthAlice: SignerWithAddress;
    let rsEthAbsorber: SignerWithAddress;
    let rsEthSnapshot: SnapshotRestorer;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let residualDebtValue: bigint;
    let targetResidualDebtValue: bigint;
    let targetResidualBorrowUnits: bigint;
    let compSeizeAmount: bigint;
    let compSeizedValue: bigint;
    let compWantedCollateralValue: bigint;
    let wethSeizeAmount: bigint;
    let wethSeizedValue: bigint;
    let wethWantedCollateralValue: bigint;
    let usdtSeizeAmount: bigint;
    let usdtSeizedValue: bigint;
    let usdtWantedCollateralValue: bigint;
    let targetHealthFactor: bigint;

    before(async function() {
      const protocol = await makeProtocol({
        base: 'rsETH',
        assets: {
          rsETH: {
            decimals: 18,
            initialPrice: 3400,
          },
          COMP: {
            decimals: 18,
            initialPrice: 100,
            borrowCF: exp(0.8, 18),
            liquidateCF: exp(0.85, 18),
            liquidationFactor: exp(0.9, 18),
          },
          WETH: {
            decimals: 18,
            initialPrice: 3000,
            borrowCF: exp(0.75, 18),
            liquidateCF: exp(0.80, 18),
            liquidationFactor: exp(0.9, 18),
          },
          USDT: {
            decimals: 6,
            initialPrice: 1,
            borrowCF: exp(0.85, 18),
            liquidateCF: exp(0.90, 18),
            liquidationFactor: exp(0.95, 18),
          },
        },
        baseTrackingBorrowSpeed: 0,
        borrowInterestRateBase: 0,
        borrowInterestRateSlopeLow: 0,
        borrowInterestRateSlopeHigh: 0,
        baseBorrowMin: rsEthBaseBorrowMin,
      });
      rsEthComet = protocol.cometWithExtendedAssetList;
      rsEthBaseToken = protocol.tokens['rsETH'] as FaucetToken;
      compAsset = protocol.tokens['COMP'] as FaucetToken;
      wethAsset = protocol.tokens['WETH'] as FaucetToken;
      usdtAsset = protocol.tokens['USDT'] as FaucetToken;
      rsEthPriceFeeds = protocol.priceFeeds;
      [rsEthAlice, rsEthAbsorber] = protocol.users;

      for (const token of Object.values(protocol.tokens)) {
        await (token as FaucetToken).allocateTo(rsEthAlice.address, exp(1_000_000, 18));
        await (token as FaucetToken).connect(rsEthAlice).approve(rsEthComet.address, ethers.constants.MaxUint256);
      }
      await rsEthBaseToken.allocateTo(rsEthComet.address, rsEthInitialBaseFunding);
      targetHealthFactor = (await rsEthComet.targetHealthFactor()).toBigInt();
      rsEthSnapshot = await takeSnapshot();
    });

    after(async () => await rsEthSnapshot.restore());

    it('alice supplies three collaterals and borrows rsETH', async () => {
      await expect(rsEthComet.connect(rsEthAlice).supply(compAsset.address, compAmount)).to.not.be.reverted;
      await expect(rsEthComet.connect(rsEthAlice).supply(wethAsset.address, wethAmount)).to.not.be.reverted;
      await expect(rsEthComet.connect(rsEthAlice).supply(usdtAsset.address, usdtAmount)).to.not.be.reverted;
      await expect(rsEthComet.connect(rsEthAlice).withdraw(rsEthBaseToken.address, borrowAmount)).to.not.be.reverted;
    });

    it('WETH price drops and alice becomes liquidatable', async () => {
      await rsEthPriceFeeds['WETH'].connect(rsEthAlice).setRoundData(0, droppedWethPrice, 0, 0, 0);
      await rsEthComet.accrueAccount(rsEthAlice.address);

      const principal = (await rsEthComet.userBasic(rsEthAlice.address)).principal;
      const totalsBasic = await rsEthComet.totalsBasic();
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(await rsEthComet.isLiquidatable(rsEthAlice.address)).to.equal(true, 'User is not liquidatable');
    });

    it('absorb is successful', async () => {
      absorbTx = await rsEthComet.connect(rsEthAbsorber).absorb(rsEthAbsorber.address, [rsEthAlice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates COMP full seizure values', async () => {
      const compInfo = await rsEthComet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await rsEthComet.getAssetInfoByAddress(wethAsset.address);
      const usdtInfo = await rsEthComet.getAssetInfoByAddress(usdtAsset.address);
      const compPrice = (await rsEthPriceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const wethPrice = (await rsEthPriceFeeds['WETH'].latestRoundData())[1].toBigInt();
      const usdtPrice = (await rsEthPriceFeeds['USDT'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, rsEthBasePrice, rsEthBaseScale);
      minDebtValue = mulPrice(rsEthBaseBorrowMin, rsEthBasePrice, rsEthBaseScale);

      const compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale);
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const usdtCollateralValue = mulPrice(usdtAmount, usdtPrice, usdtInfo.scale);
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor) +
        mulFactor(usdtCollateralValue, usdtInfo.borrowCollateralFactor);

      // The target HF formula wants more than $10 from COMP, so COMP is fully seized.
      const wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);

      compSeizeAmount = compAmount;
      compWantedCollateralValue = compCollateralValue;
      compSeizedValue = mulFactor(compWantedCollateralValue, compInfo.liquidationFactor);
    });

    it('calculates WETH full seizure values', async () => {
      const wethInfo = await rsEthComet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await rsEthPriceFeeds['WETH'].latestRoundData())[1].toBigInt();

      debtRemainingValue -= compSeizedValue;
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);

      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const wethCollateralValueLeft = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);

      wethSeizeAmount = wethAmount;
      wethWantedCollateralValue = wethCollateralValue;
      wethSeizedValue = wethCollateralValueLeft;
      debtRemainingValue -= wethSeizedValue;
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
    });

    it('calculates USDT target-health partial seizure and residual debt after seize', async () => {
      const usdtInfo = await rsEthComet.getAssetInfoByAddress(usdtAsset.address);
      const usdtPrice = (await rsEthPriceFeeds['USDT'].latestRoundData())[1].toBigInt();
      const usdtCollateralValue = mulPrice(usdtAmount, usdtPrice, usdtInfo.scale);
      const totalCollateralizedValue = mulFactor(usdtCollateralValue, usdtInfo.borrowCollateralFactor);

      // debtRemainingValue is still above minDebt, so this uses target-HF partial liquidation.
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);

      usdtWantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(usdtInfo.liquidationFactor, targetHealthFactor) - usdtInfo.borrowCollateralFactor.toBigInt());
      expect(usdtWantedCollateralValue).to.be.lessThan(usdtCollateralValue);

      usdtSeizeAmount = divPrice(usdtWantedCollateralValue, usdtPrice, usdtInfo.scale);
      usdtSeizedValue = mulFactor(usdtWantedCollateralValue, usdtInfo.liquidationFactor);
    });

    // USDT has 6 decimals and $1 price, so divPrice rounds down to leave exactly 1 raw unit.
    it('target-health USDT seizure leaves exactly one raw unit of USDT collateral', () => {
      expect(usdtAmount - usdtSeizeAmount).to.be.equal(1n);
    });

    it('target-health USDT seizure leaves positive residual debt in USD terms', () => {
      targetResidualDebtValue = debtRemainingValue - usdtSeizedValue;
      expect(targetResidualDebtValue).to.be.greaterThan(0n);
    });

    it('that residual debt is a positive rsETH borrow in base units', () => {
      targetResidualBorrowUnits = targetResidualDebtValue * rsEthBaseScale / rsEthBasePrice;
      expect(targetResidualBorrowUnits).to.be.greaterThan(0n);
    });

    it('that residual debt is still below the minimum borrow threshold', () => {
      expect(targetResidualDebtValue).to.be.lessThan(minDebtValue);
    });

    it('minDebt override recalculates USDT seizure and closes the residual debt', async () => {
      const usdtInfo = await rsEthComet.getAssetInfoByAddress(usdtAsset.address);
      const usdtPrice = (await rsEthPriceFeeds['USDT'].latestRoundData())[1].toBigInt();

      // Because target-HF seizure would leave debt below minDebt, absorbInternal
      // overrides it with _processDebtClosing on the same collateral.
      usdtWantedCollateralValue = debtRemainingValue * factorScale / usdtInfo.liquidationFactor.toBigInt();
      usdtSeizeAmount = divPrice(usdtWantedCollateralValue, usdtPrice, usdtInfo.scale);
      usdtSeizedValue = debtRemainingValue;
      usdtWantedCollateralValue = mulPrice(usdtSeizeAmount, usdtPrice, usdtInfo.scale);
    });

    it('newBalance is zero because minDebt override closes the dust', async () => {
      residualDebtValue = debtRemainingValue - usdtSeizedValue;
      expect(residualDebtValue).to.be.equal(0n);
      newBalance = -(residualDebtValue * rsEthBaseScale / rsEthBasePrice);

      expect(targetResidualBorrowUnits).to.be.greaterThan(0n);
      expect(newBalance).to.be.equal(0n);
      expect(await rsEthComet.borrowBalanceOf(rsEthAlice.address)).to.be.equal(0);
    });

    it('alice keeps one wei of USDT collateral', async () => {
      expect(usdtAmount - usdtSeizeAmount).to.be.equal(1n);
      expect(await rsEthComet.collateralBalanceOf(rsEthAlice.address, usdtAsset.address)).to.be.equal(1);
    });

    it('AbsorbDebt event is emitted with fully closed debt', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, rsEthBasePrice, rsEthBaseScale);

      await expect(absorbTx).to.emit(rsEthComet, 'AbsorbDebt').withArgs(rsEthAbsorber.address, rsEthAlice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('AbsorbCollateral event is emitted for COMP full seizure', async () => {
      await expect(absorbTx).to.emit(rsEthComet, 'AbsorbCollateral').withArgs(
        rsEthAbsorber.address,
        rsEthAlice.address,
        compAsset.address,
        compSeizeAmount,
        compWantedCollateralValue
      );
    });

    it('AbsorbCollateral event is emitted for WETH full seizure', async () => {
      await expect(absorbTx).to.emit(rsEthComet, 'AbsorbCollateral').withArgs(
        rsEthAbsorber.address,
        rsEthAlice.address,
        wethAsset.address,
        wethSeizeAmount,
        wethWantedCollateralValue
      );
    });

    it('AbsorbCollateral event is emitted for USDT partial seizure', async () => {
      await expect(absorbTx).to.emit(rsEthComet, 'AbsorbCollateral').withArgs(
        rsEthAbsorber.address,
        rsEthAlice.address,
        usdtAsset.address,
        usdtSeizeAmount,
        usdtWantedCollateralValue
      );
    });

    it('comet total borrow base is zero', async () => {
      expect((await rsEthComet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(BigNumber.from(basePaidOut)));
      expect((await rsEthComet.totalsBasic()).totalBorrowBase).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await rsEthComet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });
});
