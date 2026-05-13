import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, divPrice, default24Assets, factorScale, CollateralState, makeCollateralStates } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

// Covers the full-seizure path triggered by Solidity integer truncation.
// The special setups below have exact LF-adjusted collateral coverage above the debt,
// but rounded contract math makes the coverage look insufficient and seizes everything.
// Tests assert the expected correct flow, so current contract behavior fails at the exact step.
describe.skip('partial liquidation: full seizure from debt closing rounding', function() {
  const baseTokenPrice = exp(1, 8);
  const initialBaseFunding = baseTokenPrice * 1_000_000n;
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
    const assets: any = default24Assets();
    assets.COMP = { ...assets.COMP, supplyCap: exp(1_000_000, 18) };

    const protocol = await makeProtocol({
      base: 'USDC',
      assets: {
        USDC: { decimals: 6, initialPrice: 1 },
        ...assets,
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

  // 0.1228... COMP chosen so exact LF coverage exceeds $9.50 debt,
  // but floor(LF x collateralValue) = $9.49999999, so current code fully seizes.
  context('18 decimals collateral: exact coverage is enough but rounded contract coverage causes full seizure', function() {
    const SYMBOL = 'COMP';
    const collateralAmount = 122881904022765490n;
    const initialPrice = exp(105, 8);
    const droppedPrice = exp(85.9, 8);
    const borrowAmount = exp(10.2, 6);
    const repayAmount = exp(0.7, 6); // leaves $9.50 debt

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let collateralValue: bigint;
    let roundedCoverageValue: bigint;
    let exactCoverageNumerator: bigint;
    let exactCoverageDenominator: bigint;
    let expectedSeizeAmount: bigint;
    let expectedWantedCollateralValue: bigint;
    let expectedCoveredValue: bigint;
    let expectedProtocolLoss: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await priceFeeds[SYMBOL].connect(alice).setRoundData(0, initialPrice, 0, 0, 0);
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

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      // debtRemainingValue = 9.50e6 * 1e8 / 1e6 = 9.50e8
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(950000000n);
    });

    it('calculates collateral value before liquidation factor', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      // collateralValue = collateralAmount * droppedPrice / COMP scale
      collateralValue = mulPrice(collateralAmount, droppedPrice, assetInfo.scale);
      expect(collateralValue).to.be.equal(1055555555n);
    });

    it('calculates rounded liquidation-factor coverage used by the contract', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      // roundedCoverageValue = floor(1055555555 * 0.9) = 949999999
      roundedCoverageValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
      expect(roundedCoverageValue).to.be.lessThanOrEqual(debtRemainingValue);
    });

    it('confirms exact liquidation-factor coverage is enough to close the debt', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      exactCoverageNumerator = collateralAmount * droppedPrice * assetInfo.liquidationFactor.toBigInt();
      exactCoverageDenominator = assetInfo.scale.toBigInt() * factorScale;
      expect(exactCoverageNumerator).to.be.greaterThan(debtRemainingValue * exactCoverageDenominator);
    });

    it('calculates expected partial seizure amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      // expectedSeizeAmount = floor((debt / LF) / price)
      expectedSeizeAmount = divPrice(
        debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt(),
        droppedPrice,
        assetInfo.scale
      );
      expect(expectedSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('calculates expected wanted collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedWantedCollateralValue = mulPrice(expectedSeizeAmount, droppedPrice, assetInfo.scale);
      expect(expectedWantedCollateralValue).to.be.lessThan(collateralValue);
    });

    it('calculates expected covered value from partial seizure', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedCoveredValue = mulFactor(expectedWantedCollateralValue, assetInfo.liquidationFactor);
      expectedProtocolLoss = debtRemainingValue - expectedCoveredValue;
    });

    it('AbsorbCollateral emits the expected partial seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens[SYMBOL].address, expectedSeizeAmount, expectedWantedCollateralValue
      );
    });

    it('AbsorbDebt closes the debt', async () => {
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice collateral balance is reduced only by the expected partial seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens[SYMBOL].address)).to.be.equal(collateralAmount - expectedSeizeAmount);
    });

    it('alice borrow balance is fully closed', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
    });

    it('alice assetsIn is unchanged because collateral remains', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced only by the expected partial seizure', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens[SYMBOL].address)).totalSupplyAsset.toBigInt();
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState[SYMBOL].totalsCollateralBefore.toBigInt() - expectedSeizeAmount);
    });

    it('comet collateral reserves increase only by the expected partial seizure', async () => {
      const collateralReservesAfter = (await comet.getCollateralReserves(tokens[SYMBOL].address)).toBigInt();
      expect(collateralReservesAfter).to.be.equal(collateralsState[SYMBOL].collateralReservesBefore.toBigInt() + expectedSeizeAmount);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase.toBigInt()).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed base amount', async () => {
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
      expect(expectedCoveredValue).to.be.equal(debtRemainingValue);
    });

    it('protocol forgives no debt without collateral backing', () => {
      expect(expectedProtocolLoss).to.be.equal(0n);
    });
  });

  // 21953 raw WBTC at price $50,000.00506145 chosen so exact LF coverage exceeds $9.878851 debt,
  // but floor(LF x collateralValue) falls short, so current code fully seizes.
  context('8 decimals collateral: exact coverage is enough but rounded contract coverage causes full seizure', function() {
    const SYMBOL = 'WBTC';
    const collateralAmount = 21953n;
    const initialPrice = exp(70_000, 8);
    const droppedPrice = 5000000506145n; // $50,000.00506145
    const borrowAmount = exp(10.2, 6);
    const repayAmount = 321149n; // leaves $9.878851 debt

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let collateralValue: bigint;
    let roundedCoverageValue: bigint;
    let exactCoverageNumerator: bigint;
    let exactCoverageDenominator: bigint;
    let expectedSeizeAmount: bigint;
    let expectedWantedCollateralValue: bigint;
    let expectedCoveredValue: bigint;
    let expectedProtocolLoss: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await priceFeeds[SYMBOL].connect(alice).setRoundData(0, initialPrice, 0, 0, 0);
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

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(987885100n);
    });

    it('calculates collateral value before liquidation factor', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      collateralValue = mulPrice(collateralAmount, droppedPrice, assetInfo.scale);
      expect(collateralValue).to.be.equal(1097650111n);
    });

    it('calculates rounded liquidation-factor coverage used by the contract', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      roundedCoverageValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
      expect(roundedCoverageValue).to.be.lessThanOrEqual(debtRemainingValue);
    });

    it('confirms exact liquidation-factor coverage is enough to close the debt', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      exactCoverageNumerator = collateralAmount * droppedPrice * assetInfo.liquidationFactor.toBigInt();
      exactCoverageDenominator = assetInfo.scale.toBigInt() * factorScale;
      expect(exactCoverageNumerator).to.be.greaterThan(debtRemainingValue * exactCoverageDenominator);
    });

    it('calculates expected partial seizure amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedSeizeAmount = divPrice(
        debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt(),
        droppedPrice,
        assetInfo.scale
      );
      expect(expectedSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('calculates expected wanted collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedWantedCollateralValue = mulPrice(expectedSeizeAmount, droppedPrice, assetInfo.scale);
      expect(expectedWantedCollateralValue).to.be.lessThan(collateralValue);
    });

    it('calculates expected covered value from partial seizure', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedCoveredValue = mulFactor(expectedWantedCollateralValue, assetInfo.liquidationFactor);
      expectedProtocolLoss = debtRemainingValue - expectedCoveredValue;
    });

    it('AbsorbCollateral emits the expected partial seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens[SYMBOL].address, expectedSeizeAmount, expectedWantedCollateralValue
      );
    });

    it('AbsorbDebt closes the debt', async () => {
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice collateral balance is reduced only by the expected partial seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens[SYMBOL].address)).to.be.equal(collateralAmount - expectedSeizeAmount);
    });

    it('alice borrow balance is fully closed', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
    });

    it('alice assetsIn is unchanged because collateral remains', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced only by the expected partial seizure', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens[SYMBOL].address)).totalSupplyAsset.toBigInt();
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState[SYMBOL].totalsCollateralBefore.toBigInt() - expectedSeizeAmount);
    });

    it('comet collateral reserves increase only by the expected partial seizure', async () => {
      const collateralReservesAfter = (await comet.getCollateralReserves(tokens[SYMBOL].address)).toBigInt();
      expect(collateralReservesAfter).to.be.equal(collateralsState[SYMBOL].collateralReservesBefore.toBigInt() + expectedSeizeAmount);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase.toBigInt()).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed base amount', async () => {
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
      expect(expectedCoveredValue).to.be.equal(debtRemainingValue);
    });

    it('protocol forgives no debt without collateral backing', () => {
      expect(expectedProtocolLoss).to.be.equal(0n);
    });
  });

  // 11844266 raw USDT at price $0.80000123 chosen so exact LF coverage exceeds $9.001656 debt,
  // but floor(LF x collateralValue) falls short, so current code fully seizes.
  context('6 decimals collateral: exact coverage is enough but rounded contract coverage causes full seizure', function() {
    const SYMBOL = 'USDT';
    const collateralAmount = 11844266n;
    const initialPrice = exp(1.03, 8);
    const droppedPrice = 80000123n; // $0.80000123
    const borrowAmount = exp(10.2, 6);
    const repayAmount = 1198344n; // leaves $9.001656 debt

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let collateralValue: bigint;
    let roundedCoverageValue: bigint;
    let exactCoverageNumerator: bigint;
    let exactCoverageDenominator: bigint;
    let expectedSeizeAmount: bigint;
    let expectedWantedCollateralValue: bigint;
    let expectedCoveredValue: bigint;
    let expectedProtocolLoss: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await priceFeeds[SYMBOL].connect(alice).setRoundData(0, initialPrice, 0, 0, 0);
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

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(900165600n);
    });

    it('calculates collateral value before liquidation factor', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      collateralValue = mulPrice(collateralAmount, droppedPrice, assetInfo.scale);
      expect(collateralValue).to.be.equal(947542736n);
    });

    it('calculates rounded liquidation-factor coverage used by the contract', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      roundedCoverageValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
      expect(roundedCoverageValue).to.be.lessThanOrEqual(debtRemainingValue);
    });

    it('confirms exact liquidation-factor coverage is enough to close the debt', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      exactCoverageNumerator = collateralAmount * droppedPrice * assetInfo.liquidationFactor.toBigInt();
      exactCoverageDenominator = assetInfo.scale.toBigInt() * factorScale;
      expect(exactCoverageNumerator).to.be.greaterThan(debtRemainingValue * exactCoverageDenominator);
    });

    it('calculates expected partial seizure amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedSeizeAmount = divPrice(
        debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt(),
        droppedPrice,
        assetInfo.scale
      );
      expect(expectedSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('calculates expected wanted collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedWantedCollateralValue = mulPrice(expectedSeizeAmount, droppedPrice, assetInfo.scale);
      expect(expectedWantedCollateralValue).to.be.lessThan(collateralValue);
    });

    it('calculates expected covered value from partial seizure', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedCoveredValue = mulFactor(expectedWantedCollateralValue, assetInfo.liquidationFactor);
      expectedProtocolLoss = debtRemainingValue - expectedCoveredValue;
    });

    it('AbsorbCollateral emits the expected partial seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens[SYMBOL].address, expectedSeizeAmount, expectedWantedCollateralValue
      );
    });

    it('AbsorbDebt closes the debt', async () => {
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice collateral balance is reduced only by the expected partial seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens[SYMBOL].address)).to.be.equal(collateralAmount - expectedSeizeAmount);
    });

    it('alice borrow balance is fully closed', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
    });

    it('alice assetsIn is unchanged because collateral remains', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced only by the expected partial seizure', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens[SYMBOL].address)).totalSupplyAsset.toBigInt();
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState[SYMBOL].totalsCollateralBefore.toBigInt() - expectedSeizeAmount);
    });

    it('comet collateral reserves increase only by the expected partial seizure', async () => {
      const collateralReservesAfter = (await comet.getCollateralReserves(tokens[SYMBOL].address)).toBigInt();
      expect(collateralReservesAfter).to.be.equal(collateralsState[SYMBOL].collateralReservesBefore.toBigInt() + expectedSeizeAmount);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase.toBigInt()).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed base amount', async () => {
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
      expect(expectedCoveredValue).to.be.equal(debtRemainingValue);
    });

    it('protocol forgives no debt without collateral backing', () => {
      expect(expectedProtocolLoss).to.be.equal(0n);
    });
  });

  // ~11,641 COMP at $85.9 chosen so exact LF coverage exceeds $900,000 debt,
  // but floor(LF x collateralValue) falls short by one price unit.
  context('large notional collateral: exact coverage is enough but rounded contract coverage causes full seizure', function() {
    const SYMBOL = 'COMP';
    const collateralAmount = 11641443538998835855647n; // ~11,641 COMP
    const initialPrice = exp(105, 8);
    const droppedPrice = exp(85.9, 8);
    const borrowAmount = exp(900000.2, 6);
    const repayAmount = exp(0.2, 6); // leaves $900,000 debt

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let collateralValue: bigint;
    let roundedCoverageValue: bigint;
    let exactCoverageNumerator: bigint;
    let exactCoverageDenominator: bigint;
    let expectedSeizeAmount: bigint;
    let expectedWantedCollateralValue: bigint;
    let expectedCoveredValue: bigint;
    let expectedProtocolLoss: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await priceFeeds[SYMBOL].connect(alice).setRoundData(0, initialPrice, 0, 0, 0);
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

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(90000000000000n);
    });

    it('calculates collateral value before liquidation factor', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      collateralValue = mulPrice(collateralAmount, droppedPrice, assetInfo.scale);
      expect(collateralValue).to.be.equal(100000000000000n);
    });

    it('calculates rounded liquidation-factor coverage used by the contract', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      roundedCoverageValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
      expect(roundedCoverageValue).to.be.lessThanOrEqual(debtRemainingValue);
    });

    it('confirms exact liquidation-factor coverage is enough to close the debt', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      exactCoverageNumerator = collateralAmount * droppedPrice * assetInfo.liquidationFactor.toBigInt();
      exactCoverageDenominator = assetInfo.scale.toBigInt() * factorScale;
      expect(exactCoverageNumerator).to.be.greaterThan(debtRemainingValue * exactCoverageDenominator);
    });

    it('calculates expected partial seizure amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedSeizeAmount = divPrice(
        debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt(),
        droppedPrice,
        assetInfo.scale
      );
      expect(expectedSeizeAmount).to.be.lessThan(collateralAmount);
    });

    it('calculates expected wanted collateral value', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedWantedCollateralValue = mulPrice(expectedSeizeAmount, droppedPrice, assetInfo.scale);
      expect(expectedWantedCollateralValue).to.be.lessThan(collateralValue);
    });

    it('calculates expected covered value from partial seizure', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[SYMBOL].address);
      expectedCoveredValue = mulFactor(expectedWantedCollateralValue, assetInfo.liquidationFactor);
      expectedProtocolLoss = debtRemainingValue - expectedCoveredValue;
    });

    it('AbsorbCollateral emits the expected partial seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens[SYMBOL].address, expectedSeizeAmount, expectedWantedCollateralValue
      );
    });

    it('AbsorbDebt closes the debt', async () => {
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice collateral balance is reduced only by the expected partial seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens[SYMBOL].address)).to.be.equal(collateralAmount - expectedSeizeAmount);
    });

    it('alice borrow balance is fully closed', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
    });

    it('alice assetsIn is unchanged because collateral remains', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced only by the expected partial seizure', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens[SYMBOL].address)).totalSupplyAsset.toBigInt();
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState[SYMBOL].totalsCollateralBefore.toBigInt() - expectedSeizeAmount);
    });

    it('comet collateral reserves increase only by the expected partial seizure', async () => {
      const collateralReservesAfter = (await comet.getCollateralReserves(tokens[SYMBOL].address)).toBigInt();
      expect(collateralReservesAfter).to.be.equal(collateralsState[SYMBOL].collateralReservesBefore.toBigInt() + expectedSeizeAmount);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase.toBigInt()).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed base amount', async () => {
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
      expect(expectedCoveredValue).to.be.equal(debtRemainingValue);
    });

    it('protocol forgives no debt without collateral backing', () => {
      expect(expectedProtocolLoss).to.be.equal(0n);
    });
  });

  // After full COMP seizure, remaining $9.50 debt is below baseBorrowMin.
  // WETH's LF-adjusted value is 5 price wei short of that debt.
  // The 5 wei residual rounds to 0 USDC base units, so the account closes cleanly.
  context('multi-collateral: first collateral fully seized, second collateral leaves debt dust below 10 wei', function() {
    const compAmount = exp(0.1, 18); // 0.1 COMP, worth $10
    const wethAmount = exp(0.007037037, 18, 9); // WETH LF-weighted value becomes $9.49999995
    const borrowAmount = exp(18.5, 6);
    const droppedWethPrice = exp(1500, 8);
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let residualDebtValue: bigint;
    let compWantedCollateralValue: bigint;
    let wethWantedCollateralValue: bigint;
    let exactCoverageNumerator: bigint;
    let exactCoverageDenominator: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, compAmount);
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['WETH'].connect(alice).setRoundData(0, droppedWethPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase;
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
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale);
      compWantedCollateralValue = compCollateralValue;
      collateralsState['COMP'].seizeAmount = compAmount;
      collateralsState['COMP'].seizedValue = mulFactor(compWantedCollateralValue, compInfo.liquidationFactor);
      debtRemainingValue -= collateralsState['COMP'].seizedValue;
    });

    it('calculates WETH full seizure values', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethCollateralValue = mulPrice(wethAmount, droppedWethPrice, wethInfo.scale);
      const wethCollateralValueLeft = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);

      collateralsState['WETH'].seizeAmount = wethAmount;
      wethWantedCollateralValue = wethCollateralValue;
      collateralsState['WETH'].seizedValue = wethCollateralValueLeft;
      residualDebtValue = debtRemainingValue - collateralsState['WETH'].seizedValue;

      exactCoverageNumerator = wethAmount * droppedWethPrice * wethInfo.liquidationFactor.toBigInt();
      exactCoverageDenominator = wethInfo.scale.toBigInt() * factorScale;
      newBalance = -(residualDebtValue * baseScale / baseTokenPrice);
    });

    it('WETH coverage calculation is exact with no floor loss', () => {
      expect(exactCoverageNumerator).to.be.equal(collateralsState['WETH'].seizedValue * exactCoverageDenominator);
    });

    it('residual debt is sub-representable in base token units', () => {
      expect(residualDebtValue * baseScale / baseTokenPrice).to.be.equal(0n);
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

    it('AbsorbCollateral event is emitted for COMP full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address,
        collateralsState['COMP'].seizeAmount, compWantedCollateralValue
      );
    });

    it('AbsorbCollateral event is emitted for WETH full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['WETH'].address,
        collateralsState['WETH'].seizeAmount, wethWantedCollateralValue
      );
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

    it('alice WETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(0);
    });

    it('alice assetsIn is zero after all collateral is seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied COMP is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(collateralsState['WETH'].totalsCollateralBefore.sub(collateralsState['WETH'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
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

    it('comet WETH collateral reserves increase by all seized WETH', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });
});
