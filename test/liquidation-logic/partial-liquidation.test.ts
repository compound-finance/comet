import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, principalValue, default24Assets, divPrice, CollateralState, makeCollateralStates } from '../helpers';
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
  const baseBorrowMin = 0; // $0

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

    const allocateAmount = exp(1_000_000, 18);
    for (const token of Object.values(protocol.tokens)) {
      await (token as FaucetToken).allocateTo(alice.address, allocateAmount);
      await (token as FaucetToken).connect(alice).approve(comet.address, ethers.constants.MaxUint256);
    }

    // Make reserves on comet for borrowings
    await baseToken.allocateTo(comet.address, initialBaseFunding);
    targetHealthFactor = (await comet.targetHealthFactor()).toBigInt();
    
    snapshot = await takeSnapshot();
  });

  context('1 collateral: partial seizure, user has enough to cover debt (asset index 0)', function () {
    const collateralAmount = exp(1, 18); // $100 COMP
    const borrowAmount = exp(80, 6); // $80

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
    let seizedValue: bigint;
    let seizeAmount: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, collateralAmount);
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

    it('calculates seize amount and seized value for partial liquidation', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
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
      collateralsState['COMP'].seizeAmount = seizeAmount;
      collateralsState['COMP'].seizedValue = seizedValue;
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
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice collateral balance is reduced by the seized amount', async () => {
      const collateralBalance = await comet.collateralBalanceOf(alice.address, tokens['COMP'].address);

      expect(collateralBalance).to.be.equal(collateralAmount - seizeAmount);
    });

    it('alice assetsIn does not change', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(seizeAmount));
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
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

  context('1 collateral: partial seizure, user has enough to cover debt (asset index 16)', function () {
    const collateralAmount = exp(100, 18); // 100 LDO, initially worth $200
    const borrowAmount = exp(80, 6); // $80

    const collateralKeys = ['LDO'];
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
    let seizedValue: bigint;
    let seizeAmount: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['LDO'].address, collateralAmount);
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

    it('calculates seize amount and seized value for partial liquidation', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['LDO'].address);
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1];

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
      expect(await tokens['LDO'].balanceOf(comet.address)).to.be.equal(collateralsState['LDO'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice collateral balance is reduced by the seized amount', async () => {
      const collateralBalance = await comet.collateralBalanceOf(alice.address, tokens['LDO'].address);

      expect(collateralBalance).to.be.equal(collateralAmount - seizeAmount);
    });

    it('alice assetsIn does not change', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['LDO'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['LDO'].totalsCollateralBefore.sub(seizeAmount));
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['LDO'].address)).to.be.equal(collateralsState['LDO'].collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('1 collateral: partial seizure, user has enough to cover debt (last asset index)', function () {
    const collateralAmount = exp(100, 18); // 100 sUSDe, initially worth $100
    const borrowAmount = exp(50, 6); // $50

    const collateralKeys = ['sUSDe'];
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
    let seizedValue: bigint;
    let seizeAmount: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['sUSDe'].address, collateralAmount);
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

    it('calculates seize amount and seized value for partial liquidation', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);
      const sUsdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1];

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
      expect(await tokens['sUSDe'].balanceOf(comet.address)).to.be.equal(collateralsState['sUSDe'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice collateral balance is reduced by the seized amount', async () => {
      const collateralBalance = await comet.collateralBalanceOf(alice.address, tokens['sUSDe'].address);

      expect(collateralBalance).to.be.equal(collateralAmount - seizeAmount);
    });

    it('alice assetsIn does not change', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['sUSDe'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['sUSDe'].totalsCollateralBefore.sub(seizeAmount));
    });

    it('comet total borrow base is reduced by the base paid out', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['sUSDe'].address)).to.be.equal(collateralsState['sUSDe'].collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of first asset then partial of second', function () {
    const compAmount = exp(0.6, 18); // 0.6 COMP, worth $60 before the price drop
    const wethAmount = exp(0.0225, 18); // 0.0225 WETH at $2,000 = $45
    const borrowAmount = exp(80, 6); // $80

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
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, compAmount);
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
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

      collateralsState['COMP'].seizeAmount = compAmount;
      collateralsState['COMP'].seizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
    });

    it('calculates WETH partial seizure values', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);

      // After COMP full seizure, debt is $80 - $43.20 = $36.80.
      debtRemainingValue -= collateralsState['COMP'].seizedValue;

      // WETH is still worth $45, with $33.75 borrow-CF collateral value.
      const totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      // Solve the same target HF formula for WETH.
      // It wants about $25.08 of WETH value, so WETH is partially seized.
      const wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWethCollateralValue).to.be.lessThan(wethCollateralValue);

      collateralsState['WETH'].seizeAmount = divPrice(wantedWethCollateralValue, wethPrice, wethInfo.scale);
      collateralsState['WETH'].seizedValue = mulFactor(wantedWethCollateralValue, wethInfo.liquidationFactor);
    });

    it('calculates newBalance after COMP and WETH reduce debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['WETH'].seizedValue;
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
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance does not change during absorb', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(wethAmount - collateralsState['WETH'].seizeAmount);
    });

    it('alice assetsIn keeps only WETH', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const expectedAssetsIn = 1 << wethInfo.offset;

      expect(assetsInBefore).to.not.equal(expectedAssetsIn);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied COMP is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied WETH is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['WETH'].totalsCollateralBefore.sub(collateralsState['WETH'].seizeAmount));
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
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount));
    });

    it('comet WETH collateral reserves increase by seized WETH', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of asset index 15 then partial of asset index 16', function () {
    const aaveAmount = exp(0.6, 18); // 0.6 AAVE, worth $60 before the price drop
    const ldoAmount = exp(37.5, 18); // 37.5 LDO, worth $75 before the price drop
    const borrowAmount = exp(75, 6); // $75

    const collateralKeys = ['AAVE', 'LDO'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['AAVE'].address, aaveAmount);
      await comet.connect(alice).supply(tokens['LDO'].address, ldoAmount);
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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates AAVE full seizure values', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(tokens['AAVE'].address);
      const ldoInfo = await comet.getAssetInfoByAddress(tokens['LDO'].address);
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

      collateralsState['AAVE'].seizeAmount = aaveAmount;
      collateralsState['AAVE'].seizedValue = mulFactor(aaveCollateralValue, aaveInfo.liquidationFactor);
    });

    it('calculates LDO partial seizure values', async () => {
      const ldoInfo = await comet.getAssetInfoByAddress(tokens['LDO'].address);
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();
      const ldoCollateralValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);

      // After AAVE full seizure, debt is $75 - $40.80 = $34.20.
      debtRemainingValue -= collateralsState['AAVE'].seizedValue;

      // LDO is worth $60, with $33 of borrow-CF collateral value.
      const totalCollateralizedValue = mulFactor(ldoCollateralValue, ldoInfo.borrowCollateralFactor);

      // Solve the same target HF formula for LDO.
      // It wants about $8.50 of LDO value, so LDO is partially seized.
      const wantedLdoCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(ldoInfo.liquidationFactor, targetHealthFactor) - ldoInfo.borrowCollateralFactor.toBigInt());
      expect(wantedLdoCollateralValue).to.be.lessThan(ldoCollateralValue);

      collateralsState['LDO'].seizeAmount = divPrice(wantedLdoCollateralValue, ldoPrice, ldoInfo.scale);
      collateralsState['LDO'].seizedValue = mulFactor(wantedLdoCollateralValue, ldoInfo.liquidationFactor);
    });

    it('calculates newBalance after AAVE and LDO reduce debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['LDO'].seizedValue;
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
      expect(await tokens['AAVE'].balanceOf(comet.address)).to.be.equal(collateralsState['AAVE'].tokenBalanceBefore);
    });

    it('comet ERC20 LDO token balance does not change during absorb', async () => {
      expect(await tokens['LDO'].balanceOf(comet.address)).to.be.equal(collateralsState['LDO'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice AAVE collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['AAVE'].address)).to.be.equal(0);
    });

    it('alice LDO collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['LDO'].address)).to.be.equal(ldoAmount - collateralsState['LDO'].seizeAmount);
    });

    it('alice assetsIn is zero after AAVE is fully seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved keeps only LDO', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied AAVE is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['AAVE'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['AAVE'].totalsCollateralBefore.sub(collateralsState['AAVE'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied LDO is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['LDO'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['LDO'].totalsCollateralBefore.sub(collateralsState['LDO'].seizeAmount));
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
      expect(await comet.getCollateralReserves(tokens['AAVE'].address)).to.be.equal(collateralsState['AAVE'].collateralReservesBefore.add(collateralsState['AAVE'].seizeAmount));
    });

    it('comet LDO collateral reserves increase by seized LDO', async () => {
      expect(await comet.getCollateralReserves(tokens['LDO'].address)).to.be.equal(collateralsState['LDO'].collateralReservesBefore.add(collateralsState['LDO'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of asset index 22 then partial of asset index 23', function () {
    const usdeAmount = exp(60, 18); // 60 USDe, worth $60 before the price drop
    const susdeAmount = exp(75, 18); // 75 sUSDe, worth $75 before the price drop
    const borrowAmount = exp(90, 6); // $90

    const collateralKeys = ['USDe', 'sUSDe'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['USDe'].address, usdeAmount);
      await comet.connect(alice).supply(tokens['sUSDe'].address, susdeAmount);
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

    it('alice reserved includes USDe and sUSDe', async () => {
      const usdeInfo = await comet.getAssetInfoByAddress(tokens['USDe'].address);
      const susdeInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);
      const expectedReserved = (1 << (usdeInfo.offset - 16)) | (1 << (susdeInfo.offset - 16));

      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates USDe full seizure values', async () => {
      const usdeInfo = await comet.getAssetInfoByAddress(tokens['USDe'].address);
      const susdeInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);
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

      collateralsState['USDe'].seizeAmount = usdeAmount;
      collateralsState['USDe'].seizedValue = mulFactor(usdeCollateralValue, usdeInfo.liquidationFactor);
    });

    it('calculates sUSDe partial seizure values', async () => {
      const susdeInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);
      const susdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1].toBigInt();
      const susdeCollateralValue = mulPrice(susdeAmount, susdePrice, susdeInfo.scale);

      // After USDe full seizure, debt is $90 - $44.16 = $45.84.
      debtRemainingValue -= collateralsState['USDe'].seizedValue;

      // sUSDe is worth $60, with $43.20 of borrow-CF collateral value.
      const totalCollateralizedValue = mulFactor(susdeCollateralValue, susdeInfo.borrowCollateralFactor);

      // Solve the same target HF formula for sUSDe.
      // It wants about $32.79 of sUSDe value, so sUSDe is partially seized.
      const wantedSusdeCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(susdeInfo.liquidationFactor, targetHealthFactor) - susdeInfo.borrowCollateralFactor.toBigInt());
      expect(wantedSusdeCollateralValue).to.be.lessThan(susdeCollateralValue);

      collateralsState['sUSDe'].seizeAmount = divPrice(wantedSusdeCollateralValue, susdePrice, susdeInfo.scale);
      collateralsState['sUSDe'].seizedValue = mulFactor(wantedSusdeCollateralValue, susdeInfo.liquidationFactor);
    });

    it('calculates newBalance after USDe and sUSDe reduce debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['sUSDe'].seizedValue;
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
      expect(await tokens['USDe'].balanceOf(comet.address)).to.be.equal(collateralsState['USDe'].tokenBalanceBefore);
    });

    it('comet ERC20 sUSDe token balance does not change during absorb', async () => {
      expect(await tokens['sUSDe'].balanceOf(comet.address)).to.be.equal(collateralsState['sUSDe'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice USDe collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['USDe'].address)).to.be.equal(0);
    });

    it('alice sUSDe collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['sUSDe'].address)).to.be.equal(susdeAmount - collateralsState['sUSDe'].seizeAmount);
    });

    it('alice assetsIn remains zero', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved keeps only sUSDe', async () => {
      const susdeInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);

      expect((await comet.userBasic(alice.address))._reserved).to.not.be.equal(reservedBefore);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (susdeInfo.offset - 16));
    });

    it('comet total supplied USDe is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['USDe'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['USDe'].totalsCollateralBefore.sub(collateralsState['USDe'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied sUSDe is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['sUSDe'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['sUSDe'].totalsCollateralBefore.sub(collateralsState['sUSDe'].seizeAmount));
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
      expect(await comet.getCollateralReserves(tokens['USDe'].address)).to.be.equal(collateralsState['USDe'].collateralReservesBefore.add(collateralsState['USDe'].seizeAmount));
    });

    it('comet sUSDe collateral reserves increase by seized sUSDe', async () => {
      expect(await comet.getCollateralReserves(tokens['sUSDe'].address)).to.be.equal(collateralsState['sUSDe'].collateralReservesBefore.add(collateralsState['sUSDe'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of asset index 10 then partial of asset index 20', function () {
    const ezETHAmount = exp(0.02, 18); // 0.02 ezETH, worth $67 before the price drop
    const opAmount = exp(40, 18);      // 40 OP, worth $80 before the price drop
    const borrowAmount = exp(80, 6);   // $80

    const collateralKeys = ['ezETH', 'OP'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

    before(async function() {
      await comet.connect(alice).supply(tokens['ezETH'].address, ezETHAmount);
      await comet.connect(alice).supply(tokens['OP'].address, opAmount);
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

    it('alice assetsIn includes only ezETH', async () => {
      const ezETHInfo = await comet.getAssetInfoByAddress(tokens['ezETH'].address);

      expect(ezETHInfo.offset).to.be.equal(10);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(1 << ezETHInfo.offset);
    });

    it('alice reserved includes only OP', async () => {
      const opInfo = await comet.getAssetInfoByAddress(tokens['OP'].address);

      expect(opInfo.offset).to.be.equal(20);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (opInfo.offset - 16));
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('calculates ezETH full seizure values', async () => {
      const ezETHInfo = await comet.getAssetInfoByAddress(tokens['ezETH'].address);
      const opInfo = await comet.getAssetInfoByAddress(tokens['OP'].address);
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

      collateralsState['ezETH'].seizeAmount = ezETHAmount;
      collateralsState['ezETH'].seizedValue = mulFactor(ezETHCollateralValue, ezETHInfo.liquidationFactor);
    });

    it('calculates OP partial seizure values', async () => {
      const opInfo = await comet.getAssetInfoByAddress(tokens['OP'].address);
      const opPrice = (await priceFeeds['OP'].latestRoundData())[1].toBigInt();
      const opCollateralValue = mulPrice(opAmount, opPrice, opInfo.scale);

      // After ezETH full seizure, debt is $80 − $45.73 = $34.27.
      debtRemainingValue -= collateralsState['ezETH'].seizedValue;

      // OP is worth $60, with $33 of borrow-CF collateral value.
      const totalCollateralizedValue = mulFactor(opCollateralValue, opInfo.borrowCollateralFactor);

      // Solve the same target HF formula for OP.
      // It wants about $8.72 of OP value, so OP is partially seized.
      const wantedOPCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(opInfo.liquidationFactor, targetHealthFactor) - opInfo.borrowCollateralFactor.toBigInt());
      expect(wantedOPCollateralValue).to.be.lessThan(opCollateralValue);

      collateralsState['OP'].seizeAmount = divPrice(wantedOPCollateralValue, opPrice, opInfo.scale);
      collateralsState['OP'].seizedValue = mulFactor(wantedOPCollateralValue, opInfo.liquidationFactor);
    });

    it('calculates newBalance after ezETH and OP reduce debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['OP'].seizedValue;
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
      expect(await tokens['ezETH'].balanceOf(comet.address)).to.be.equal(collateralsState['ezETH'].tokenBalanceBefore);
    });

    it('comet ERC20 OP token balance does not change during absorb', async () => {
      expect(await tokens['OP'].balanceOf(comet.address)).to.be.equal(collateralsState['OP'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice ezETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['ezETH'].address)).to.be.equal(0);
    });

    it('alice OP collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['OP'].address)).to.be.equal(opAmount - collateralsState['OP'].seizeAmount);
    });

    it('alice assetsIn is zero after ezETH is fully seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved is unchanged as OP still has remaining balance', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied ezETH is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['ezETH'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['ezETH'].totalsCollateralBefore.sub(collateralsState['ezETH'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied OP is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['OP'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['OP'].totalsCollateralBefore.sub(collateralsState['OP'].seizeAmount));
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
      expect(await comet.getCollateralReserves(tokens['ezETH'].address)).to.be.equal(collateralsState['ezETH'].collateralReservesBefore.add(collateralsState['ezETH'].seizeAmount));
    });

    it('comet OP collateral reserves increase by seized OP', async () => {
      expect(await comet.getCollateralReserves(tokens['OP'].address)).to.be.equal(collateralsState['OP'].collateralReservesBefore.add(collateralsState['OP'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: 5 different collaterals with non following asset indexes', function () {
    const wbtcAmount = exp(0.0001, 8);  // 0.0001 WBTC, worth $6.50 before the price drop
    const rsETHAmount = exp(0.001, 18); // 0.001 rsETH, worth $3.40 before the price drop
    const cbETHAmount = exp(0.001, 18); // 0.001 cbETH, worth $3.30 before the price drop
    const crvAmount = exp(3, 18);       // 3 CRV, worth $3.00 before the price drop
    const gmxAmount = exp(6, 18);       // 6 GMX, worth $240 before the price drop
    const borrowAmount = exp(80, 6);    // $80

    const collateralKeys = ['WBTC', 'rsETH', 'cbETH', 'CRV', 'GMX'];
    let collateralsState: Record<string, CollateralState>;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;
    let innerSnapshot: SnapshotRestorer;

    before(async function() {
      await comet.connect(alice).supply(tokens['WBTC'].address, wbtcAmount);
      await comet.connect(alice).supply(tokens['rsETH'].address, rsETHAmount);
      await comet.connect(alice).supply(tokens['cbETH'].address, cbETHAmount);
      await comet.connect(alice).supply(tokens['CRV'].address, crvAmount);
      await comet.connect(alice).supply(tokens['GMX'].address, gmxAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop all five assets by 50%.
      for (const tokenSymbol of collateralKeys) {
        const currentPrice = (await priceFeeds[tokenSymbol].latestRoundData())[1].toBigInt();
        await priceFeeds[tokenSymbol].connect(alice).setRoundData(0, currentPrice * 50n / 100n, 0, 0, 0);
      }
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

      innerSnapshot = await takeSnapshot();
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    // This context focuses on contract storage state after absorb.
    context('storage: full seizure of asset indexes 3, 6, 7, 17 and partial seizure of asset 21', function () {
      let absorbTx: ContractTransaction;
      let newBalance: bigint;
      let basePaidOut: bigint;
      let debtRemainingValue: bigint;

      it('absorb is successful', async () => {
        absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
        await expect(absorbTx).to.be.not.be.reverted;
      });

      it('calculates WBTC full seizure values', async () => {
        const wbtcInfo = await comet.getAssetInfoByAddress(tokens['WBTC'].address);
        const rsETHInfo = await comet.getAssetInfoByAddress(tokens['rsETH'].address);
        const cbETHInfo = await comet.getAssetInfoByAddress(tokens['cbETH'].address);
        const crvInfo = await comet.getAssetInfoByAddress(tokens['CRV'].address);
        const gmxInfo = await comet.getAssetInfoByAddress(tokens['GMX'].address);
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

        collateralsState['WBTC'].seizedValue = mulFactor(wbtcCollateralValue, wbtcInfo.liquidationFactor);
      });

      it('calculates rsETH full seizure values', async () => {
        const rsETHInfo = await comet.getAssetInfoByAddress(tokens['rsETH'].address);
        const cbETHInfo = await comet.getAssetInfoByAddress(tokens['cbETH'].address);
        const crvInfo = await comet.getAssetInfoByAddress(tokens['CRV'].address);
        const gmxInfo = await comet.getAssetInfoByAddress(tokens['GMX'].address);
        const rsETHPrice = (await priceFeeds['rsETH'].latestRoundData())[1].toBigInt();
        const cbETHPrice = (await priceFeeds['cbETH'].latestRoundData())[1].toBigInt();
        const crvPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
        const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();

        // After WBTC full seizure, debt reduces.
        debtRemainingValue -= collateralsState['WBTC'].seizedValue;

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

        collateralsState['rsETH'].seizedValue = mulFactor(rsETHCollateralValue, rsETHInfo.liquidationFactor);
      });

      it('calculates cbETH full seizure values', async () => {
        const cbETHInfo = await comet.getAssetInfoByAddress(tokens['cbETH'].address);
        const crvInfo = await comet.getAssetInfoByAddress(tokens['CRV'].address);
        const gmxInfo = await comet.getAssetInfoByAddress(tokens['GMX'].address);
        const cbETHPrice = (await priceFeeds['cbETH'].latestRoundData())[1].toBigInt();
        const crvPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
        const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();

        // After rsETH full seizure, debt reduces further.
        debtRemainingValue -= collateralsState['rsETH'].seizedValue;

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

        collateralsState['cbETH'].seizedValue = mulFactor(cbETHCollateralValue, cbETHInfo.liquidationFactor);
      });

      it('calculates CRV full seizure values', async () => {
        const crvInfo = await comet.getAssetInfoByAddress(tokens['CRV'].address);
        const gmxInfo = await comet.getAssetInfoByAddress(tokens['GMX'].address);
        const crvPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
        const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();

        // After cbETH full seizure, debt reduces further.
        debtRemainingValue -= collateralsState['cbETH'].seizedValue;

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

        collateralsState['CRV'].seizedValue = mulFactor(crvCollateralValue, crvInfo.liquidationFactor);
      });

      it('calculates GMX partial seizure values', async () => {
        const gmxInfo = await comet.getAssetInfoByAddress(tokens['GMX'].address);
        const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();
        const gmxCollateralValue = mulPrice(gmxAmount, gmxPrice, gmxInfo.scale);

        // After CRV full seizure, debt reduces to about $72.79.
        debtRemainingValue -= collateralsState['CRV'].seizedValue;

        // GMX is worth $120, with $60 of borrow-CF collateral value.
        const totalCollateralizedValue = mulFactor(gmxCollateralValue, gmxInfo.borrowCollateralFactor);

        // Solve the same target HF formula for GMX.
        // It wants about $45.52 of GMX value, so GMX is partially seized.
        const wantedGmxCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
          / (mulFactor(gmxInfo.liquidationFactor, targetHealthFactor) - gmxInfo.borrowCollateralFactor.toBigInt());
        expect(wantedGmxCollateralValue).to.be.lessThan(gmxCollateralValue);

        collateralsState['GMX'].seizeAmount = divPrice(wantedGmxCollateralValue, gmxPrice, gmxInfo.scale);
        collateralsState['GMX'].seizedValue = mulFactor(wantedGmxCollateralValue, gmxInfo.liquidationFactor);
      });

      it('calculates newBalance after all five assets reduce debt', async () => {
        const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['GMX'].seizedValue;
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
        expect(await tokens['WBTC'].balanceOf(comet.address)).to.be.equal(collateralsState['WBTC'].tokenBalanceBefore);
      });

      it('comet ERC20 rsETH token balance does not change during absorb', async () => {
        expect(await tokens['rsETH'].balanceOf(comet.address)).to.be.equal(collateralsState['rsETH'].tokenBalanceBefore);
      });

      it('comet ERC20 cbETH token balance does not change during absorb', async () => {
        expect(await tokens['cbETH'].balanceOf(comet.address)).to.be.equal(collateralsState['cbETH'].tokenBalanceBefore);
      });

      it('comet ERC20 CRV token balance does not change during absorb', async () => {
        expect(await tokens['CRV'].balanceOf(comet.address)).to.be.equal(collateralsState['CRV'].tokenBalanceBefore);
      });

      it('comet ERC20 GMX token balance does not change during absorb', async () => {
        expect(await tokens['GMX'].balanceOf(comet.address)).to.be.equal(collateralsState['GMX'].tokenBalanceBefore);
      });

      it('comet ERC20 base token balance does not change during absorb', async () => {
        expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
      });

      it('alice simple base balance is zero after absorb', async () => {
        expect(await comet.balanceOf(alice.address)).to.be.equal(0);
      });

      it('alice WBTC collateral balance is zero', async () => {
        expect(await comet.collateralBalanceOf(alice.address, tokens['WBTC'].address)).to.be.equal(0);
      });

      it('alice rsETH collateral balance is zero', async () => {
        expect(await comet.collateralBalanceOf(alice.address, tokens['rsETH'].address)).to.be.equal(0);
      });

      it('alice cbETH collateral balance is zero', async () => {
        expect(await comet.collateralBalanceOf(alice.address, tokens['cbETH'].address)).to.be.equal(0);
      });

      it('alice CRV collateral balance is zero', async () => {
        expect(await comet.collateralBalanceOf(alice.address, tokens['CRV'].address)).to.be.equal(0);
      });

      it('alice GMX collateral balance is reduced by the seized amount', async () => {
        expect(await comet.collateralBalanceOf(alice.address, tokens['GMX'].address)).to.be.equal(gmxAmount - collateralsState['GMX'].seizeAmount);
      });

      it('alice assetsIn is zero after WBTC, rsETH, and cbETH are fully seized', async () => {
        expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
      });

      it('alice reserved keeps only GMX after CRV is fully seized', async () => {
        const gmxInfo = await comet.getAssetInfoByAddress(tokens['GMX'].address);

        expect((await comet.userBasic(alice.address))._reserved).to.not.be.equal(reservedBefore);
        expect((await comet.userBasic(alice.address))._reserved).to.be.equal(1 << (gmxInfo.offset - 16));
      });

      it('comet total supplied WBTC is zero', async () => {
        const totalSupplyAsset = (await comet.totalsCollateral(tokens['WBTC'].address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(collateralsState['WBTC'].totalsCollateralBefore.sub(wbtcAmount));
        expect(totalSupplyAsset).to.be.equal(0);
      });

      it('comet total supplied rsETH is zero', async () => {
        const totalSupplyAsset = (await comet.totalsCollateral(tokens['rsETH'].address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(collateralsState['rsETH'].totalsCollateralBefore.sub(rsETHAmount));
        expect(totalSupplyAsset).to.be.equal(0);
      });

      it('comet total supplied cbETH is zero', async () => {
        const totalSupplyAsset = (await comet.totalsCollateral(tokens['cbETH'].address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(collateralsState['cbETH'].totalsCollateralBefore.sub(cbETHAmount));
        expect(totalSupplyAsset).to.be.equal(0);
      });

      it('comet total supplied CRV is zero', async () => {
        const totalSupplyAsset = (await comet.totalsCollateral(tokens['CRV'].address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(collateralsState['CRV'].totalsCollateralBefore.sub(crvAmount));
        expect(totalSupplyAsset).to.be.equal(0);
      });

      it('comet total supplied GMX is reduced by the seized amount', async () => {
        const totalSupplyAsset = (await comet.totalsCollateral(tokens['GMX'].address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(collateralsState['GMX'].totalsCollateralBefore.sub(collateralsState['GMX'].seizeAmount));
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
        expect(await comet.getCollateralReserves(tokens['WBTC'].address)).to.be.equal(collateralsState['WBTC'].collateralReservesBefore.add(wbtcAmount));
      });

      it('comet rsETH collateral reserves increase by all seized rsETH', async () => {
        expect(await comet.getCollateralReserves(tokens['rsETH'].address)).to.be.equal(collateralsState['rsETH'].collateralReservesBefore.add(rsETHAmount));
      });

      it('comet cbETH collateral reserves increase by all seized cbETH', async () => {
        expect(await comet.getCollateralReserves(tokens['cbETH'].address)).to.be.equal(collateralsState['cbETH'].collateralReservesBefore.add(cbETHAmount));
      });

      it('comet CRV collateral reserves increase by all seized CRV', async () => {
        expect(await comet.getCollateralReserves(tokens['CRV'].address)).to.be.equal(collateralsState['CRV'].collateralReservesBefore.add(crvAmount));
      });

      it('comet GMX collateral reserves increase by seized GMX', async () => {
        expect(await comet.getCollateralReserves(tokens['GMX'].address)).to.be.equal(collateralsState['GMX'].collateralReservesBefore.add(collateralsState['GMX'].seizeAmount));
      });

      it('comet total supply base is unchanged', async () => {
        expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
      });
    });

    // This context focuses only on AbsorbCollateral event validation.
    context('emit AbsorbCollateral events for each collateral', function () {
      let absorbTx: ContractTransaction;
      let debtRemainingValue: bigint;

      before(async () => {
        await innerSnapshot.restore();
        debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      });
      after(async () => await innerSnapshot.restore());

      it('absorb is successful', async () => {
        absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
        await expect(absorbTx).to.not.be.reverted;
      });

      it('emits AbsorbCollateral for WBTC full seizure', async () => {
        const wbtcInfo = await comet.getAssetInfoByAddress(tokens['WBTC'].address);
        const wbtcPrice = (await priceFeeds['WBTC'].latestRoundData())[1].toBigInt();
        const wbtcCollateralValue = mulPrice(wbtcAmount, wbtcPrice, wbtcInfo.scale);

        await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
          absorber.address, alice.address, tokens['WBTC'].address, wbtcAmount, wbtcCollateralValue
        );
        debtRemainingValue -= mulFactor(wbtcCollateralValue, wbtcInfo.liquidationFactor);
      });

      it('emits AbsorbCollateral for rsETH full seizure', async () => {
        const rsETHInfo = await comet.getAssetInfoByAddress(tokens['rsETH'].address);
        const rsETHPrice = (await priceFeeds['rsETH'].latestRoundData())[1].toBigInt();
        const rsETHCollateralValue = mulPrice(rsETHAmount, rsETHPrice, rsETHInfo.scale);

        await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
          absorber.address, alice.address, tokens['rsETH'].address, rsETHAmount, rsETHCollateralValue
        );
        debtRemainingValue -= mulFactor(rsETHCollateralValue, rsETHInfo.liquidationFactor);
      });

      it('emits AbsorbCollateral for cbETH full seizure', async () => {
        const cbETHInfo = await comet.getAssetInfoByAddress(tokens['cbETH'].address);
        const cbETHPrice = (await priceFeeds['cbETH'].latestRoundData())[1].toBigInt();
        const cbETHCollateralValue = mulPrice(cbETHAmount, cbETHPrice, cbETHInfo.scale);

        await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
          absorber.address, alice.address, tokens['cbETH'].address, cbETHAmount, cbETHCollateralValue
        );
        debtRemainingValue -= mulFactor(cbETHCollateralValue, cbETHInfo.liquidationFactor);
      });

      it('emits AbsorbCollateral for CRV full seizure', async () => {
        const crvInfo = await comet.getAssetInfoByAddress(tokens['CRV'].address);
        const crvPrice = (await priceFeeds['CRV'].latestRoundData())[1].toBigInt();
        const crvCollateralValue = mulPrice(crvAmount, crvPrice, crvInfo.scale);

        await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
          absorber.address, alice.address, tokens['CRV'].address, crvAmount, crvCollateralValue
        );
        debtRemainingValue -= mulFactor(crvCollateralValue, crvInfo.liquidationFactor);
      });

      it('emits AbsorbCollateral for GMX partial seizure', async () => {
        const gmxInfo = await comet.getAssetInfoByAddress(tokens['GMX'].address);
        const gmxPrice = (await priceFeeds['GMX'].latestRoundData())[1].toBigInt();
        const gmxCollateralValue = mulPrice(gmxAmount, gmxPrice, gmxInfo.scale);

        // At GMX's turn, totalCollateralizedValue holds only GMX's BCF contribution.
        const totalCollateralizedValue = mulFactor(gmxCollateralValue, gmxInfo.borrowCollateralFactor);
        // S = (targetHF * debt - totalCollateralValue) / (targetHF * LF - BCF)
        const wantedGmxCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
          / (mulFactor(gmxInfo.liquidationFactor, targetHealthFactor) - gmxInfo.borrowCollateralFactor.toBigInt());
        const gmxSeizeAmount = divPrice(wantedGmxCollateralValue, gmxPrice, gmxInfo.scale);

        await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
          absorber.address, alice.address, tokens['GMX'].address, gmxSeizeAmount, wantedGmxCollateralValue
        );
      });
    });
  });

  /*//////////////////////////////////////////////////////////////
                          TARGET HF REACHED
  //////////////////////////////////////////////////////////////*/

  context('2 collaterals: partial COMP seizure restores targetHF, WETH untouched (assets index 0 and 1)', function () {
    const compAmount = exp(1, 18); // $100
    const wethAmount = exp(0.001, 18); // $2
    const borrowAmount = exp(80, 6);
    const compDroppedPrice = exp(90, 8); // $90 per COMP
    const wethPrice = exp(2000, 8); // $2000 per WETH

    const collateralKeys = ['COMP', 'WETH'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;

    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let totalSupplyBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

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
      await comet.connect(alice).supply(tokens['COMP'].address, compAmount);
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop COMP 10%: $100 → $90. Position becomes liquidatable:
      // LCF_weighted = 0.85×$90 + 0.80×$2 = $78.1 < debt $80
      await priceFeeds['COMP'].connect(alice).setRoundData(0, compDroppedPrice, 0, 0, 0);
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
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates expected partial seizure amounts for COMP', async () => {
      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);

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
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(
        compAmount - compSeizeAmount
      );
    });

    it('alice WETH balance is unchanged: WETH was not seized', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(wethAmount);
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
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(compSeizeAmount));
    });

    it('comet total supplied WETH is unchanged', async () => {
      expect((await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset).to.be.equal(
        collateralsState['WETH'].totalsCollateralBefore
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
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add(compSeizeAmount)
      );
    });

    it('comet WETH collateral reserves remain zero', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
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
  });

  context('2 collaterals: partial AAVE seizure restores targetHF, LDO untouched (assets index 15 and 16)', function () {
    const aaveAmount = exp(1, 18); // $100 before the price drop
    const ldoAmount = exp(10, 18); // $20
    const borrowAmount = exp(66, 6);

    const collateralKeys = ['AAVE', 'LDO'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;

    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let totalSupplyBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

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
      await comet.connect(alice).supply(tokens['AAVE'].address, aaveAmount);
      await comet.connect(alice).supply(tokens['LDO'].address, ldoAmount);
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
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates expected partial seizure amounts for AAVE', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(tokens['AAVE'].address);
      const ldoInfo = await comet.getAssetInfoByAddress(tokens['LDO'].address);
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

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice AAVE balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['AAVE'].address)).to.be.equal(
        aaveAmount - aaveSeizeAmount
      );
    });

    it('alice LDO balance is unchanged: LDO was not seized', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['LDO'].address)).to.be.equal(ldoAmount);
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
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['AAVE'].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(collateralsState['AAVE'].totalsCollateralBefore.sub(aaveSeizeAmount));
    });

    it('comet total supplied LDO is unchanged', async () => {
      expect((await comet.totalsCollateral(tokens['LDO'].address)).totalSupplyAsset).to.be.equal(
        collateralsState['LDO'].totalsCollateralBefore
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
      expect(await comet.getCollateralReserves(tokens['AAVE'].address)).to.be.equal(
        collateralsState['AAVE'].collateralReservesBefore.add(aaveSeizeAmount)
      );
    });

    it('comet LDO collateral reserves remain zero', async () => {
      expect(await comet.getCollateralReserves(tokens['LDO'].address)).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ERC20 AAVE token balance does not change during absorb', async () => {
      expect(await tokens['AAVE'].balanceOf(comet.address)).to.be.equal(collateralsState['AAVE'].tokenBalanceBefore);
    });

    it('comet ERC20 LDO token balance does not change during absorb', async () => {
      expect(await tokens['LDO'].balanceOf(comet.address)).to.be.equal(collateralsState['LDO'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });
  });

  context('2 non-adjacent collaterals: partial rETH seizure restores targetHF, LDO untouched (assets index 8 and 16)', function () {
    const rEthAmount = exp(0.025, 18); // $87.50 before the price drop
    const ldoAmount = exp(10, 18); // $20
    const borrowAmount = exp(70, 6);

    const collateralKeys = ['rETH', 'LDO'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;

    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let totalSupplyBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

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
      await comet.connect(alice).supply(tokens['rETH'].address, rEthAmount);
      await comet.connect(alice).supply(tokens['LDO'].address, ldoAmount);
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
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates expected partial seizure amounts for rETH', async () => {
      const rEthInfo = await comet.getAssetInfoByAddress(tokens['rETH'].address);
      const ldoInfo = await comet.getAssetInfoByAddress(tokens['LDO'].address);
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

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice rETH balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['rETH'].address)).to.be.equal(
        rEthAmount - rEthSeizeAmount
      );
    });

    it('alice LDO balance is unchanged: LDO was not seized', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['LDO'].address)).to.be.equal(ldoAmount);
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
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['rETH'].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(collateralsState['rETH'].totalsCollateralBefore.sub(rEthSeizeAmount));
    });

    it('comet total supplied LDO is unchanged', async () => {
      expect((await comet.totalsCollateral(tokens['LDO'].address)).totalSupplyAsset).to.be.equal(
        collateralsState['LDO'].totalsCollateralBefore
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
      expect(await comet.getCollateralReserves(tokens['rETH'].address)).to.be.equal(
        collateralsState['rETH'].collateralReservesBefore.add(rEthSeizeAmount)
      );
    });

    it('comet LDO collateral reserves remain zero', async () => {
      expect(await comet.getCollateralReserves(tokens['LDO'].address)).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ERC20 rETH token balance does not change during absorb', async () => {
      expect(await tokens['rETH'].balanceOf(comet.address)).to.be.equal(collateralsState['rETH'].tokenBalanceBefore);
    });

    it('comet ERC20 LDO token balance does not change during absorb', async () => {
      expect(await tokens['LDO'].balanceOf(comet.address)).to.be.equal(collateralsState['LDO'].tokenBalanceBefore);
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

    const collateralKeys = ['rETH', 'AAVE', 'LDO'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;

    let totalBorrowBaseBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldPrincipal: bigint;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let cometBaseTokenBalanceBefore: BigNumber;

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
      await comet.connect(alice).supply(tokens['rETH'].address, rEthAmount);
      await comet.connect(alice).supply(tokens['AAVE'].address, aaveAmount);
      await comet.connect(alice).supply(tokens['LDO'].address, ldoAmount);
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
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldPrincipal = principal.toBigInt();
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

    it('calculates rETH full seizure values', async () => {
      const rEthInfo = await comet.getAssetInfoByAddress(tokens['rETH'].address);
      const aaveInfo = await comet.getAssetInfoByAddress(tokens['AAVE'].address);
      const ldoInfo = await comet.getAssetInfoByAddress(tokens['LDO'].address);
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
      const rEthInfo = await comet.getAssetInfoByAddress(tokens['rETH'].address);
      const aaveInfo = await comet.getAssetInfoByAddress(tokens['AAVE'].address);

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

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice rETH balance is zero after full seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['rETH'].address)).to.be.equal(0);
    });

    it('alice AAVE balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['AAVE'].address)).to.be.equal(
        aaveAmount - aaveSeizeAmount
      );
    });

    it('alice LDO balance is unchanged: LDO was not seized', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['LDO'].address)).to.be.equal(ldoAmount);
    });

    it('alice still has remaining debt after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(0);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal((debtAfterAave * baseScale / baseTokenPrice));
    });

    it('alice is no longer liquidatable after partial seizure restored targetHF', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.false;
    });

    it('alice assetsIn keeps only AAVE after rETH full seizure', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(tokens['AAVE'].address);

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
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['rETH'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['rETH'].totalsCollateralBefore.sub(rEthSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied AAVE is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['AAVE'].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(collateralsState['AAVE'].totalsCollateralBefore.sub(aaveSeizeAmount));
    });

    it('comet total supplied LDO is unchanged', async () => {
      expect((await comet.totalsCollateral(tokens['LDO'].address)).totalSupplyAsset).to.be.equal(
        collateralsState['LDO'].totalsCollateralBefore
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
      expect(await comet.getCollateralReserves(tokens['rETH'].address)).to.be.equal(
        collateralsState['rETH'].collateralReservesBefore.add(rEthSeizeAmount)
      );
    });

    it('comet AAVE collateral reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['AAVE'].address)).to.be.equal(
        collateralsState['AAVE'].collateralReservesBefore.add(aaveSeizeAmount)
      );
    });

    it('comet LDO collateral reserves remain zero', async () => {
      expect(await comet.getCollateralReserves(tokens['LDO'].address)).to.be.equal(0);
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ERC20 rETH token balance does not change during absorb', async () => {
      expect(await tokens['rETH'].balanceOf(comet.address)).to.be.equal(collateralsState['rETH'].tokenBalanceBefore);
    });

    it('comet ERC20 AAVE token balance does not change during absorb', async () => {
      expect(await tokens['AAVE'].balanceOf(comet.address)).to.be.equal(collateralsState['AAVE'].tokenBalanceBefore);
    });

    it('comet ERC20 LDO token balance does not change during absorb', async () => {
      expect(await tokens['LDO'].balanceOf(comet.address)).to.be.equal(collateralsState['LDO'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });
  });

  /*//////////////////////////////////////////////////////////////
                            24 COLLATERALS
  //////////////////////////////////////////////////////////////*/

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
 
    let collateralsState: Record<string, CollateralState> = {};
    let collateralAmounts: bigint[] = [];
    let collateralValues: bigint[] = [];
    let collateralPrices: bigint[] = [];
    let wantedCollateralValues: bigint[] = [];
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

      collateralAmounts = [];
      collateralValues = [];
      collateralPrices = [];
      wantedCollateralValues = Array(assetSymbols.length).fill(0n);

      for (let i = 0; i < assetSymbols.length; i++) {
        const asset = tokens[assetSymbols[i]];
        const assetInfo = await comet.getAssetInfoByAddress(asset.address);
        const initialAssetPrice = (await priceFeeds[assetSymbols[i]].latestRoundData())[1].toBigInt();
        const finalAssetPrice = initialAssetPrice / 2n;
        const amount = divPrice(targetCollateralValues[i], finalAssetPrice, assetInfo.scale);

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
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldPrincipal = principal.toBigInt();
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      collateralsState = await makeCollateralStates(comet, tokens, assetSymbols);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates full seizure values for asset indexes 0 through 4', async () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      totalCollateralizedValue = 0n;

      for (let i = 0; i < assetSymbols.length; i++) {
        const assetInfo = await comet.getAssetInfoByAddress(tokens[assetSymbols[i]].address);
        totalCollateralizedValue += mulFactor(collateralValues[i], assetInfo.borrowCollateralFactor);
      }

      for (let i = 0; i < firstFullSeizureCount; i++) {
        const assetInfo = await comet.getAssetInfoByAddress(tokens[assetSymbols[i]].address);

        // S = (targetHF * debt - totalCollateralValue) / (targetHF * LF - BCF)
        // The first five supplied collateral values are small, so each wanted value exceeds what Alice has.
        wantedCollateralValues[i] =
          (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
          / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
        expect(wantedCollateralValues[i]).to.be.greaterThan(collateralValues[i]);

        wantedCollateralValues[i] = collateralValues[i];
        collateralsState[assetSymbols[i]].seizeAmount = collateralAmounts[i];
        collateralsState[assetSymbols[i]].seizedValue = mulFactor(collateralValues[i], assetInfo.liquidationFactor);
        debtRemainingValue -= collateralsState[assetSymbols[i]].seizedValue;
        totalCollateralizedValue -= mulFactor(collateralValues[i], assetInfo.borrowCollateralFactor);
      }
    });

    it('calculates partial seizure values for asset index 5', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens[assetSymbols[partialSeizureIndex]].address);

      // After the first five assets are fully seized, wstETH has enough value to restore targetHF partially.
      wantedCollateralValues[partialSeizureIndex] =
        (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValues[partialSeizureIndex]).to.be.lessThan(collateralValues[partialSeizureIndex]);

      collateralsState[assetSymbols[partialSeizureIndex]].seizeAmount = divPrice(
        wantedCollateralValues[partialSeizureIndex],
        collateralPrices[partialSeizureIndex],
        assetInfo.scale
      );
      collateralsState[assetSymbols[partialSeizureIndex]].seizedValue = mulFactor(wantedCollateralValues[partialSeizureIndex], assetInfo.liquidationFactor);

      debtAfterPartialSeizure = debtRemainingValue - collateralsState[assetSymbols[partialSeizureIndex]].seizedValue;
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

    it('AbsorbDebt event is emitted', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice balances for asset indexes 0 through 4 are zero after full seizure', async () => {
      for (let i = 0; i < firstFullSeizureCount; i++) {
        expect(await comet.collateralBalanceOf(alice.address, tokens[assetSymbols[i]].address)).to.be.equal(0);
      }
    });

    it('alice balance for asset index 5 is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens[assetSymbols[partialSeizureIndex]].address)).to.be.equal(
        collateralAmounts[partialSeizureIndex] - collateralsState[assetSymbols[partialSeizureIndex]].seizeAmount
      );
    });

    it('alice balances for asset indexes 6 through 23 are unchanged', async () => {
      for (let i = partialSeizureIndex + 1; i < assetSymbols.length; i++) {
        expect(await comet.collateralBalanceOf(alice.address, tokens[assetSymbols[i]].address)).to.be.equal(collateralAmounts[i]);
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
        const totalSupplyAsset = (await comet.totalsCollateral(tokens[assetSymbols[i]].address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(collateralsState[assetSymbols[i]].totalsCollateralBefore.sub(collateralsState[assetSymbols[i]].seizeAmount));
        expect(totalSupplyAsset).to.be.equal(0);
      }
    });

    it('comet total supplied collateral for asset index 5 is reduced by the seized amount', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens[assetSymbols[partialSeizureIndex]].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(
        collateralsState[assetSymbols[partialSeizureIndex]].totalsCollateralBefore.sub(collateralsState[assetSymbols[partialSeizureIndex]].seizeAmount)
      );
    });

    it('comet total supplied collateral for asset indexes 6 through 23 is unchanged', async () => {
      for (let i = partialSeizureIndex + 1; i < assetSymbols.length; i++) {
        expect((await comet.totalsCollateral(tokens[assetSymbols[i]].address)).totalSupplyAsset).to.be.equal(collateralsState[assetSymbols[i]].totalsCollateralBefore);
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
        expect(await comet.getCollateralReserves(tokens[assetSymbols[i]].address)).to.be.equal(
          collateralsState[assetSymbols[i]].collateralReservesBefore.add(collateralsState[assetSymbols[i]].seizeAmount)
        );
      }
    });

    it('comet collateral reserves remain zero for asset indexes 6 through 23', async () => {
      for (let i = partialSeizureIndex + 1; i < assetSymbols.length; i++) {
        expect(await comet.getCollateralReserves(tokens[assetSymbols[i]].address)).to.be.equal(0);
      }
    });

    it('comet base reserves are reduced by the base paid out', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet ERC20 collateral token balances do not change during absorb', async () => {
      for (let i = 0; i < assetSymbols.length; i++) {
        expect(await tokens[assetSymbols[i]].balanceOf(comet.address)).to.be.equal(collateralsState[assetSymbols[i]].tokenBalanceBefore);
      }
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });
  });

  context('24 collaterals: assets 0-22 fully seized, sUSDe (asset 23) partially seized, user remains borrower', function () {
    const targetCollateralUsdPerAsset = exp(12, 8); // ~$12 per asset - keeps absorb from hitting target HF early
    const assetSymbols23 = Object.keys(default24Assets()).filter((s) => s !== 'USDC' && s !== 'sUSDe');
    const sUsDeAmount = exp(380, 18);
    const borrowAmount = exp(457.5, 6);
    const droppedSUsDePrice = exp(0.8, 8);
    
    const collateralKeys = ['sUSDe'];
    let collateralsState: Record<string, CollateralState>;
    let assetSupplyAmounts: { [symbol: string]: bigint } = {};
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
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
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase;
      oldBalance = presentValue(borrowPrincipalBefore, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      cometErc20CollateralBefore23 = {};
      for (const sym of assetSymbols23) {
        cometErc20CollateralBefore23[sym] = await tokens[sym].balanceOf(comet.address);
      }
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
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

      collateralsState['sUSDe'].seizeAmount = divPrice(sUsDeWantedCollateralValue, droppedSUsDePrice, sUsDeInfo.scale);
      collateralsState['sUSDe'].seizedValue = mulFactor(sUsDeWantedCollateralValue, sUsDeInfo.liquidationFactor);
    });

    it('calculates newBalance after sUSDe partial seizure', () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['sUSDe'].seizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, tokens['sUSDe'].address)).to.be.equal(sUsDeAmount - collateralsState['sUSDe'].seizeAmount);
    });

    it('comet total supplied sUSDe is reduced by the seized amount and still positive', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['sUSDe'].address)).totalSupplyAsset;
      expect(totalSupplyAsset).to.be.equal(collateralsState['sUSDe'].totalsCollateralBefore.sub(collateralsState['sUSDe'].seizeAmount));
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
      expect(await comet.getCollateralReserves(tokens['sUSDe'].address)).to.be.equal(collateralsState['sUSDe'].collateralReservesBefore.add(collateralsState['sUSDe'].seizeAmount));
    });

    it('comet ERC20 sUSDe token balance does not change during absorb', async () => {
      expect(await tokens['sUSDe'].balanceOf(comet.address)).to.be.equal(collateralsState['sUSDe'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });
});