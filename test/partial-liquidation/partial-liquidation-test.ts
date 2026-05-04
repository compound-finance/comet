import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, principalValue, default24Assets, divPrice } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

describe('partial liquidation', function() {
  // Protocol
  let comet: CometHarnessInterfaceExtendedAssetList;

  // Constants
  const baseTokenPrice = exp(1, 8);
  const initialBaseFunding = baseTokenPrice * 10_000n;
  const baseBorrowMin = exp(10, 6); // $10

  // Assets
  let tokens: { [symbol: string]: FaucetToken } = {};
  let baseToken: FaucetToken;
  let priceFeeds: { [symbol: string]: SimplePriceFeed } = {};

  // Signers
  let alice: SignerWithAddress;
  let absorber: SignerWithAddress;

  // Math
  const baseScale: bigint = 10n ** 6n;
  const factorScale: bigint = 10n ** 18n;
  let targetHealthFactor: bigint;

  // Snapshot
  let snapshot: SnapshotRestorer;

  before(async function() {
    const default24AssetsData = default24Assets();
    const protocol = await makeProtocol({
      base: 'USDC',
      assets: {
        USDC: { decimals: 6, initialPrice: 1 },
        ...default24AssetsData,
        // Large cap so the 24-collateral scenario can hold enough sUSDe.
        sUSDe: { ...default24AssetsData.sUSDe, supplyCap: exp(400, 18) },
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

    // Allocate and approve all test assets for Alice.
    const allocateAmount = exp(1_000_000, 18);
    for (const token of Object.values(protocol.tokens)) {
      await (token as FaucetToken).allocateTo(alice.address, allocateAmount);
      await (token as FaucetToken).connect(alice).approve(comet.address, ethers.constants.MaxUint256);
    }

    // Allocate base token to comet for borrowings
    await baseToken.allocateTo(comet.address, initialBaseFunding);
    targetHealthFactor = (await comet.targetHealthFactor()).toBigInt();
    snapshot = await takeSnapshot();
  });

  context('1 collateral: partial seizure, user has enough to cover debt (asset index 0)', function () {
    const collateralAmount = exp(1, 18); // $100
    const borrowAmount = exp(80, 6); // $80

    let collateralAsset: FaucetToken;
    let totalsCollateralBefore: BigNumber;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let seizedValue: bigint;
    let seizeAmount: bigint;
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      collateralAsset = tokens['COMP'];
      await comet.connect(alice).supply(collateralAsset.address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop price by 7%
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const newCompPrice = compPrice * 93n / 100n;
      await priceFeeds['COMP'].connect(alice).setRoundData(0, newCompPrice, 0, 0, 0);
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

    it('alice collateral balance is equal to supplied amount', async () => {
      const collateralBalance = await comet.collateralBalanceOf(alice.address, collateralAsset.address);
      expect(collateralBalance).to.be.equal(collateralAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assets in is equal to 1', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const expectedAssetsIn = 1 << assetInfo.offset;

      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved is equal to 0', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied collateral amount is equal to alice supplied amount', async () => {
      totalsCollateralBefore = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;
      expect(totalsCollateralBefore).to.be.equal(collateralAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('collateral reserves are equal to zero', async () => {
      collateralReservesBefore = await comet.getCollateralReserves(collateralAsset.address);
      expect(collateralReservesBefore).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      const principal = (await comet.userBasic(alice.address)).principal;
      expect(principal).to.be.equal(-borrowAmount);
    });

    it('comet ERC20 collateral token balance is equal to supplied collateral before absorb', async () => {
      cometCollateralTokenBalanceBefore = await collateralAsset.balanceOf(comet.address);
      expect(cometCollateralTokenBalanceBefore).to.be.equal(collateralAmount);
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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates seize amount and seized value for partial liquidation', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();

      // Debt is 80 USDC, so the debt value is $80.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // Alice supplied 1 COMP. After the 7% price drop it is worth $93.
      const collateralValue = mulPrice(collateralAmount, compPrice, assetInfo.scale);

      // The contract uses borrow CF for health factor collateral value: $93 * 0.80 = $74.40.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);

      // Solve for S in:
      // targetHF = (totalCollateralValue - S * borrowCF) / (debt - S * liquidationFactor)
      // With these values, S is about $66.21 of COMP.
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());

      // Convert the wanted USD value into COMP amount, then apply LF for the debt value repaid.
      // At $93/COMP this seizes about 0.7119 COMP and repays about $59.59 of debt value.
      seizeAmount = divPrice(wantedCollateralValue, compPrice, assetInfo.scale);
      seizedValue = mulFactor(wantedCollateralValue, assetInfo.liquidationFactor);
    });

    it('calculates newBalance after debt is reduced by seized value', async () => {
      // The contract reduces debt value by seizedValue.
      // Here: debt starts near $80 and seizedValue repays about $59.59.
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;

      // Convert the remaining USD debt value back to USDC base units.
      // Around $20.41 remains, and borrow positions are stored as negative balances.
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', async () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address)).toBigInt();

      expect(newBalance).to.be.greaterThan(oldBalance);
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('newPrincipal is equal to newBalance', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = (await comet.userBasic(alice.address)).principal;
      const expectedNewPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      expect(newPrincipal).to.equal(expectedNewPrincipal);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice collateral balance is reduced by the seized amount', async () => {
      const collateralBalance = await comet.collateralBalanceOf(alice.address, collateralAsset.address);

      expect(collateralBalance).to.be.equal(collateralAmount - seizeAmount);
    });

    it('alice assetsIn does not change', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('1 collateral: partial seizure, user has enough to cover debt (asset index 16)', function () {
    const collateralAmount = exp(100, 18); // 100 LDO, initially worth $200
    const borrowAmount = exp(80, 6); // $80

    let collateralAsset: FaucetToken;
    let totalsCollateralBefore: BigNumber;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let seizedValue: bigint;
    let seizeAmount: bigint;
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      collateralAsset = tokens['LDO'];
      await comet.connect(alice).supply(collateralAsset.address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop LDO by 45% from $2 to $1.10. 100 LDO is now worth $110.
      // Remaining debt after partial seizure ≈ $21.68, which is above baseBorrowMin ($10).
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();
      const newLdoPrice = ldoPrice * 55n / 100n;
      await priceFeeds['LDO'].connect(alice).setRoundData(0, newLdoPrice, 0, 0, 0);
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

    it('alice collateral balance is equal to supplied amount', async () => {
      const collateralBalance = await comet.collateralBalanceOf(alice.address, collateralAsset.address);
      expect(collateralBalance).to.be.equal(collateralAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn is zero for asset index 16', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved has the bit for asset index 16', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const expectedReserved = 1 << (assetInfo.offset - 16);

      expect(assetInfo.offset).to.be.equal(16);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    it('comet total supplied collateral amount is equal to alice supplied amount', async () => {
      totalsCollateralBefore = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;
      expect(totalsCollateralBefore).to.be.equal(collateralAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('collateral reserves are equal to zero', async () => {
      collateralReservesBefore = await comet.getCollateralReserves(collateralAsset.address);
      expect(collateralReservesBefore).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('comet ERC20 collateral token balance is equal to supplied collateral before absorb', async () => {
      cometCollateralTokenBalanceBefore = await collateralAsset.balanceOf(comet.address);
      expect(cometCollateralTokenBalanceBefore).to.be.equal(collateralAmount);
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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates seize amount and seized value for partial liquidation', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();

      // Debt is $80.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // 100 LDO at $1.10 is worth $110.
      const collateralValue = mulPrice(collateralAmount, ldoPrice, assetInfo.scale);

      // borrowCF collateral value: $110 * 0.55 = $60.50.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);

      // Solve for S in:
      // targetHF = (totalCollateralValue - S * borrowCF) / (debt - S * liquidationFactor)
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());

      seizeAmount = divPrice(wantedCollateralValue, ldoPrice, assetInfo.scale);
      seizedValue = mulFactor(wantedCollateralValue, assetInfo.liquidationFactor);
    });

    it('calculates newBalance after debt is reduced by seized value', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', async () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address)).toBigInt();

      expect(newBalance).to.be.greaterThan(oldBalance);
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('newPrincipal is equal to newBalance', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = (await comet.userBasic(alice.address)).principal;
      const expectedNewPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      expect(newPrincipal).to.equal(expectedNewPrincipal);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice collateral balance is reduced by the seized amount', async () => {
      const collateralBalance = await comet.collateralBalanceOf(alice.address, collateralAsset.address);

      expect(collateralBalance).to.be.equal(collateralAmount - seizeAmount);
    });

    it('alice assetsIn does not change', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('1 collateral: partial seizure, user has enough to cover debt (last asset index)', function () {
    const collateralAmount = exp(100, 18); // 100 sUSDe, initially worth $100
    const borrowAmount = exp(50, 6); // $50

    let collateralAsset: FaucetToken;
    let totalsCollateralBefore: BigNumber;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let seizedValue: bigint;
    let seizeAmount: bigint;
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      collateralAsset = tokens['sUSDe'];
      await comet.connect(alice).supply(collateralAsset.address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop sUSDe by 40% from $1 to $0.60. 100 sUSDe is now worth $60.
      // Remaining debt after partial seizure ≈ $15.22, which is above baseBorrowMin ($10).
      const sUsdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1].toBigInt();
      const newSUsdePrice = sUsdePrice * 60n / 100n;
      await priceFeeds['sUSDe'].connect(alice).setRoundData(0, newSUsdePrice, 0, 0, 0);
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

    it('alice collateral balance is equal to supplied amount', async () => {
      const collateralBalance = await comet.collateralBalanceOf(alice.address, collateralAsset.address);
      expect(collateralBalance).to.be.equal(collateralAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn is zero for the last asset index', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved has the bit for the last asset index', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const expectedReserved = 1 << (assetInfo.offset - 16);

      expect(assetInfo.offset).to.be.equal((await comet.numAssets()) - 1);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    it('comet total supplied collateral amount is equal to alice supplied amount', async () => {
      totalsCollateralBefore = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;
      expect(totalsCollateralBefore).to.be.equal(collateralAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('collateral reserves are equal to zero', async () => {
      collateralReservesBefore = await comet.getCollateralReserves(collateralAsset.address);
      expect(collateralReservesBefore).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('comet ERC20 collateral token balance is equal to supplied collateral before absorb', async () => {
      cometCollateralTokenBalanceBefore = await collateralAsset.balanceOf(comet.address);
      expect(cometCollateralTokenBalanceBefore).to.be.equal(collateralAmount);
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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates seize amount and seized value for partial liquidation', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const sUsdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1].toBigInt();

      // Debt is $50.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // 100 sUSDe at $0.60 is worth $60.
      const collateralValue = mulPrice(collateralAmount, sUsdePrice, assetInfo.scale);

      // borrowCF collateral value: $60 * 0.72 = $43.20.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);

      // Solve for S in:
      // targetHF = (totalCollateralValue - S * borrowCF) / (debt - S * liquidationFactor)
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());

      seizeAmount = divPrice(wantedCollateralValue, sUsdePrice, assetInfo.scale);
      seizedValue = mulFactor(wantedCollateralValue, assetInfo.liquidationFactor);
    });

    it('calculates newBalance after debt is reduced by seized value', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', async () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address)).toBigInt();

      expect(newBalance).to.be.greaterThan(oldBalance);
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('newPrincipal is equal to newBalance', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = (await comet.userBasic(alice.address)).principal;
      const expectedNewPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      expect(newPrincipal).to.equal(expectedNewPrincipal);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice collateral balance is reduced by the seized amount', async () => {
      const collateralBalance = await comet.collateralBalanceOf(alice.address, collateralAsset.address);

      expect(collateralBalance).to.be.equal(collateralAmount - seizeAmount);
    });

    it('alice assetsIn does not change', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of first asset then partial of second', function () {
    const compAmount = exp(0.6, 18); // 0.6 COMP, worth $60 before the price drop
    const wethAmount = exp(0.0225, 18); // 0.0225 WETH at $2,000 = $45
    const borrowAmount = exp(80, 6); // $80

    let compAsset: FaucetToken;
    let wethAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let compTotalsCollateralBefore: BigNumber;
    let wethTotalsCollateralBefore: BigNumber;
    let compCollateralReservesBefore: BigNumber;
    let wethCollateralReservesBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let compSeizeAmount: bigint;
    let compSeizedValue: bigint;
    let wethSeizeAmount: bigint;
    let wethSeizedValue: bigint;
    let cometCompTokenBalanceBefore: BigNumber;
    let cometWethTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      compAsset = tokens['COMP'];
      wethAsset = tokens['WETH'];

      await comet.connect(alice).supply(compAsset.address, compAmount);
      await comet.connect(alice).supply(wethAsset.address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop COMP by 20% to $80. The supplied COMP is now worth $48.
      // WETH stays at $45, enough for partial seizure after COMP is fully seized.
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const newCompPrice = compPrice * 80n / 100n;
      await priceFeeds['COMP'].connect(alice).setRoundData(0, newCompPrice, 0, 0, 0);
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

    it('alice assets in includes COMP and WETH', async () => {
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

    it('collateral reserves are equal to zero', async () => {
      compCollateralReservesBefore = await comet.getCollateralReserves(compAsset.address);
      wethCollateralReservesBefore = await comet.getCollateralReserves(wethAsset.address);

      expect(compCollateralReservesBefore).to.be.equal(0);
      expect(wethCollateralReservesBefore).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
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

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates COMP full seizure values', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // COMP is first in asset order. After the 20% price drop, 0.6 COMP is worth $48.
      const compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale);
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      // The target HF formula wants more than $48 from COMP, so the first asset is fully seized.
      const wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);

      compSeizeAmount = compAmount;
      compSeizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
    });

    it('calculates WETH partial seizure values', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);

      // After COMP full seizure, debt is $80 - $43.20 = $36.80.
      debtRemainingValue -= compSeizedValue;

      // WETH is still worth $45, with $33.75 borrow-CF collateral value.
      const totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      // Solve the same target HF formula for WETH.
      // It wants about $25.08 of WETH value, so WETH is partially seized.
      const wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWethCollateralValue).to.be.lessThan(wethCollateralValue);

      wethSeizeAmount = divPrice(wantedWethCollateralValue, wethPrice, wethInfo.scale);
      wethSeizedValue = mulFactor(wantedWethCollateralValue, wethInfo.liquidationFactor);
    });

    it('calculates newBalance after COMP and WETH reduce debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - wethSeizedValue;
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', async () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address));

      expect(newBalance).to.be.greaterThan(oldBalance);
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('newPrincipal is equal to newBalance', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = (await comet.userBasic(alice.address)).principal;
      const expectedNewPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(newPrincipal).to.equal(expectedNewPrincipal);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
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

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(wethAmount - wethSeizeAmount);
    });

    it('alice assetsIn keeps only WETH', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const expectedAssetsIn = 1 << wethInfo.offset;

      expect(assetsInBefore).to.not.equal(expectedAssetsIn);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied COMP is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(compAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(compTotalsCollateralBefore.sub(compSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(wethTotalsCollateralBefore.sub(wethSeizeAmount));
      expect(totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet COMP collateral reserves increase by all seized COMP', async () => {
      expect(await comet.getCollateralReserves(compAsset.address)).to.be.equal(compCollateralReservesBefore.add(compSeizeAmount));
    });

    it('comet WETH collateral reserves increase by seized WETH', async () => {
      expect(await comet.getCollateralReserves(wethAsset.address)).to.be.equal(wethCollateralReservesBefore.add(wethSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of asset index 15 then partial of asset index 16', function () {
    const aaveAmount = exp(0.6, 18); // 0.6 AAVE, worth $60 before the price drop
    const ldoAmount = exp(37.5, 18); // 37.5 LDO, worth $75 before the price drop
    const borrowAmount = exp(75, 6); // $75

    let aaveAsset: FaucetToken;
    let ldoAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let aaveTotalsCollateralBefore: BigNumber;
    let ldoTotalsCollateralBefore: BigNumber;
    let aaveCollateralReservesBefore: BigNumber;
    let ldoCollateralReservesBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let aaveSeizeAmount: bigint;
    let aaveSeizedValue: bigint;
    let ldoSeizeAmount: bigint;
    let ldoSeizedValue: bigint;
    let cometAaveTokenBalanceBefore: BigNumber;
    let cometLdoTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      aaveAsset = tokens['AAVE'];
      ldoAsset = tokens['LDO'];

      await comet.connect(alice).supply(aaveAsset.address, aaveAmount);
      await comet.connect(alice).supply(ldoAsset.address, ldoAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop both assets by 20%. AAVE is now worth $48 and LDO is worth $60.
      const aavePrice = (await priceFeeds['AAVE'].latestRoundData())[1].toBigInt();
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();
      await priceFeeds['AAVE'].connect(alice).setRoundData(0, aavePrice * 80n / 100n, 0, 0, 0);
      await priceFeeds['LDO'].connect(alice).setRoundData(0, ldoPrice * 80n / 100n, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
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

    it('alice assets in includes only AAVE', async () => {
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

    it('collateral reserves are equal to zero', async () => {
      aaveCollateralReservesBefore = await comet.getCollateralReserves(aaveAsset.address);
      ldoCollateralReservesBefore = await comet.getCollateralReserves(ldoAsset.address);

      expect(aaveCollateralReservesBefore).to.be.equal(0);
      expect(ldoCollateralReservesBefore).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates AAVE full seizure values', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const aavePrice = (await priceFeeds['AAVE'].latestRoundData())[1].toBigInt();
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // AAVE is asset index 15. After the 20% price drop, 0.6 AAVE is worth $48.
      const aaveCollateralValue = mulPrice(aaveAmount, aavePrice, aaveInfo.scale);
      const ldoCollateralValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);
      const totalCollateralizedValue =
        mulFactor(aaveCollateralValue, aaveInfo.borrowCollateralFactor) +
        mulFactor(ldoCollateralValue, ldoInfo.borrowCollateralFactor);

      // The target HF formula wants more than $48 from AAVE, so the first asset is fully seized.
      const wantedAaveCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(aaveInfo.liquidationFactor, targetHealthFactor) - aaveInfo.borrowCollateralFactor.toBigInt());
      expect(wantedAaveCollateralValue).to.be.greaterThan(aaveCollateralValue);

      aaveSeizeAmount = aaveAmount;
      aaveSeizedValue = mulFactor(aaveCollateralValue, aaveInfo.liquidationFactor);
    });

    it('calculates LDO partial seizure values', async () => {
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();
      const ldoCollateralValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);

      // After AAVE full seizure, debt is $75 - $40.80 = $34.20.
      debtRemainingValue -= aaveSeizedValue;

      // LDO is worth $60, with $33 of borrow-CF collateral value.
      const totalCollateralizedValue = mulFactor(ldoCollateralValue, ldoInfo.borrowCollateralFactor);

      // Solve the same target HF formula for LDO.
      // It wants about $8.50 of LDO value, so LDO is partially seized.
      const wantedLdoCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(ldoInfo.liquidationFactor, targetHealthFactor) - ldoInfo.borrowCollateralFactor.toBigInt());
      expect(wantedLdoCollateralValue).to.be.lessThan(ldoCollateralValue);

      ldoSeizeAmount = divPrice(wantedLdoCollateralValue, ldoPrice, ldoInfo.scale);
      ldoSeizedValue = mulFactor(wantedLdoCollateralValue, ldoInfo.liquidationFactor);
    });

    it('calculates newBalance after AAVE and LDO reduce debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - ldoSeizedValue;
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', async () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address));

      expect(newBalance).to.be.greaterThan(oldBalance);
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('newPrincipal is equal to newBalance', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = (await comet.userBasic(alice.address)).principal;
      const expectedNewPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(newPrincipal).to.equal(expectedNewPrincipal);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
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

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice AAVE collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, aaveAsset.address)).to.be.equal(0);
    });

    it('alice LDO collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ldoAsset.address)).to.be.equal(ldoAmount - ldoSeizeAmount);
    });

    it('alice assetsIn is zero after AAVE is fully seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved keeps only LDO', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied AAVE is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(aaveAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(aaveTotalsCollateralBefore.sub(aaveSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied LDO is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(ldoAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(ldoTotalsCollateralBefore.sub(ldoSeizeAmount));
      expect(totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet AAVE collateral reserves increase by all seized AAVE', async () => {
      expect(await comet.getCollateralReserves(aaveAsset.address)).to.be.equal(aaveCollateralReservesBefore.add(aaveSeizeAmount));
    });

    it('comet LDO collateral reserves increase by seized LDO', async () => {
      expect(await comet.getCollateralReserves(ldoAsset.address)).to.be.equal(ldoCollateralReservesBefore.add(ldoSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of asset index 22 then partial of asset index 23', function () {
    const usdeAmount = exp(60, 18); // 60 USDe, worth $60 before the price drop
    const susdeAmount = exp(75, 18); // 75 sUSDe, worth $75 before the price drop
    const borrowAmount = exp(90, 6); // $90

    let usdeAsset: FaucetToken;
    let susdeAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let usdeTotalsCollateralBefore: BigNumber;
    let susdeTotalsCollateralBefore: BigNumber;
    let usdeCollateralReservesBefore: BigNumber;
    let susdeCollateralReservesBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let usdeSeizeAmount: bigint;
    let usdeSeizedValue: bigint;
    let susdeSeizeAmount: bigint;
    let susdeSeizedValue: bigint;
    let cometUsdeTokenBalanceBefore: BigNumber;
    let cometSusdeTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      usdeAsset = tokens['USDe'];
      susdeAsset = tokens['sUSDe'];

      await comet.connect(alice).supply(usdeAsset.address, usdeAmount);
      await comet.connect(alice).supply(susdeAsset.address, susdeAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop both assets by 20%. USDe is now worth $48 and sUSDe is worth $60.
      const usdePrice = (await priceFeeds['USDe'].latestRoundData())[1].toBigInt();
      const susdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1].toBigInt();
      await priceFeeds['USDe'].connect(alice).setRoundData(0, usdePrice * 80n / 100n, 0, 0, 0);
      await priceFeeds['sUSDe'].connect(alice).setRoundData(0, susdePrice * 80n / 100n, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice USDe collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, usdeAsset.address)).to.be.equal(usdeAmount);
    });

    it('alice sUSDe collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, susdeAsset.address)).to.be.equal(susdeAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assets in is zero for asset indexes 22 and 23', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved includes USDe and sUSDe', async () => {
      const usdeInfo = await comet.getAssetInfoByAddress(usdeAsset.address);
      const susdeInfo = await comet.getAssetInfoByAddress(susdeAsset.address);
      const expectedReserved = (1 << (usdeInfo.offset - 16)) | (1 << (susdeInfo.offset - 16));

      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    it('comet total supplied USDe is equal to alice supplied USDe', async () => {
      usdeTotalsCollateralBefore = (await comet.totalsCollateral(usdeAsset.address)).totalSupplyAsset;
      expect(usdeTotalsCollateralBefore).to.be.equal(usdeAmount);
    });

    it('comet total supplied sUSDe is equal to alice supplied sUSDe', async () => {
      susdeTotalsCollateralBefore = (await comet.totalsCollateral(susdeAsset.address)).totalSupplyAsset;
      expect(susdeTotalsCollateralBefore).to.be.equal(susdeAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('collateral reserves are equal to zero', async () => {
      usdeCollateralReservesBefore = await comet.getCollateralReserves(usdeAsset.address);
      susdeCollateralReservesBefore = await comet.getCollateralReserves(susdeAsset.address);

      expect(usdeCollateralReservesBefore).to.be.equal(0);
      expect(susdeCollateralReservesBefore).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('comet ERC20 USDe token balance is equal to supplied USDe before absorb', async () => {
      cometUsdeTokenBalanceBefore = await usdeAsset.balanceOf(comet.address);
      expect(cometUsdeTokenBalanceBefore).to.be.equal(usdeAmount);
    });

    it('comet ERC20 sUSDe token balance is equal to supplied sUSDe before absorb', async () => {
      cometSusdeTokenBalanceBefore = await susdeAsset.balanceOf(comet.address);
      expect(cometSusdeTokenBalanceBefore).to.be.equal(susdeAmount);
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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates USDe full seizure values', async () => {
      const usdeInfo = await comet.getAssetInfoByAddress(usdeAsset.address);
      const susdeInfo = await comet.getAssetInfoByAddress(susdeAsset.address);
      const usdePrice = (await priceFeeds['USDe'].latestRoundData())[1].toBigInt();
      const susdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // USDe is asset index 22. After the 20% price drop, 60 USDe is worth $48.
      const usdeCollateralValue = mulPrice(usdeAmount, usdePrice, usdeInfo.scale);
      const susdeCollateralValue = mulPrice(susdeAmount, susdePrice, susdeInfo.scale);
      const totalCollateralizedValue =
        mulFactor(usdeCollateralValue, usdeInfo.borrowCollateralFactor) +
        mulFactor(susdeCollateralValue, susdeInfo.borrowCollateralFactor);

      // The target HF formula wants more than $48 from USDe, so the first asset is fully seized.
      const wantedUsdeCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(usdeInfo.liquidationFactor, targetHealthFactor) - usdeInfo.borrowCollateralFactor.toBigInt());
      expect(wantedUsdeCollateralValue).to.be.greaterThan(usdeCollateralValue);

      usdeSeizeAmount = usdeAmount;
      usdeSeizedValue = mulFactor(usdeCollateralValue, usdeInfo.liquidationFactor);
    });

    it('calculates sUSDe partial seizure values', async () => {
      const susdeInfo = await comet.getAssetInfoByAddress(susdeAsset.address);
      const susdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1].toBigInt();
      const susdeCollateralValue = mulPrice(susdeAmount, susdePrice, susdeInfo.scale);

      // After USDe full seizure, debt is $90 - $44.16 = $45.84.
      debtRemainingValue -= usdeSeizedValue;

      // sUSDe is worth $60, with $43.20 of borrow-CF collateral value.
      const totalCollateralizedValue = mulFactor(susdeCollateralValue, susdeInfo.borrowCollateralFactor);

      // Solve the same target HF formula for sUSDe.
      // It wants about $32.79 of sUSDe value, so sUSDe is partially seized.
      const wantedSusdeCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(susdeInfo.liquidationFactor, targetHealthFactor) - susdeInfo.borrowCollateralFactor.toBigInt());
      expect(wantedSusdeCollateralValue).to.be.lessThan(susdeCollateralValue);

      susdeSeizeAmount = divPrice(wantedSusdeCollateralValue, susdePrice, susdeInfo.scale);
      susdeSeizedValue = mulFactor(wantedSusdeCollateralValue, susdeInfo.liquidationFactor);
    });

    it('calculates newBalance after USDe and sUSDe reduce debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - susdeSeizedValue;
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', async () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address));

      expect(newBalance).to.be.greaterThan(oldBalance);
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('newPrincipal is equal to newBalance', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = (await comet.userBasic(alice.address)).principal;
      const expectedNewPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(newPrincipal).to.equal(expectedNewPrincipal);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 USDe token balance does not change during absorb', async () => {
      expect(await usdeAsset.balanceOf(comet.address)).to.be.equal(cometUsdeTokenBalanceBefore);
    });

    it('comet ERC20 sUSDe token balance does not change during absorb', async () => {
      expect(await susdeAsset.balanceOf(comet.address)).to.be.equal(cometSusdeTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice USDe collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, usdeAsset.address)).to.be.equal(0);
    });

    it('alice sUSDe collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, susdeAsset.address)).to.be.equal(susdeAmount - susdeSeizeAmount);
    });

    it('alice assetsIn remains zero', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved keeps only sUSDe', async () => {
      const susdeInfo = await comet.getAssetInfoByAddress(susdeAsset.address);

      expect((await comet.userBasic(alice.address))._reserved).to.not.be.equal(reservedBefore);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (susdeInfo.offset - 16));
    });

    it('comet total supplied USDe is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(usdeAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(usdeTotalsCollateralBefore.sub(usdeSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied sUSDe is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(susdeAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(susdeTotalsCollateralBefore.sub(susdeSeizeAmount));
      expect(totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet USDe collateral reserves increase by all seized USDe', async () => {
      expect(await comet.getCollateralReserves(usdeAsset.address)).to.be.equal(usdeCollateralReservesBefore.add(usdeSeizeAmount));
    });

    it('comet sUSDe collateral reserves increase by seized sUSDe', async () => {
      expect(await comet.getCollateralReserves(susdeAsset.address)).to.be.equal(susdeCollateralReservesBefore.add(susdeSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of asset index 10 then partial of asset index 20', function () {
    const ezETHAmount = exp(0.02, 18); // 0.02 ezETH, worth $67 before the price drop
    const opAmount = exp(40, 18);      // 40 OP, worth $80 before the price drop
    const borrowAmount = exp(80, 6);   // $80

    let ezETHAsset: FaucetToken;
    let opAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let ezETHTotalsCollateralBefore: BigNumber;
    let opTotalsCollateralBefore: BigNumber;
    let ezETHCollateralReservesBefore: BigNumber;
    let opCollateralReservesBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let ezETHSeizeAmount: bigint;
    let ezETHSeizedValue: bigint;
    let opSeizeAmount: bigint;
    let opSeizedValue: bigint;
    let cometEzETHTokenBalanceBefore: BigNumber;
    let cometOpTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      ezETHAsset = tokens['ezETH'];
      opAsset = tokens['OP'];

      await comet.connect(alice).supply(ezETHAsset.address, ezETHAmount);
      await comet.connect(alice).supply(opAsset.address, opAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop both assets by 25%. ezETH is now worth $50.25 and OP is worth $60.
      const ezETHPrice = (await priceFeeds['ezETH'].latestRoundData())[1].toBigInt();
      const opPrice = (await priceFeeds['OP'].latestRoundData())[1].toBigInt();
      await priceFeeds['ezETH'].connect(alice).setRoundData(0, ezETHPrice * 75n / 100n, 0, 0, 0);
      await priceFeeds['OP'].connect(alice).setRoundData(0, opPrice * 75n / 100n, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice ezETH collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ezETHAsset.address)).to.be.equal(ezETHAmount);
    });

    it('alice OP collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, opAsset.address)).to.be.equal(opAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn includes only ezETH', async () => {
      const ezETHInfo = await comet.getAssetInfoByAddress(ezETHAsset.address);

      expect(ezETHInfo.offset).to.be.equal(10);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(1 << ezETHInfo.offset);
    });

    it('alice reserved includes only OP', async () => {
      const opInfo = await comet.getAssetInfoByAddress(opAsset.address);

      expect(opInfo.offset).to.be.equal(20);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (opInfo.offset - 16));
    });

    it('comet total supplied ezETH is equal to alice supplied ezETH', async () => {
      ezETHTotalsCollateralBefore = (await comet.totalsCollateral(ezETHAsset.address)).totalSupplyAsset;
      expect(ezETHTotalsCollateralBefore).to.be.equal(ezETHAmount);
    });

    it('comet total supplied OP is equal to alice supplied OP', async () => {
      opTotalsCollateralBefore = (await comet.totalsCollateral(opAsset.address)).totalSupplyAsset;
      expect(opTotalsCollateralBefore).to.be.equal(opAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('collateral reserves are equal to zero', async () => {
      ezETHCollateralReservesBefore = await comet.getCollateralReserves(ezETHAsset.address);
      opCollateralReservesBefore = await comet.getCollateralReserves(opAsset.address);

      expect(ezETHCollateralReservesBefore).to.be.equal(0);
      expect(opCollateralReservesBefore).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('comet ERC20 ezETH token balance is equal to supplied ezETH before absorb', async () => {
      cometEzETHTokenBalanceBefore = await ezETHAsset.balanceOf(comet.address);
      expect(cometEzETHTokenBalanceBefore).to.be.equal(ezETHAmount);
    });

    it('comet ERC20 OP token balance is equal to supplied OP before absorb', async () => {
      cometOpTokenBalanceBefore = await opAsset.balanceOf(comet.address);
      expect(cometOpTokenBalanceBefore).to.be.equal(opAmount);
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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates ezETH full seizure values', async () => {
      const ezETHInfo = await comet.getAssetInfoByAddress(ezETHAsset.address);
      const opInfo = await comet.getAssetInfoByAddress(opAsset.address);
      const ezETHPrice = (await priceFeeds['ezETH'].latestRoundData())[1].toBigInt();
      const opPrice = (await priceFeeds['OP'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // ezETH is asset index 10. After the 25% price drop, 0.02 ezETH is worth $50.25.
      const ezETHCollateralValue = mulPrice(ezETHAmount, ezETHPrice, ezETHInfo.scale);
      const opCollateralValue = mulPrice(opAmount, opPrice, opInfo.scale);
      const totalCollateralizedValue =
        mulFactor(ezETHCollateralValue, ezETHInfo.borrowCollateralFactor) +
        mulFactor(opCollateralValue, opInfo.borrowCollateralFactor);

      // The target HF formula wants more than $50.25 from ezETH, so the first asset is fully seized.
      const wantedEzETHCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(ezETHInfo.liquidationFactor, targetHealthFactor) - ezETHInfo.borrowCollateralFactor.toBigInt());
      expect(wantedEzETHCollateralValue).to.be.greaterThan(ezETHCollateralValue);

      ezETHSeizeAmount = ezETHAmount;
      ezETHSeizedValue = mulFactor(ezETHCollateralValue, ezETHInfo.liquidationFactor);
    });

    it('calculates OP partial seizure values', async () => {
      const opInfo = await comet.getAssetInfoByAddress(opAsset.address);
      const opPrice = (await priceFeeds['OP'].latestRoundData())[1].toBigInt();
      const opCollateralValue = mulPrice(opAmount, opPrice, opInfo.scale);

      // After ezETH full seizure, debt is $80 − $45.73 = $34.27.
      debtRemainingValue -= ezETHSeizedValue;

      // OP is worth $60, with $33 of borrow-CF collateral value.
      const totalCollateralizedValue = mulFactor(opCollateralValue, opInfo.borrowCollateralFactor);

      // Solve the same target HF formula for OP.
      // It wants about $8.72 of OP value, so OP is partially seized.
      const wantedOPCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(opInfo.liquidationFactor, targetHealthFactor) - opInfo.borrowCollateralFactor.toBigInt());
      expect(wantedOPCollateralValue).to.be.lessThan(opCollateralValue);

      opSeizeAmount = divPrice(wantedOPCollateralValue, opPrice, opInfo.scale);
      opSeizedValue = mulFactor(wantedOPCollateralValue, opInfo.liquidationFactor);
    });

    it('calculates newBalance after ezETH and OP reduce debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - opSeizedValue;
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', async () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address));

      expect(newBalance).to.be.greaterThan(oldBalance);
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('newPrincipal is equal to newBalance', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = (await comet.userBasic(alice.address)).principal;
      const expectedNewPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(newPrincipal).to.equal(expectedNewPrincipal);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 ezETH token balance does not change during absorb', async () => {
      expect(await ezETHAsset.balanceOf(comet.address)).to.be.equal(cometEzETHTokenBalanceBefore);
    });

    it('comet ERC20 OP token balance does not change during absorb', async () => {
      expect(await opAsset.balanceOf(comet.address)).to.be.equal(cometOpTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice ezETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ezETHAsset.address)).to.be.equal(0);
    });

    it('alice OP collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, opAsset.address)).to.be.equal(opAmount - opSeizeAmount);
    });

    it('alice assetsIn is zero after ezETH is fully seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved is unchanged as OP still has remaining balance', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied ezETH is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(ezETHAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(ezETHTotalsCollateralBefore.sub(ezETHSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied OP is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(opAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(opTotalsCollateralBefore.sub(opSeizeAmount));
      expect(totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ezETH collateral reserves increase by all seized ezETH', async () => {
      expect(await comet.getCollateralReserves(ezETHAsset.address)).to.be.equal(ezETHCollateralReservesBefore.add(ezETHSeizeAmount));
    });

    it('comet OP collateral reserves increase by seized OP', async () => {
      expect(await comet.getCollateralReserves(opAsset.address)).to.be.equal(opCollateralReservesBefore.add(opSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of asset indexes 3, 6, 7, 17 then partial of asset index 21', function () {
    const wbtcAmount = exp(0.0001, 8);  // 0.0001 WBTC, worth $6.50 before the price drop
    const rsETHAmount = exp(0.001, 18); // 0.001 rsETH, worth $3.40 before the price drop
    const cbETHAmount = exp(0.001, 18); // 0.001 cbETH, worth $3.30 before the price drop
    const crvAmount = exp(3, 18);       // 3 CRV, worth $3.00 before the price drop
    const gmxAmount = exp(6, 18);       // 6 GMX, worth $240 before the price drop
    const borrowAmount = exp(80, 6);    // $80

    let wbtcAsset: FaucetToken;
    let rsETHAsset: FaucetToken;
    let cbETHAsset: FaucetToken;
    let crvAsset: FaucetToken;
    let gmxAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let wbtcTotalsCollateralBefore: BigNumber;
    let rsETHTotalsCollateralBefore: BigNumber;
    let cbETHTotalsCollateralBefore: BigNumber;
    let crvTotalsCollateralBefore: BigNumber;
    let gmxTotalsCollateralBefore: BigNumber;
    let wbtcCollateralReservesBefore: BigNumber;
    let rsETHCollateralReservesBefore: BigNumber;
    let cbETHCollateralReservesBefore: BigNumber;
    let crvCollateralReservesBefore: BigNumber;
    let gmxCollateralReservesBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let wbtcSeizedValue: bigint;
    let rsETHSeizedValue: bigint;
    let cbETHSeizedValue: bigint;
    let crvSeizedValue: bigint;
    let gmxSeizeAmount: bigint;
    let gmxSeizedValue: bigint;
    let cometWbtcTokenBalanceBefore: BigNumber;
    let cometRsETHTokenBalanceBefore: BigNumber;
    let cometCbETHTokenBalanceBefore: BigNumber;
    let cometCrvTokenBalanceBefore: BigNumber;
    let cometGmxTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      wbtcAsset = tokens['WBTC'];
      rsETHAsset = tokens['rsETH'];
      cbETHAsset = tokens['cbETH'];
      crvAsset = tokens['CRV'];
      gmxAsset = tokens['GMX'];

      await comet.connect(alice).supply(wbtcAsset.address, wbtcAmount);
      await comet.connect(alice).supply(rsETHAsset.address, rsETHAmount);
      await comet.connect(alice).supply(cbETHAsset.address, cbETHAmount);
      await comet.connect(alice).supply(crvAsset.address, crvAmount);
      await comet.connect(alice).supply(gmxAsset.address, gmxAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop all five assets by 50%.
      const wbtcPrice = (await priceFeeds['WBTC'].latestRoundData())[1].toBigInt();
      const rsETHPrice = (await priceFeeds['rsETH'].latestRoundData())[1].toBigInt();
      const cbETHPrice = (await priceFeeds['cbETH'].latestRoundData())[1].toBigInt();
      const crvPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
      const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();
      await priceFeeds['WBTC'].connect(alice).setRoundData(0, wbtcPrice * 50n / 100n, 0, 0, 0);
      await priceFeeds['rsETH'].connect(alice).setRoundData(0, rsETHPrice * 50n / 100n, 0, 0, 0);
      await priceFeeds['cbETH'].connect(alice).setRoundData(0, cbETHPrice * 50n / 100n, 0, 0, 0);
      await priceFeeds['CRV'].connect(alice).setRoundData(0, crvPrice * 50n / 100n, 0, 0, 0);
      await priceFeeds['GMX'].connect(alice).setRoundData(0, gmxPrice * 50n / 100n, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice WBTC collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wbtcAsset.address)).to.be.equal(wbtcAmount);
    });

    it('alice rsETH collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, rsETHAsset.address)).to.be.equal(rsETHAmount);
    });

    it('alice cbETH collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, cbETHAsset.address)).to.be.equal(cbETHAmount);
    });

    it('alice CRV collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, crvAsset.address)).to.be.equal(crvAmount);
    });

    it('alice GMX collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, gmxAsset.address)).to.be.equal(gmxAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn includes WBTC, rsETH, and cbETH', async () => {
      const wbtcInfo = await comet.getAssetInfoByAddress(wbtcAsset.address);
      const rsETHInfo = await comet.getAssetInfoByAddress(rsETHAsset.address);
      const cbETHInfo = await comet.getAssetInfoByAddress(cbETHAsset.address);
      const expectedAssetsIn = (1 << wbtcInfo.offset) | (1 << rsETHInfo.offset) | (1 << cbETHInfo.offset);

      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved includes CRV and GMX', async () => {
      const crvInfo = await comet.getAssetInfoByAddress(crvAsset.address);
      const gmxInfo = await comet.getAssetInfoByAddress(gmxAsset.address);
      const expectedReserved = (1 << (crvInfo.offset - 16)) | (1 << (gmxInfo.offset - 16));

      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    it('comet total supplied WBTC is equal to alice supplied WBTC', async () => {
      wbtcTotalsCollateralBefore = (await comet.totalsCollateral(wbtcAsset.address)).totalSupplyAsset;
      expect(wbtcTotalsCollateralBefore).to.be.equal(wbtcAmount);
    });

    it('comet total supplied rsETH is equal to alice supplied rsETH', async () => {
      rsETHTotalsCollateralBefore = (await comet.totalsCollateral(rsETHAsset.address)).totalSupplyAsset;
      expect(rsETHTotalsCollateralBefore).to.be.equal(rsETHAmount);
    });

    it('comet total supplied cbETH is equal to alice supplied cbETH', async () => {
      cbETHTotalsCollateralBefore = (await comet.totalsCollateral(cbETHAsset.address)).totalSupplyAsset;
      expect(cbETHTotalsCollateralBefore).to.be.equal(cbETHAmount);
    });

    it('comet total supplied CRV is equal to alice supplied CRV', async () => {
      crvTotalsCollateralBefore = (await comet.totalsCollateral(crvAsset.address)).totalSupplyAsset;
      expect(crvTotalsCollateralBefore).to.be.equal(crvAmount);
    });

    it('comet total supplied GMX is equal to alice supplied GMX', async () => {
      gmxTotalsCollateralBefore = (await comet.totalsCollateral(gmxAsset.address)).totalSupplyAsset;
      expect(gmxTotalsCollateralBefore).to.be.equal(gmxAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('collateral reserves are equal to zero', async () => {
      wbtcCollateralReservesBefore = await comet.getCollateralReserves(wbtcAsset.address);
      rsETHCollateralReservesBefore = await comet.getCollateralReserves(rsETHAsset.address);
      cbETHCollateralReservesBefore = await comet.getCollateralReserves(cbETHAsset.address);
      crvCollateralReservesBefore = await comet.getCollateralReserves(crvAsset.address);
      gmxCollateralReservesBefore = await comet.getCollateralReserves(gmxAsset.address);

      expect(wbtcCollateralReservesBefore).to.be.equal(0);
      expect(rsETHCollateralReservesBefore).to.be.equal(0);
      expect(cbETHCollateralReservesBefore).to.be.equal(0);
      expect(crvCollateralReservesBefore).to.be.equal(0);
      expect(gmxCollateralReservesBefore).to.be.equal(0);
    });

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('comet ERC20 WBTC token balance is equal to supplied WBTC before absorb', async () => {
      cometWbtcTokenBalanceBefore = await wbtcAsset.balanceOf(comet.address);
      expect(cometWbtcTokenBalanceBefore).to.be.equal(wbtcAmount);
    });

    it('comet ERC20 rsETH token balance is equal to supplied rsETH before absorb', async () => {
      cometRsETHTokenBalanceBefore = await rsETHAsset.balanceOf(comet.address);
      expect(cometRsETHTokenBalanceBefore).to.be.equal(rsETHAmount);
    });

    it('comet ERC20 cbETH token balance is equal to supplied cbETH before absorb', async () => {
      cometCbETHTokenBalanceBefore = await cbETHAsset.balanceOf(comet.address);
      expect(cometCbETHTokenBalanceBefore).to.be.equal(cbETHAmount);
    });

    it('comet ERC20 CRV token balance is equal to supplied CRV before absorb', async () => {
      cometCrvTokenBalanceBefore = await crvAsset.balanceOf(comet.address);
      expect(cometCrvTokenBalanceBefore).to.be.equal(crvAmount);
    });

    it('comet ERC20 GMX token balance is equal to supplied GMX before absorb', async () => {
      cometGmxTokenBalanceBefore = await gmxAsset.balanceOf(comet.address);
      expect(cometGmxTokenBalanceBefore).to.be.equal(gmxAmount);
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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates WBTC full seizure values', async () => {
      const wbtcInfo = await comet.getAssetInfoByAddress(wbtcAsset.address);
      const rsETHInfo = await comet.getAssetInfoByAddress(rsETHAsset.address);
      const cbETHInfo = await comet.getAssetInfoByAddress(cbETHAsset.address);
      const crvInfo = await comet.getAssetInfoByAddress(crvAsset.address);
      const gmxInfo = await comet.getAssetInfoByAddress(gmxAsset.address);
      const wbtcPrice = (await priceFeeds['WBTC'].latestRoundData())[1].toBigInt();
      const rsETHPrice = (await priceFeeds['rsETH'].latestRoundData())[1].toBigInt();
      const cbETHPrice = (await priceFeeds['cbETH'].latestRoundData())[1].toBigInt();
      const crvPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
      const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // WBTC is asset index 3. After the 50% price drop, 0.0001 WBTC is worth $3.25.
      const wbtcCollateralValue = mulPrice(wbtcAmount, wbtcPrice, wbtcInfo.scale);
      const rsETHCollateralValue = mulPrice(rsETHAmount, rsETHPrice, rsETHInfo.scale);
      const cbETHCollateralValue = mulPrice(cbETHAmount, cbETHPrice, cbETHInfo.scale);
      const crvCollateralValue = mulPrice(crvAmount, crvPrice, crvInfo.scale);
      const gmxCollateralValue = mulPrice(gmxAmount, gmxPrice, gmxInfo.scale);
      const totalCollateralizedValue =
        mulFactor(wbtcCollateralValue, wbtcInfo.borrowCollateralFactor) +
        mulFactor(rsETHCollateralValue, rsETHInfo.borrowCollateralFactor) +
        mulFactor(cbETHCollateralValue, cbETHInfo.borrowCollateralFactor) +
        mulFactor(crvCollateralValue, crvInfo.borrowCollateralFactor) +
        mulFactor(gmxCollateralValue, gmxInfo.borrowCollateralFactor);

      // The target HF formula wants more than $3.25 from WBTC, so WBTC is fully seized.
      const wantedWbtcCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wbtcInfo.liquidationFactor, targetHealthFactor) - wbtcInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWbtcCollateralValue).to.be.greaterThan(wbtcCollateralValue);

      wbtcSeizedValue = mulFactor(wbtcCollateralValue, wbtcInfo.liquidationFactor);
    });

    it('calculates rsETH full seizure values', async () => {
      const rsETHInfo = await comet.getAssetInfoByAddress(rsETHAsset.address);
      const cbETHInfo = await comet.getAssetInfoByAddress(cbETHAsset.address);
      const crvInfo = await comet.getAssetInfoByAddress(crvAsset.address);
      const gmxInfo = await comet.getAssetInfoByAddress(gmxAsset.address);
      const rsETHPrice = (await priceFeeds['rsETH'].latestRoundData())[1].toBigInt();
      const cbETHPrice = (await priceFeeds['cbETH'].latestRoundData())[1].toBigInt();
      const crvPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
      const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();

      // After WBTC full seizure, debt reduces.
      debtRemainingValue -= wbtcSeizedValue;

      // rsETH is asset index 6. After the 50% price drop, 0.001 rsETH is worth $1.70.
      const rsETHCollateralValue = mulPrice(rsETHAmount, rsETHPrice, rsETHInfo.scale);
      const cbETHCollateralValue = mulPrice(cbETHAmount, cbETHPrice, cbETHInfo.scale);
      const crvCollateralValue = mulPrice(crvAmount, crvPrice, crvInfo.scale);
      const gmxCollateralValue = mulPrice(gmxAmount, gmxPrice, gmxInfo.scale);
      const totalCollateralizedValue =
        mulFactor(rsETHCollateralValue, rsETHInfo.borrowCollateralFactor) +
        mulFactor(cbETHCollateralValue, cbETHInfo.borrowCollateralFactor) +
        mulFactor(crvCollateralValue, crvInfo.borrowCollateralFactor) +
        mulFactor(gmxCollateralValue, gmxInfo.borrowCollateralFactor);

      // The target HF formula wants more than $1.70 from rsETH, so rsETH is fully seized.
      const wantedRsETHCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(rsETHInfo.liquidationFactor, targetHealthFactor) - rsETHInfo.borrowCollateralFactor.toBigInt());
      expect(wantedRsETHCollateralValue).to.be.greaterThan(rsETHCollateralValue);

      rsETHSeizedValue = mulFactor(rsETHCollateralValue, rsETHInfo.liquidationFactor);
    });

    it('calculates cbETH full seizure values', async () => {
      const cbETHInfo = await comet.getAssetInfoByAddress(cbETHAsset.address);
      const crvInfo = await comet.getAssetInfoByAddress(crvAsset.address);
      const gmxInfo = await comet.getAssetInfoByAddress(gmxAsset.address);
      const cbETHPrice = (await priceFeeds['cbETH'].latestRoundData())[1].toBigInt();
      const crvPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
      const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();

      // After rsETH full seizure, debt reduces further.
      debtRemainingValue -= rsETHSeizedValue;

      // cbETH is asset index 7. After the 50% price drop, 0.001 cbETH is worth $1.65.
      const cbETHCollateralValue = mulPrice(cbETHAmount, cbETHPrice, cbETHInfo.scale);
      const crvCollateralValue = mulPrice(crvAmount, crvPrice, crvInfo.scale);
      const gmxCollateralValue = mulPrice(gmxAmount, gmxPrice, gmxInfo.scale);
      const totalCollateralizedValue =
        mulFactor(cbETHCollateralValue, cbETHInfo.borrowCollateralFactor) +
        mulFactor(crvCollateralValue, crvInfo.borrowCollateralFactor) +
        mulFactor(gmxCollateralValue, gmxInfo.borrowCollateralFactor);

      // The target HF formula wants more than $1.65 from cbETH, so cbETH is fully seized.
      const wantedCbETHCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(cbETHInfo.liquidationFactor, targetHealthFactor) - cbETHInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCbETHCollateralValue).to.be.greaterThan(cbETHCollateralValue);

      cbETHSeizedValue = mulFactor(cbETHCollateralValue, cbETHInfo.liquidationFactor);
    });

    it('calculates CRV full seizure values', async () => {
      const crvInfo = await comet.getAssetInfoByAddress(crvAsset.address);
      const gmxInfo = await comet.getAssetInfoByAddress(gmxAsset.address);
      const crvPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
      const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();

      // After cbETH full seizure, debt reduces further.
      debtRemainingValue -= cbETHSeizedValue;

      // CRV is asset index 17. After the 50% price drop, 3 CRV is worth $1.50.
      const crvCollateralValue = mulPrice(crvAmount, crvPrice, crvInfo.scale);
      const gmxCollateralValue = mulPrice(gmxAmount, gmxPrice, gmxInfo.scale);
      const totalCollateralizedValue =
        mulFactor(crvCollateralValue, crvInfo.borrowCollateralFactor) +
        mulFactor(gmxCollateralValue, gmxInfo.borrowCollateralFactor);

      // The target HF formula wants more than $1.50 from CRV, so CRV is fully seized.
      const wantedCrvCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(crvInfo.liquidationFactor, targetHealthFactor) - crvInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCrvCollateralValue).to.be.greaterThan(crvCollateralValue);

      crvSeizedValue = mulFactor(crvCollateralValue, crvInfo.liquidationFactor);
    });

    it('calculates GMX partial seizure values', async () => {
      const gmxInfo = await comet.getAssetInfoByAddress(gmxAsset.address);
      const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();
      const gmxCollateralValue = mulPrice(gmxAmount, gmxPrice, gmxInfo.scale);

      // After CRV full seizure, debt reduces to about $72.79.
      debtRemainingValue -= crvSeizedValue;

      // GMX is worth $120, with $60 of borrow-CF collateral value.
      const totalCollateralizedValue = mulFactor(gmxCollateralValue, gmxInfo.borrowCollateralFactor);

      // Solve the same target HF formula for GMX.
      // It wants about $45.52 of GMX value, so GMX is partially seized.
      const wantedGmxCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(gmxInfo.liquidationFactor, targetHealthFactor) - gmxInfo.borrowCollateralFactor.toBigInt());
      expect(wantedGmxCollateralValue).to.be.lessThan(gmxCollateralValue);

      gmxSeizeAmount = divPrice(wantedGmxCollateralValue, gmxPrice, gmxInfo.scale);
      gmxSeizedValue = mulFactor(wantedGmxCollateralValue, gmxInfo.liquidationFactor);
    });

    it('calculates newBalance after all five assets reduce debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - gmxSeizedValue;
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
    });

    it('newBalance remains negative after partial liquidation', async () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative and matches alice borrow balance', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address));

      expect(newBalance).to.be.greaterThan(oldBalance);
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('newPrincipal is equal to newBalance', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = (await comet.userBasic(alice.address)).principal;
      const expectedNewPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(newPrincipal).to.equal(expectedNewPrincipal);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('comet ERC20 WBTC token balance does not change during absorb', async () => {
      expect(await wbtcAsset.balanceOf(comet.address)).to.be.equal(cometWbtcTokenBalanceBefore);
    });

    it('comet ERC20 rsETH token balance does not change during absorb', async () => {
      expect(await rsETHAsset.balanceOf(comet.address)).to.be.equal(cometRsETHTokenBalanceBefore);
    });

    it('comet ERC20 cbETH token balance does not change during absorb', async () => {
      expect(await cbETHAsset.balanceOf(comet.address)).to.be.equal(cometCbETHTokenBalanceBefore);
    });

    it('comet ERC20 CRV token balance does not change during absorb', async () => {
      expect(await crvAsset.balanceOf(comet.address)).to.be.equal(cometCrvTokenBalanceBefore);
    });

    it('comet ERC20 GMX token balance does not change during absorb', async () => {
      expect(await gmxAsset.balanceOf(comet.address)).to.be.equal(cometGmxTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice WBTC collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wbtcAsset.address)).to.be.equal(0);
    });

    it('alice rsETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, rsETHAsset.address)).to.be.equal(0);
    });

    it('alice cbETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, cbETHAsset.address)).to.be.equal(0);
    });

    it('alice CRV collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, crvAsset.address)).to.be.equal(0);
    });

    it('alice GMX collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, gmxAsset.address)).to.be.equal(gmxAmount - gmxSeizeAmount);
    });

    it('alice assetsIn is zero after WBTC, rsETH, and cbETH are fully seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved keeps only GMX after CRV is fully seized', async () => {
      const gmxInfo = await comet.getAssetInfoByAddress(gmxAsset.address);

      expect((await comet.userBasic(alice.address))._reserved).to.not.be.equal(reservedBefore);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (gmxInfo.offset - 16));
    });

    it('comet total supplied WBTC is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(wbtcAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(wbtcTotalsCollateralBefore.sub(wbtcAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied rsETH is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(rsETHAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(rsETHTotalsCollateralBefore.sub(rsETHAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied cbETH is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(cbETHAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(cbETHTotalsCollateralBefore.sub(cbETHAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied CRV is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(crvAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(crvTotalsCollateralBefore.sub(crvAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied GMX is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(gmxAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(gmxTotalsCollateralBefore.sub(gmxSeizeAmount));
      expect(totalSupplyAsset).to.not.be.equal(0);
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet WBTC collateral reserves increase by all seized WBTC', async () => {
      expect(await comet.getCollateralReserves(wbtcAsset.address)).to.be.equal(wbtcCollateralReservesBefore.add(wbtcAmount));
    });

    it('comet rsETH collateral reserves increase by all seized rsETH', async () => {
      expect(await comet.getCollateralReserves(rsETHAsset.address)).to.be.equal(rsETHCollateralReservesBefore.add(rsETHAmount));
    });

    it('comet cbETH collateral reserves increase by all seized cbETH', async () => {
      expect(await comet.getCollateralReserves(cbETHAsset.address)).to.be.equal(cbETHCollateralReservesBefore.add(cbETHAmount));
    });

    it('comet CRV collateral reserves increase by all seized CRV', async () => {
      expect(await comet.getCollateralReserves(crvAsset.address)).to.be.equal(crvCollateralReservesBefore.add(crvAmount));
    });

    it('comet GMX collateral reserves increase by seized GMX', async () => {
      expect(await comet.getCollateralReserves(gmxAsset.address)).to.be.equal(gmxCollateralReservesBefore.add(gmxSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  // Mirrors the 5-asset setup above but validates only the AbsorbCollateral events,
  // one per asset (4 full seizures + 1 partial), to keep event and storage assertions separate.
  context('multi-collateral: AbsorbCollateral events for full seizure of assets 3, 6, 7, 17 and partial seizure of asset 21', function () {
    const wbtcAmount = exp(0.0001, 8);  // 0.0001 WBTC, worth $6.50 before the price drop
    const rsETHAmount = exp(0.001, 18); // 0.001 rsETH, worth $3.40 before the price drop
    const cbETHAmount = exp(0.001, 18); // 0.001 cbETH, worth $3.30 before the price drop
    const crvAmount = exp(3, 18);       // 3 CRV, worth $3.00 before the price drop
    const gmxAmount = exp(6, 18);       // 6 GMX, worth $240 before the price drop
    const borrowAmount = exp(80, 6);    // $80

    let wbtcAsset: FaucetToken;
    let rsETHAsset: FaucetToken;
    let cbETHAsset: FaucetToken;
    let crvAsset: FaucetToken;
    let gmxAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let wbtcSeizeAmount: bigint;
    let rsETHSeizeAmount: bigint;
    let cbETHSeizeAmount: bigint;
    let crvSeizeAmount: bigint;
    let gmxSeizeAmount: bigint;
    let wbtcUsdValue: bigint;
    let rsETHUsdValue: bigint;
    let cbETHUsdValue: bigint;
    let crvUsdValue: bigint;
    let gmxUsdValue: bigint;

    before(async function() {
      wbtcAsset = tokens['WBTC'];
      rsETHAsset = tokens['rsETH'];
      cbETHAsset = tokens['cbETH'];
      crvAsset = tokens['CRV'];
      gmxAsset = tokens['GMX'];

      await comet.connect(alice).supply(wbtcAsset.address, wbtcAmount);
      await comet.connect(alice).supply(rsETHAsset.address, rsETHAmount);
      await comet.connect(alice).supply(cbETHAsset.address, cbETHAmount);
      await comet.connect(alice).supply(crvAsset.address, crvAmount);
      await comet.connect(alice).supply(gmxAsset.address, gmxAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      const wbtcInitialPrice = (await priceFeeds['WBTC'].latestRoundData())[1].toBigInt();
      const rsETHInitialPrice = (await priceFeeds['rsETH'].latestRoundData())[1].toBigInt();
      const cbETHInitialPrice = (await priceFeeds['cbETH'].latestRoundData())[1].toBigInt();
      const crvInitialPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
      const gmxInitialPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();
      await priceFeeds['WBTC'].connect(alice).setRoundData(0, wbtcInitialPrice * 50n / 100n, 0, 0, 0);
      await priceFeeds['rsETH'].connect(alice).setRoundData(0, rsETHInitialPrice * 50n / 100n, 0, 0, 0);
      await priceFeeds['cbETH'].connect(alice).setRoundData(0, cbETHInitialPrice * 50n / 100n, 0, 0, 0);
      await priceFeeds['CRV'].connect(alice).setRoundData(0, crvInitialPrice * 50n / 100n, 0, 0, 0);
      await priceFeeds['GMX'].connect(alice).setRoundData(0, gmxInitialPrice * 50n / 100n, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // Note: caluclations are taken from the previos test case, so we can reuse the values.
      const wbtcInfo = await comet.getAssetInfoByAddress(wbtcAsset.address);
      const rsETHInfo = await comet.getAssetInfoByAddress(rsETHAsset.address);
      const cbETHInfo = await comet.getAssetInfoByAddress(cbETHAsset.address);
      const crvInfo = await comet.getAssetInfoByAddress(crvAsset.address);
      const gmxInfo = await comet.getAssetInfoByAddress(gmxAsset.address);

      const wbtcPrice = wbtcInitialPrice * 50n / 100n;
      const rsETHPrice = rsETHInitialPrice * 50n / 100n;
      const cbETHPrice = cbETHInitialPrice * 50n / 100n;
      const crvPrice = crvInitialPrice * 50n / 100n;
      const gmxPrice = gmxInitialPrice * 50n / 100n;

      // Full seizures: wantedCollateralValue (emitted in event) = mulPrice(amount, price, scale).
      const wbtcCollateralValue = mulPrice(wbtcAmount, wbtcPrice, wbtcInfo.scale);
      const rsETHCollateralValue = mulPrice(rsETHAmount, rsETHPrice, rsETHInfo.scale);
      const cbETHCollateralValue = mulPrice(cbETHAmount, cbETHPrice, cbETHInfo.scale);
      const crvCollateralValue = mulPrice(crvAmount, crvPrice, crvInfo.scale);
      const gmxCollateralValue = mulPrice(gmxAmount, gmxPrice, gmxInfo.scale);

      wbtcSeizeAmount = wbtcAmount;
      wbtcUsdValue = wbtcCollateralValue;
      rsETHSeizeAmount = rsETHAmount;
      rsETHUsdValue = rsETHCollateralValue;
      cbETHSeizeAmount = cbETHAmount;
      cbETHUsdValue = cbETHCollateralValue;
      crvSeizeAmount = crvAmount;
      crvUsdValue = crvCollateralValue;

      // GMX partial seizure: wantedCollateralValue comes directly from the target-HF formula
      // and is emitted as-is — _processDebtClosing is not entered since remaining debt > minDebtValue.
      // debtRemainingValue = (debt value) - (LF-weighted value of each fully seized asset)
      // debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale) - LF * wbtcCollateralValue - ...
      let debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      debtRemainingValue -= mulFactor(wbtcCollateralValue, wbtcInfo.liquidationFactor);
      debtRemainingValue -= mulFactor(rsETHCollateralValue, rsETHInfo.liquidationFactor);
      debtRemainingValue -= mulFactor(cbETHCollateralValue, cbETHInfo.liquidationFactor);
      debtRemainingValue -= mulFactor(crvCollateralValue, crvInfo.liquidationFactor);

      // At GMX's turn, totalCollateralizedValue in the contract holds only GMX's BCF contribution.
      const totalCollateralizedValue = mulFactor(gmxCollateralValue, gmxInfo.borrowCollateralFactor);
      // S = (targetHF * debt - totalCollateralValue) / (targetHF * LF - BCF)
      const wantedGmxCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(gmxInfo.liquidationFactor, targetHealthFactor) - gmxInfo.borrowCollateralFactor.toBigInt());
      gmxSeizeAmount = divPrice(wantedGmxCollateralValue, gmxPrice, gmxInfo.scale);
      gmxUsdValue = wantedGmxCollateralValue;

      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('AbsorbCollateral event is emitted for WBTC full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        wbtcAsset.address,
        wbtcSeizeAmount,
        wbtcUsdValue
      );
    });

    it('AbsorbCollateral event is emitted for rsETH full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        rsETHAsset.address,
        rsETHSeizeAmount,
        rsETHUsdValue
      );
    });

    it('AbsorbCollateral event is emitted for cbETH full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        cbETHAsset.address,
        cbETHSeizeAmount,
        cbETHUsdValue
      );
    });

    it('AbsorbCollateral event is emitted for CRV full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        crvAsset.address,
        crvSeizeAmount,
        crvUsdValue
      );
    });

    it('AbsorbCollateral event is emitted for GMX partial seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        gmxAsset.address,
        gmxSeizeAmount,
        gmxUsdValue
      );
    });
  });

  // Note: this test flow covers event AbsorbCollateral emission when 
  // the collateral is partially seized when debt is below min debt as a special case.
  context('1 collateral: debt below min debt and collateral can partially cover it', function () {
    const collateralAmount = exp(0.13, 18); // 0.13 COMP, worth $13 before the price drop
    const borrowAmount = exp(10.2, 6); // $10.20, initially above baseBorrowMin
    const repayAmount = exp(0.7, 6); // leaves $9.50 debt, below baseBorrowMin
    const droppedCompPrice = exp(85.9, 8); // collateral value becomes $11.167

    let collateralAsset: FaucetToken;
    let totalsCollateralBefore: BigNumber;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
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
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      collateralAsset = tokens['COMP'];

      await comet.connect(alice).supply(collateralAsset.address, collateralAmount);
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

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(collateralAmount);
    });

    it('alice borrow balance is below baseBorrowMin after repay', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount - repayAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.lessThan(baseBorrowMin);
    });

    it('alice assets in is equal to 1', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const expectedAssetsIn = 1 << assetInfo.offset;

      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved is equal to 0', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied collateral amount is equal to alice supplied amount', async () => {
      totalsCollateralBefore = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;
      expect(totalsCollateralBefore).to.be.equal(collateralAmount);
    });

    it('comet total borrow base is equal to alice remaining borrow', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount - repayAmount);
    });

    it('collateral reserves are equal to zero', async () => {
      collateralReservesBefore = await comet.getCollateralReserves(collateralAsset.address);
      expect(collateralReservesBefore).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance is equal to supplied collateral before absorb', async () => {
      cometCollateralTokenBalanceBefore = await collateralAsset.balanceOf(comet.address);
      expect(cometCollateralTokenBalanceBefore).to.be.equal(collateralAmount);
    });

    it('comet ERC20 base token balance reflects borrow and partial repay before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount + repayAmount);
    });

    it('min debt branch can close the debt by partially seizing COMP', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
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

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.be.not.be.reverted;
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

    it('AbsorbCollateral event is emitted', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        collateralAsset.address,
        seizeAmount,
        wantedCollateralValue
      );
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(collateralAmount - seizeAmount);
    });

    it('alice assetsIn does not change because collateral remains', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
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
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
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

    let compAsset: FaucetToken;
    let wethAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let compTotalsCollateralBefore: BigNumber;
    let wethTotalsCollateralBefore: BigNumber;
    let compCollateralReservesBefore: BigNumber;
    let wethCollateralReservesBefore: BigNumber;
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
    let cometCompTokenBalanceBefore: BigNumber;
    let cometWethTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      compAsset = tokens['COMP'];
      wethAsset = tokens['WETH'];

      await comet.connect(alice).supply(compAsset.address, compAmount);
      await comet.connect(alice).supply(wethAsset.address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['WETH'].connect(alice).setRoundData(0, droppedWethPrice, 0, 0, 0);
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

    it('alice borrow balance is above baseBorrowMin before absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(baseBorrowMin);
    });

    it('alice assets in includes COMP and WETH', async () => {
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

    it('collateral reserves are equal to zero', async () => {
      compCollateralReservesBefore = await comet.getCollateralReserves(compAsset.address);
      wethCollateralReservesBefore = await comet.getCollateralReserves(wethAsset.address);

      expect(compCollateralReservesBefore).to.be.equal(0);
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

    it('calculates COMP full seizure values', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
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
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
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

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.be.not.be.reverted;
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

    // Note: we keep event validation as this is not default behavior case.
    it('AbsorbCollateral event is emitted for COMP full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        compAsset.address,
        compSeizeAmount,
        compWantedCollateralValue
      );
    });

    // Note: we keep event validation as this is not default behavior case.
    it('AbsorbCollateral event is emitted for WETH partial seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        wethAsset.address,
        wethSeizeAmount,
        wethWantedCollateralValue
      );
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

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(wethAmount - wethSeizeAmount);
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.greaterThan(0); // to prevent zero balance case
    });

    it('alice assetsIn keeps only WETH', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);

      expect((await comet.userBasic(alice.address)).assetsIn).to.not.be.equal(assetsInBefore);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(1 << wethInfo.offset);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied COMP is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(compAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(compTotalsCollateralBefore.sub(compSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(wethTotalsCollateralBefore.sub(wethSeizeAmount));
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
      expect(await comet.getCollateralReserves(compAsset.address)).to.be.equal(compCollateralReservesBefore.add(compSeizeAmount));
    });

    it('comet WETH collateral reserves increase by seized WETH', async () => {
      expect(await comet.getCollateralReserves(wethAsset.address)).to.be.equal(wethCollateralReservesBefore.add(wethSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  // Note: this flow leaves less than 10 price wei after all collateral is seized.
  // The debt dust is too small to represent as USDC principal, so absorb closes the account.
  context('multi-collateral: first collateral fully seized, second collateral leaves debt dust below 10 wei', function () {
    const compAmount = exp(0.1, 18); // 0.1 COMP, worth $10
    const wethAmount = exp(0.007037037, 18, 9); // WETH LF-weighted value becomes $9.49999995
    const borrowAmount = exp(18.5, 6); // leaves $9.50 debt after COMP full seizure
    const droppedWethPrice = exp(1500, 8);

    let compAsset: FaucetToken;
    let wethAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let compTotalsCollateralBefore: BigNumber;
    let wethTotalsCollateralBefore: BigNumber;
    let compCollateralReservesBefore: BigNumber;
    let wethCollateralReservesBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let residualDebtValue: bigint;
    let compSeizeAmount: bigint;
    let compSeizedValue: bigint;
    let compWantedCollateralValue: bigint;
    let wethSeizeAmount: bigint;
    let wethSeizedValue: bigint;
    let wethWantedCollateralValue: bigint;
    let cometCompTokenBalanceBefore: BigNumber;
    let cometWethTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      compAsset = tokens['COMP'];
      wethAsset = tokens['WETH'];

      await comet.connect(alice).supply(compAsset.address, compAmount);
      await comet.connect(alice).supply(wethAsset.address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['WETH'].connect(alice).setRoundData(0, droppedWethPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
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

    it('alice borrow balance is above baseBorrowMin before absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(baseBorrowMin);
    });

    it('alice assets in includes COMP and WETH', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const expectedAssetsIn = (1 << compInfo.offset) | (1 << wethInfo.offset);

      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
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

    it('collateral reserves are equal to zero', async () => {
      compCollateralReservesBefore = await comet.getCollateralReserves(compAsset.address);
      wethCollateralReservesBefore = await comet.getCollateralReserves(wethAsset.address);

      expect(compCollateralReservesBefore).to.be.equal(0);
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

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates COMP full seizure values', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);

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

    it('calculates WETH full seizure values that leave less than 10 wei of debt value', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // COMP full seizure covers $9, leaving $9.50 debt, below the $10 baseBorrowMin.
      debtRemainingValue -= compSeizedValue;
      expect(debtRemainingValue).to.be.lessThan(minDebtValue);

      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const wethCollateralValueLeft = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);

      // WETH almost closes the remaining $9.50 debt, but is short by 5 price wei.
      expect(wethCollateralValueLeft).to.be.lessThan(debtRemainingValue);

      wethSeizeAmount = wethAmount;
      wethWantedCollateralValue = wethCollateralValue;
      wethSeizedValue = wethCollateralValueLeft;
      residualDebtValue = debtRemainingValue - wethSeizedValue;
      expect(residualDebtValue).to.be.lessThan(10n);
    });

    it('residualDebtValue is positive and less than 10 wei', async () => {
      expect(residualDebtValue).to.be.greaterThan(0n);
      expect(residualDebtValue).to.be.lessThan(10n);
    });

    it('debt dust rounds down to zero base units', async () => {
      newBalance = -(residualDebtValue * baseScale / baseTokenPrice);

      // newBalance is negative and less than 10 wei, so it rounds down to zero.
      expect(newBalance).to.be.equal(0n);
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

    // Note: we keep event validation as this is not default behavior case.
    it('AbsorbCollateral event is emitted for COMP full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        compAsset.address,
        compSeizeAmount,
        compWantedCollateralValue
      );
    });

    // Note: we keep event validation as this is not default behavior case.
    it('AbsorbCollateral event is emitted for WETH full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        wethAsset.address,
        wethSeizeAmount,
        wethWantedCollateralValue
      );
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

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(0);
    });

    it('alice assetsIn is zero after all collateral is seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied COMP is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(compAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(compTotalsCollateralBefore.sub(compSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(wethTotalsCollateralBefore.sub(wethSeizeAmount));
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
      expect(await comet.getCollateralReserves(compAsset.address)).to.be.equal(compCollateralReservesBefore.add(compSeizeAmount));
    });

    it('comet WETH collateral reserves increase by all seized WETH', async () => {
      expect(await comet.getCollateralReserves(wethAsset.address)).to.be.equal(wethCollateralReservesBefore.add(wethSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  // Note: this flow covers the minDebt guard inside the formula branch.
  // The formula's target-HF partial seizure would leave remaining debt below
  // baseBorrowMin, so the guard redirects to _processDebtClosing which
  // closes the debt in full with a slightly smaller collateral seizure.
  context('1 collateral: formula gives partial seizure but guard fires because S*LF leaves debt below minDebt, _processDebtClosing case 1 closes debt fully', function () {
    // COMP: BCF=0.8, LCF=0.85, LF=0.9; baseBorrowMin=$10; targetHF=1.1
    // At $85: collateralValue=$17, LCF*$17=$14.45<$15 → liquidatable
    // Formula S = (1.1*15 - 0.8*17) / (1.1*0.9 - 0.8) = 2.9/0.19 ≈ $15.26
    // formulaSeizedValue = 0.9*$15.26 = $13.74; guard: $15-$13.74=$1.26 ≤ $10 → fires
    // _processDebtClosing case 1: $15 < 0.9*$17=$15.30 → debt fully closed
    const collateralAmount = exp(0.2, 18); // $20
    const borrowAmount = exp(15, 6);       // $15, above baseBorrowMin of $10
    const droppedCompPrice = exp(85, 8);   // $85 → collateralValue = $17

    let collateralAsset: FaucetToken;
    let totalsCollateralBefore: BigNumber;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let seizeAmount: bigint;
    let wantedCollateralValue: bigint;
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let collateralValue: bigint;
    let collateralValueLeft: bigint;
    let formulaWantedCollateralValue: bigint;

    before(async function() {
      collateralAsset = tokens['COMP'];

      await comet.connect(alice).supply(collateralAsset.address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(collateralAmount);
    });

    it('alice borrow balance is equal to borrowed amount and above baseBorrowMin', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(baseBorrowMin);
    });

    it('alice assets in is equal to 1', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const expectedAssetsIn = 1 << assetInfo.offset;

      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved is equal to 0', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied collateral is equal to supplied amount', async () => {
      totalsCollateralBefore = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;
      expect(totalsCollateralBefore).to.be.equal(collateralAmount);
    });

    it('comet total borrow base is equal to borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('collateral reserves are equal to zero', async () => {
      collateralReservesBefore = await comet.getCollateralReserves(collateralAsset.address);
      expect(collateralReservesBefore).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance is equal to supplied collateral before absorb', async () => {
      cometCollateralTokenBalanceBefore = await collateralAsset.balanceOf(comet.address);
      expect(cometCollateralTokenBalanceBefore).to.be.equal(collateralAmount);
    });

    it('comet ERC20 base token balance reflects borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('alice principal is equal to the -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('alice simple base balance is zero before absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('remaining debt is larger than the minimum borrow', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);
      collateralValue = mulPrice(collateralAmount, droppedCompPrice, assetInfo.scale);
      collateralValueLeft = mulFactor(collateralValue, assetInfo.liquidationFactor);

      // debtRemainingValue=$15e8 > minDebtValue=$10e8
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
    });

    it('reaching target health only needs part of the collateral, not all of it', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);

      // Formula: S = (targetHF*D - BCF*C) / (targetHF*LF - BCF)
      // = (1.1*15e8 - 0.8*17e8) / (1.1*0.9 - 0.8) = 2.9e8 / 0.19 ≈ 15.26e8
      const totalBCFvalue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      formulaWantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalBCFvalue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());

      // formulaWantedCollateralValue ≈ $15.26e8 < collateralValue $17e8
      expect(formulaWantedCollateralValue).to.be.lessThan(collateralValue);
    });

    it('that partial path would leave debt at or under the minimum', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);

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
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);

      // seizeAmount = divPrice(debtRemaining * FACTOR_SCALE / LF, price, scale) ≈ 0.196 COMP
      const seize = debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt();
      seizeAmount = divPrice(seize, droppedCompPrice, assetInfo.scale);
      wantedCollateralValue = mulPrice(seizeAmount, droppedCompPrice, assetInfo.scale);
      
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

    // Note: event wantedCollateralValue is the _processDebtClosing return value, not the formula's.
    it('AbsorbCollateral event is emitted with', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        collateralAsset.address,
        seizeAmount,
        wantedCollateralValue
      );
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice collateral balance is reduced by the seized amount with leftover remaining', async () => {
      const remainingCollateral = await comet.collateralBalanceOf(alice.address, collateralAsset.address);
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
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
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
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
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
  context('2 collaterals: asset 0 fully seized, asset 1 enters formula path with guard firing, _processDebtClosing case 1 closes debt fully', function () {
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

    let compAsset: FaucetToken;
    let wethAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let compTotalsCollateralBefore: BigNumber;
    let wethTotalsCollateralBefore: BigNumber;
    let compCollateralReservesBefore: BigNumber;
    let wethCollateralReservesBefore: BigNumber;
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
    let wethWantedCollateralValue: bigint;
    let formulaWantedWethValue: bigint;
    let wethCollateralValueLeft: bigint;
    let cometCompTokenBalanceBefore: BigNumber;
    let cometWethTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      compAsset = tokens['COMP'];
      wethAsset = tokens['WETH'];

      await comet.connect(alice).supply(compAsset.address, compAmount);
      await comet.connect(alice).supply(wethAsset.address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['WETH'].connect(alice).setRoundData(0, droppedWethPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice COMP collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(compAmount);
    });

    it('alice WETH collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(wethAmount);
    });

    it('alice borrow balance is equal to borrowed amount and above baseBorrowMin', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(baseBorrowMin);
    });

    it('alice assets in includes COMP and WETH', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const expectedAssetsIn = (1 << compInfo.offset) | (1 << wethInfo.offset);

      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice principal is equal to the -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('alice simple base balance is zero before absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('comet total supplied COMP is equal to alice supplied COMP', async () => {
      compTotalsCollateralBefore = (await comet.totalsCollateral(compAsset.address)).totalSupplyAsset;
      expect(compTotalsCollateralBefore).to.be.equal(compAmount);
    });

    it('comet total supplied WETH is equal to alice supplied WETH', async () => {
      wethTotalsCollateralBefore = (await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset;
      expect(wethTotalsCollateralBefore).to.be.equal(wethAmount);
    });

    it('comet total borrow base is equal to borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('collateral reserves are equal to zero', async () => {
      compCollateralReservesBefore = await comet.getCollateralReserves(compAsset.address);
      wethCollateralReservesBefore = await comet.getCollateralReserves(wethAsset.address);

      expect(compCollateralReservesBefore).to.be.equal(0);
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

    it('comet ERC20 base token balance reflects borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('calculates COMP full seizure values', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
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

      compSeizeAmount = compAmount;
      compWantedCollateralValue = compCollateralValue;
      compSeizedValue = mulFactor(compWantedCollateralValue, compInfo.liquidationFactor);
    });

    it('after COMP is fully seized, remaining debt is still above the minimum borrow', async () => {
      // After COMP full seizure: debtRemaining = $11e8, still above minDebt $10e8.
      debtRemainingValue -= compSeizedValue;
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
    });

    it('reaching target health only needs part of the WETH, not all of it', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
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

    it('that partial WETH path would leave debt at or under the minimum', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);

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
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // seizeAmount = divPrice(debtRemaining * FACTOR_SCALE / LF, price, scale) ≈ 0.00815 WETH
      const seize = debtRemainingValue * factorScale / wethInfo.liquidationFactor.toBigInt();
      wethSeizeAmount = divPrice(seize, wethPrice, wethInfo.scale);
      wethWantedCollateralValue = mulPrice(wethSeizeAmount, wethPrice, wethInfo.scale);
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

    it('AbsorbCollateral event is emitted for COMP full seizure', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        compAsset.address,
        compSeizeAmount,
        compWantedCollateralValue
      );
    });

    // Note: event wantedCollateralValue is the _processDebtClosing return value, not the formula's.
    it('AbsorbCollateral event is emitted for WETH with full close amounts', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        wethAsset.address,
        wethSeizeAmount,
        wethWantedCollateralValue
      );
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

    it('alice COMP collateral balance is zero after full seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is reduced by the seized amount with leftover remaining', async () => {
      const remainingWeth = await comet.collateralBalanceOf(alice.address, wethAsset.address);
      expect(remainingWeth).to.be.equal(wethAmount - wethSeizeAmount);
      expect(remainingWeth).to.be.greaterThan(0);
    });

    it('alice assetsIn no longer contains COMP after full seizure', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      expect((await comet.userBasic(alice.address)).assetsIn & (1 << compInfo.offset)).to.be.equal(0);
    });

    it('alice assetsIn still contains WETH because collateral remains', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      expect((await comet.userBasic(alice.address)).assetsIn & (1 << wethInfo.offset)).to.not.be.equal(0);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied COMP is zero after full seizure', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(compAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(compTotalsCollateralBefore.sub(compSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH is reduced by the seized amount but remains positive', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(wethTotalsCollateralBefore.sub(wethSeizeAmount));
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
      expect(await comet.getCollateralReserves(compAsset.address)).to.be.equal(compCollateralReservesBefore.add(compSeizeAmount));
    });

    it('comet WETH collateral reserves increase by the seized WETH amount', async () => {
      expect(await comet.getCollateralReserves(wethAsset.address)).to.be.equal(wethCollateralReservesBefore.add(wethSeizeAmount));
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

    let compAsset: FaucetToken;
    let wethAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let compTotalsCollateralBefore: BigNumber;
    let wethTotalsCollateralBefore: BigNumber;
    let compCollateralReservesBefore: BigNumber;
    let wethCollateralReservesBefore: BigNumber;
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
    let cometCompTokenBalanceBefore: BigNumber;
    let cometWethTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let compCollateralValue: bigint;
    let compCollateralValueLeft: bigint;
    let formulaWantedCompValue: bigint;

    before(async function() {
      compAsset = tokens['COMP'];
      wethAsset = tokens['WETH'];

      await comet.connect(alice).supply(compAsset.address, compAmount);
      await comet.connect(alice).supply(wethAsset.address, wethAmount);
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

      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice collateral balances are equal to supplied amounts', async () => {
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(compAmount);
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(wethAmount);
    });

    it('alice borrow balance is equal to borrowed amount and above baseBorrowMin', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(baseBorrowMin);
    });

    it('alice principal is equal to the -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('alice simple base balance is zero before absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice assets in includes COMP and WETH', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const expectedAssetsIn = (1 << compInfo.offset) | (1 << wethInfo.offset);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('comet collateral totals are equal to supplied amounts', async () => {
      compTotalsCollateralBefore = (await comet.totalsCollateral(compAsset.address)).totalSupplyAsset;
      wethTotalsCollateralBefore = (await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset;

      expect(compTotalsCollateralBefore).to.be.equal(compAmount);
      expect(wethTotalsCollateralBefore).to.be.equal(wethAmount);
    });

    it('collateral reserves are equal to zero', async () => {
      compCollateralReservesBefore = await comet.getCollateralReserves(compAsset.address);
      wethCollateralReservesBefore = await comet.getCollateralReserves(wethAsset.address);
      expect(compCollateralReservesBefore).to.be.equal(0);
      expect(wethCollateralReservesBefore).to.be.equal(0);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('comet total borrow base is equal to borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet ERC20 balances reflect supplied collateral and borrowed base before absorb', async () => {
      cometCompTokenBalanceBefore = await compAsset.balanceOf(comet.address);
      cometWethTokenBalanceBefore = await wethAsset.balanceOf(comet.address);
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);

      expect(cometCompTokenBalanceBefore).to.be.equal(compAmount);
      expect(cometWethTokenBalanceBefore).to.be.equal(wethAmount);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('reaching target health only needs part of the COMP, not the full position', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
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
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const formulaSeizedCompValue = mulFactor(formulaWantedCompValue, compInfo.liquidationFactor);

      expect(debtRemainingValue - formulaSeizedCompValue).to.be.lessThanOrEqual(minDebtValue);
    });

    it('total debt is still at least the liquidation value of the entire COMP position', async () => {
      // So liquidation takes all COMP (full seizure), not a smaller partial slice.
      expect(debtRemainingValue).to.be.greaterThanOrEqual(compCollateralValueLeft);
    });

    it('expected full COMP seizure: entire balance at full mark, repay up to liquidation value', async () => {
      compSeizeAmount = compAmount;
      compWantedCollateralValue = compCollateralValue;
      compSeizedValue = compCollateralValueLeft;
    });

    it('after full COMP seizure, remaining debt is below minimum borrow but positive', async () => {
      debtRemainingValue -= compSeizedValue;

      expect(debtRemainingValue).to.be.lessThan(minDebtValue);
      expect(debtRemainingValue).to.be.greaterThan(0);
    });

    it('at liquidation pricing, WETH still covers the remaining debt', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const wethCollateralValueLeft = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);

      expect(debtRemainingValue).to.be.lessThan(wethCollateralValueLeft);
    });

    it('expected WETH seize amount and collateral value for closing the remainder', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // Mirrors closing the small debt with partial WETH (wanted value → wei → rounded token amount → repriced).
      wethWantedCollateralValue = debtRemainingValue * factorScale / wethInfo.liquidationFactor.toBigInt();
      wethSeizeAmount = divPrice(wethWantedCollateralValue, wethPrice, wethInfo.scale);
      wethSeizedValue = debtRemainingValue;
      wethWantedCollateralValue = mulPrice(wethSeizeAmount, wethPrice, wethInfo.scale);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('newBalance is zero after WETH closes the remaining debt', () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - wethSeizedValue;
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
        compAsset.address,
        compSeizeAmount,
        compWantedCollateralValue
      );
    });

    it('AbsorbCollateral event is emitted for WETH minDebt close', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address,
        alice.address,
        wethAsset.address,
        wethSeizeAmount,
        wethWantedCollateralValue
      );
    });

    it('comet ERC20 COMP balance on Comet is unchanged during absorb', async () => {
      expect(await compAsset.balanceOf(comet.address)).to.be.equal(cometCompTokenBalanceBefore);
    });

    it('comet ERC20 WETH balance on Comet is unchanged during absorb', async () => {
      expect(await wethAsset.balanceOf(comet.address)).to.be.equal(cometWethTokenBalanceBefore);
    });

    it('comet ERC20 base balance on Comet is unchanged during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice COMP collateral balance is zero after full seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(0);
    });

    it('alice WETH collateral balance drops by the seized WETH amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(wethAmount - wethSeizeAmount);
    });

    it('alice still holds WETH collateral after partial seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.greaterThan(0);
    });

    it('alice assetsIn keeps only WETH and reserved bits do not change', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(1 << wethInfo.offset);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied COMP collateral is reduced by the seized COMP amount', async () => {
      const compTotalSupplyAsset = (await comet.totalsCollateral(compAsset.address)).totalSupplyAsset;

      expect(compTotalSupplyAsset).to.be.equal(compTotalsCollateralBefore.sub(compSeizeAmount));
    });

    it('comet total supplied COMP collateral is zero', async () => {
      expect((await comet.totalsCollateral(compAsset.address)).totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH collateral is reduced by the seized WETH amount', async () => {
      const wethTotalSupplyAsset = (await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset;

      expect(wethTotalSupplyAsset).to.be.equal(wethTotalsCollateralBefore.sub(wethSeizeAmount));
    });

    it('comet total supplied WETH collateral is still positive', async () => {
      expect((await comet.totalsCollateral(wethAsset.address)).totalSupplyAsset).to.not.be.equal(0);
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
      expect(await comet.getCollateralReserves(compAsset.address)).to.be.equal(compCollateralReservesBefore.add(compSeizeAmount));
    });

    it('comet WETH collateral reserves increase by the seized WETH amount', async () => {
      expect(await comet.getCollateralReserves(wethAsset.address)).to.be.equal(wethCollateralReservesBefore.add(wethSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('24 collaterals: assets 0-22 fully seized, sUSDe (asset 23) partially seized, user remains borrower', function () {
    const targetCollateralUsdPerAsset = exp(12, 8); // ~$12 per asset - keeps absorb from hitting target HF early
    const assetSymbols23 = Object.keys(default24Assets()).filter((s) => s !== 'USDC' && s !== 'sUSDe');
    const sUsDeAmount = exp(380, 18);
    const borrowAmount = exp(457.5, 6);
    const droppedSUsDePrice = exp(0.8, 8);
    
    let assetSupplyAmounts: { [symbol: string]: bigint } = {};
    let absorbTx: ContractTransaction;
    let assetsInBefore: number;
    let reservedBefore: number;
    let sUsDeTotalsCollateralBefore: BigNumber;
    let sUsDeCollateralReservesBefore: BigNumber;
    let cometSUsDeTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let sUsDeSeizeAmount: bigint;
    let sUsDeSeizedValue: bigint;
    let sUsDeWantedCollateralValue: bigint;
    let debtRemainingValue: bigint;
    let borrowPrincipalBefore: BigNumber;
    // Comet ERC20 balance per asset 0-22 before absorb - seized collateral stays in the contract
    let cometErc20CollateralBefore23: { [symbol: string]: BigNumber };

    before(async function () {
      for (const sym of assetSymbols23) {
        const info = await comet.getAssetInfoByAddress(tokens[sym].address);
        const price = (await priceFeeds[sym].latestRoundData())[1];
        assetSupplyAmounts[sym] = divPrice(targetCollateralUsdPerAsset, price, info.scale);
        await comet.connect(alice).supply(tokens[sym].address, assetSupplyAmounts[sym]);
      }
      await comet.connect(alice).supply(tokens['sUSDe'].address, sUsDeAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      await priceFeeds['sUSDe'].connect(alice).setRoundData(0, droppedSUsDePrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      borrowPrincipalBefore = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(borrowPrincipalBefore, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice borrow balance is equal to the withdrawn amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn has all 16 lower assets set', async () => {
      expect(assetsInBefore).to.be.equal((1 << 16) - 1);
    });

    it('alice reserved has all 8 upper assets set', async () => {
      expect(reservedBefore).to.be.equal((1 << 8) - 1);
    });

    it('alice collateral balances match supplied amounts for assets 0-22', async () => {
      for (const sym of assetSymbols23) {
        expect(await comet.collateralBalanceOf(alice.address, tokens[sym].address)).to.be.equal(assetSupplyAmounts[sym]);
      }
    });

    it('alice principal reflects the borrow before absorb', async () => {
      expect(borrowPrincipalBefore).to.be.approximately(-borrowAmount, 10n); // 10 wei tolerance
    });

    it('comet reserves equal initial base funding before absorb', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('collateral reserves are zero for assets 0-22 before absorb', async () => {
      for (const sym of assetSymbols23) {
        expect(await comet.getCollateralReserves(tokens[sym].address)).to.be.equal(0, sym);
      }
    });

    it('comet totalsCollateral match supplied amounts for assets 0-22', async () => {
      for (const sym of assetSymbols23) {
        const totalSupplyAsset = (await comet.totalsCollateral(tokens[sym].address)).totalSupplyAsset;
        expect(totalSupplyAsset).to.be.equal(assetSupplyAmounts[sym]);
      }
    });

    it('comet ERC20 balances equal supplied amounts for assets 0-22 before absorb', async () => {
      cometErc20CollateralBefore23 = {};
      for (const sym of assetSymbols23) {
        const bal = await tokens[sym].balanceOf(comet.address);
        cometErc20CollateralBefore23[sym] = bal;
        expect(bal).to.be.equal(assetSupplyAmounts[sym]);
      }
    });

    it('alice simple base balance is zero before absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('comet total supplied sUSDe is equal to alice supplied sUSDe', async () => {
      sUsDeTotalsCollateralBefore = (await comet.totalsCollateral(tokens['sUSDe'].address)).totalSupplyAsset;
      expect(sUsDeTotalsCollateralBefore).to.be.equal(sUsDeAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.approximately(borrowAmount, 10n); // 10 wei tolerance
    });

    it('sUSDe collateral reserves are zero before absorb', async () => {
      sUsDeCollateralReservesBefore = await comet.getCollateralReserves(tokens['sUSDe'].address);
      expect(sUsDeCollateralReservesBefore).to.be.equal(0);
    });

    it('comet ERC20 sUSDe token balance equals supplied sUSDe before absorb', async () => {
      cometSUsDeTokenBalanceBefore = await tokens['sUSDe'].balanceOf(comet.address);
      expect(cometSUsDeTokenBalanceBefore).to.be.equal(sUsDeAmount);
    });

    it('comet ERC20 base token balance is reduced by the borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates sUSDe partial seizure values after 23 full seizures', async () => {
      const sUsDeInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);
      const sUsDeValue = mulPrice(sUsDeAmount, droppedSUsDePrice, sUsDeInfo.scale);
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      for (const sym of assetSymbols23) {
        const info = await comet.getAssetInfoByAddress(tokens[sym].address);
        const price = (await priceFeeds[sym].latestRoundData())[1];
        const value = mulPrice(assetSupplyAmounts[sym], price, info.scale);
        debtRemainingValue -= mulFactor(value, info.liquidationFactor);
      }

      const totalCollateralizedValue = mulFactor(sUsDeValue, sUsDeInfo.borrowCollateralFactor);

      sUsDeWantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(sUsDeInfo.liquidationFactor, targetHealthFactor) - sUsDeInfo.borrowCollateralFactor.toBigInt());

      expect(sUsDeWantedCollateralValue).to.be.lessThan(sUsDeValue);

      sUsDeSeizeAmount = divPrice(sUsDeWantedCollateralValue, droppedSUsDePrice, sUsDeInfo.scale);
      sUsDeSeizedValue = mulFactor(sUsDeWantedCollateralValue, sUsDeInfo.liquidationFactor);
    });

    it('calculates newBalance after sUSDe partial seizure', () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - sUsDeSeizedValue;
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
    });

    it('newBalance is negative — user remains borrower', () => {
      expect(newBalance).to.be.lessThan(0n);
    });

    it('newBalance is less negative than initial debt balance', () => {
      expect(newBalance).to.be.greaterThan(oldBalance);
    });

    it('alice borrow balance matches newBalance after absorb', async () => {
      const actualNewBalance = -(await comet.borrowBalanceOf(alice.address));
      expect(actualNewBalance).to.be.equal(newBalance);
    });

    it('newPrincipal matches newBalance', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = (await comet.userBasic(alice.address)).principal;
      const expectedNewPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      expect(newPrincipal).to.equal(expectedNewPrincipal);
    });

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice assetsIn is zero after all lower-index assets are fully seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved keeps only sUSDe bit after assets 16–22 are fully seized', async () => {
      const sUsDeInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (sUsDeInfo.offset - 16));
    });

    it('all 23 fully seized collateral balances are zero', async () => {
      for (const sym of assetSymbols23) {
        expect(await comet.collateralBalanceOf(alice.address, tokens[sym].address)).to.be.equal(0, `${sym} collateral balance should be zero`);
      }
    });

    it('comet totalsCollateral are zero for all fully seized assets 0-22', async () => {
      for (const sym of assetSymbols23) {
        expect((await comet.totalsCollateral(tokens[sym].address)).totalSupplyAsset).to.be.equal(0);
      }
    });

    it('comet collateral reserves for assets 0-22 increase by the fully seized amounts', async () => {
      for (const sym of assetSymbols23) {
        expect(await comet.getCollateralReserves(tokens[sym].address)).to.be.equal(assetSupplyAmounts[sym]);
      }
    });

    it('comet ERC20 balances for assets 0-22 do not change during absorb', async () => {
      for (const sym of assetSymbols23) {
        expect(await tokens[sym].balanceOf(comet.address)).to.be.equal(cometErc20CollateralBefore23[sym]);
      }
    });

    it('alice sUSDe collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['sUSDe'].address)).to.be.equal(sUsDeAmount - sUsDeSeizeAmount);
    });

    it('comet total supplied sUSDe is reduced by the seized amount and still positive', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['sUSDe'].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(sUsDeTotalsCollateralBefore.sub(sUsDeSeizeAmount));
    });

    it('comet total borrow base is reduced by the principal delta', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
      const borrowPrincipalAfter = (await comet.userBasic(alice.address)).principal;
      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(borrowPrincipalAfter.sub(borrowPrincipalBefore)));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet sUSDe collateral reserves increase by seized sUSDe', async () => {
      expect(await comet.getCollateralReserves(tokens['sUSDe'].address)).to.be.equal(sUsDeCollateralReservesBefore.add(sUsDeSeizeAmount));
    });

    it('comet ERC20 sUSDe token balance does not change during absorb', async () => {
      expect(await tokens['sUSDe'].balanceOf(comet.address)).to.be.equal(cometSUsDeTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  // rsETH is the borrow asset (18 decimals). Small USD gaps at the oracle show up as
  // non-zero base-token amounts in a way 6-decimal USDC base would often round away;
  // the two cases below stress min-borrow behavior and the last collateral in the loop.
  context('rsETH-denominated base (18 decimals): dust and min-borrow edge cases', function () {
    // After full COMP and full WETH seizures, WETH’s liquidation value still falls
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

      it('absorb is successful', async () => {
        absorbTx = await rsEthComet.connect(rsEthAbsorber).absorb(rsEthAbsorber.address, [rsEthAlice.address]);
        await expect(absorbTx).to.not.be.reverted;
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

      it('absorb is successful', async () => {
        absorbTx = await rsEthComet.connect(rsEthAbsorber).absorb(rsEthAbsorber.address, [rsEthAlice.address]);
        await expect(absorbTx).to.not.be.reverted;
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
        expect((await rsEthComet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
        expect((await rsEthComet.totalsBasic()).totalBorrowBase).to.be.equal(0);
      });

      it('comet total supply base is unchanged', async () => {
        expect((await rsEthComet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
      });
    });
  });
});