import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, default24Assets,
  CollateralState, makeCollateralStates } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

describe('partial liquidation: bad debt', function() {
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

    // Make reserves on comet for borrowings
    await baseToken.allocateTo(comet.address, initialBaseFunding);

    targetHealthFactor = (await comet.targetHealthFactor()).toBigInt();
    snapshot = await takeSnapshot();
  });

  context('1 collateral: full seizure, user has not enough collateral to cover debt (asset index 0)', function () {
    const collateralAmount = exp(1, 18); // 1 COMP, initially worth $100
    const borrowAmount = exp(80, 6); // $80

    const collateralKeys = ['COMP'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop COMP by 50%. Alice's 1 COMP is now worth only $50,
      // so the collateral cannot repay the $80 debt even after full seizure.
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const newCompPrice = compPrice * 50n / 100n;
      await priceFeeds['COMP'].connect(alice).setRoundData(0, newCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
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

    it('full seizure of collateral amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1];

      // Debt is $80 and 1 COMP is now worth $50.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const collateralValue = mulPrice(collateralAmount, compPrice, assetInfo.scale);

      // The target HF formula wants more than $50 of collateral, so the contract seizes all COMP.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValue).to.be.greaterThan(collateralValue);

      // Full seizure means seizeAmount is 1 COMP and seizedValue is $50 * LF 0.90 = $45.
      collateralsState['COMP'].seizeAmount = collateralAmount;
      collateralsState['COMP'].seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after full seizure bad debt handling', async () => {
      // The full seizure repays about $45 of the $80 debt, leaving about $35 unpaid.
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['COMP'].seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('since all collateral is gone, the contract writes off the residual bad debt', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after full seizure', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after full seizure', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice assetsIn is cleared', async () => {
      expect(assetsInBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet total supplied collateral is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full borrow amount', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('1 collateral: full seizure, user has not enough collateral to cover debt (asset index 16)', function () {
    const collateralAmount = exp(100, 18); // 100 LDO, initially worth $200
    const borrowAmount = exp(80, 6); // $80

    const collateralKeys = ['LDO'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['LDO'].address, collateralAmount); // index 16 in default24Assets
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop LDO from $2 to $0.50. The collateral is now worth $50,
      // so it cannot cover the $80 debt even after full seizure.
      await priceFeeds['LDO'].connect(alice).setRoundData(0, exp(0.5, 8), 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
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

    it('full seizure of the first collateral amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['LDO'].address);
      const price = (await priceFeeds['LDO'].latestRoundData())[1];

      // Debt is $80 and 100 LDO is now worth $50.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const collateralValue = mulPrice(collateralAmount, price, assetInfo.scale);

      // The target HF formula wants more than $50 of collateral, so the contract seizes all LDO.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValue).to.be.greaterThan(collateralValue);

      collateralsState['LDO'].seizeAmount = collateralAmount;
      collateralsState['LDO'].seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after full seizure bad debt handling', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['LDO'].seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('since all collateral is gone, the contract writes off the residual bad debt', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after full seizure', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after full seizure', async () => {
      const principal = (await comet.userBasic(alice.address)).principal;
      expect(principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['LDO'].address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await tokens['LDO'].balanceOf(comet.address)).to.be.equal(collateralsState['LDO'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice assetsIn remains zero', async () => {
      expect(assetsInBefore).to.be.equal(0);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are cleared', async () => {
      expect(reservedBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied collateral is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['LDO'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['LDO'].totalsCollateralBefore.sub(collateralsState['LDO'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full borrow amount', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['LDO'].address)).to.be.equal(collateralsState['LDO'].collateralReservesBefore.add(collateralsState['LDO'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('1 collateral: full seizure, user has not enough collateral to cover debt (last asset index)', function () {
    const collateralAmount = exp(100, 18); // 100 last-index tokens, initially worth $100
    const borrowAmount = exp(70, 6); // $70

    const collateralKeys = ['sUSDe'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['sUSDe'].address, collateralAmount); // last index in default24Assets
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop the last asset from $1 to $0.50. The collateral is now worth $50,
      // so it cannot cover the $70 debt even after full seizure.
      await priceFeeds['sUSDe'].connect(alice).setRoundData(0, exp(0.5, 8), 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
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

    it('full seizure of the last collateral amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);
      const price = (await priceFeeds['sUSDe'].latestRoundData())[1];

      // Debt is $70 and 100 tokens at the last index are now worth $50.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const collateralValue = mulPrice(collateralAmount, price, assetInfo.scale);

      // The target HF formula wants more than $50 of collateral, so the contract seizes all of it.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValue).to.be.greaterThan(collateralValue);

      collateralsState['sUSDe'].seizeAmount = collateralAmount;
      collateralsState['sUSDe'].seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after full seizure bad debt handling', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['sUSDe'].seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('since all collateral is gone, the contract writes off the residual bad debt', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after full seizure', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after full seizure', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(newBalance);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['sUSDe'].address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await tokens['sUSDe'].balanceOf(comet.address)).to.be.equal(collateralsState['sUSDe'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice assetsIn remains zero', async () => {
      expect(assetsInBefore).to.be.equal(0);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are cleared', async () => {
      expect(reservedBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied collateral is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['sUSDe'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['sUSDe'].totalsCollateralBefore.sub(collateralsState['sUSDe'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full borrow amount', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['sUSDe'].address)).to.be.equal(collateralsState['sUSDe'].collateralReservesBefore.add(collateralsState['sUSDe'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of first asset then full seizure of second (assets index 0 and 1)', function () {
    const compAmount = exp(0.5, 18); // 0.5 COMP, worth $50 before the price drop
    const wethAmount = exp(0.0275, 18); // 0.0275 WETH at $2,000 = $55
    const borrowAmount = exp(80, 6); // $80

    const collateralKeys = ['COMP', 'WETH'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, compAmount);
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop both assets by 20%.
      // COMP: $50 supplied value -> $40. WETH: $55 supplied value -> $44.
      // Together they cannot cover the $80 debt after liquidation factors,
      // so the contract should fully seize both assets and write off bad debt.
      await priceFeeds['COMP'].connect(alice).setRoundData(0, exp(80, 8), 0, 0, 0);
      await priceFeeds['WETH'].connect(alice).setRoundData(0, exp(1600, 8), 0, 0, 0);
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

    it('full seizure of the first collateral asset', async () => {
      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1];
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1];

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // COMP is first in asset order. After the 20% price drop, 0.5 COMP is worth $40.
      const compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale);
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      // The target HF formula wants more than $40 from COMP, so COMP is fully seized.
      const wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);

      collateralsState['COMP'].seizeAmount = compAmount;
      collateralsState['COMP'].seizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
    });

    it('full seizure of the second collateral asset', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1];
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);

      // After COMP full seizure, debt is $80 - $36 = $44.
      debtRemainingValue -= collateralsState['COMP'].seizedValue;

      // WETH is worth $44, but the target HF formula wants more than all of it,
      // so the second asset is also fully seized.
      const totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);
      const wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWethCollateralValue).to.be.greaterThan(wethCollateralValue);

      collateralsState['WETH'].seizeAmount = wethAmount;
      collateralsState['WETH'].seizedValue = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      // Both assets together repay $36 + $39.60 = $75.60, leaving $4.40 bad debt.
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['WETH'].seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('newBalance becomes zero as residual bad debt is written off', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after both assets are fully seized', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after both assets are fully seized', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect(assetsInBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
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

    it('comet base reserves are reduced by the full borrow amount', async () => {
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

  context('multi-collateral: full seizure of first asset then full seizure of second (assets index 15 and 16)', function () {
    const aaveAmount = exp(0.4, 18); // 0.4 AAVE, worth $40 before the price drop
    const ldoAmount = exp(20, 18); // 20 LDO, worth $40 before the price drop
    const borrowAmount = exp(45, 6); // $45

    const collateralKeys = ['AAVE', 'LDO'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['AAVE'].address, aaveAmount);
      await comet.connect(alice).supply(tokens['LDO'].address, ldoAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop both assets by 50%. Together they still cannot cover the $45 debt
      // after liquidation factors, so the contract fully seizes both assets.
      await priceFeeds['AAVE'].connect(alice).setRoundData(0, exp(50, 8), 0, 0, 0);
      await priceFeeds['LDO'].connect(alice).setRoundData(0, exp(1, 8), 0, 0, 0);
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

    it('full AAVE seizure', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(tokens['AAVE'].address);
      const ldoInfo = await comet.getAssetInfoByAddress(tokens['LDO'].address);
      const aavePrice = (await priceFeeds['AAVE'].latestRoundData())[1];
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1];

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const aaveCollateralValue = mulPrice(aaveAmount, aavePrice, aaveInfo.scale);
      const ldoCollateralValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);
      const totalCollateralizedValue =
        mulFactor(aaveCollateralValue, aaveInfo.borrowCollateralFactor) +
        mulFactor(ldoCollateralValue, ldoInfo.borrowCollateralFactor);

      const wantedAaveCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(aaveInfo.liquidationFactor, targetHealthFactor) - aaveInfo.borrowCollateralFactor.toBigInt());
      expect(wantedAaveCollateralValue).to.be.greaterThan(aaveCollateralValue);

      collateralsState['AAVE'].seizeAmount = aaveAmount;
      collateralsState['AAVE'].seizedValue = mulFactor(aaveCollateralValue, aaveInfo.liquidationFactor);
    });

    it('full LDO seizure', async () => {
      const ldoInfo = await comet.getAssetInfoByAddress(tokens['LDO'].address);
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1];
      const ldoCollateralValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);

      debtRemainingValue -= collateralsState['AAVE'].seizedValue;
      const totalCollateralizedValue = mulFactor(ldoCollateralValue, ldoInfo.borrowCollateralFactor);
      const wantedLdoCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(ldoInfo.liquidationFactor, targetHealthFactor) - ldoInfo.borrowCollateralFactor.toBigInt());
      expect(wantedLdoCollateralValue).to.be.greaterThan(ldoCollateralValue);

      collateralsState['LDO'].seizeAmount = ldoAmount;
      collateralsState['LDO'].seizedValue = mulFactor(ldoCollateralValue, ldoInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['LDO'].seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('newBalance becomes zero as residual bad debt is written off', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after both assets are fully seized', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after both assets are fully seized', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice AAVE collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['AAVE'].address)).to.be.equal(0);
    });

    it('alice LDO collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['LDO'].address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are cleared', async () => {
      expect(reservedBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied AAVE is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['AAVE'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['AAVE'].totalsCollateralBefore.sub(collateralsState['AAVE'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied LDO is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['LDO'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['LDO'].totalsCollateralBefore.sub(collateralsState['LDO'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full borrow amount', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet AAVE collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['AAVE'].address)).to.be.equal(collateralsState['AAVE'].collateralReservesBefore.add(collateralsState['AAVE'].seizeAmount));
    });

    it('comet LDO collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['LDO'].address)).to.be.equal(collateralsState['LDO'].collateralReservesBefore.add(collateralsState['LDO'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of first asset then full seizure of second (last two asset indexes: 22 and 23)', function () {
    const usdeAmount = exp(50, 18); // 50 USDe, worth $50 before the price drop
    const susdeAmount = exp(50, 18); // 50 sUSDe, worth $50 before the price drop
    const borrowAmount = exp(70, 6); // $70

    const collateralKeys = ['USDe', 'sUSDe'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['USDe'].address, usdeAmount);
      await comet.connect(alice).supply(tokens['sUSDe'].address, susdeAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop both assets by 30%. Together they still cannot cover the $70 debt
      // after liquidation factors, so the contract fully seizes both assets.
      await priceFeeds['USDe'].connect(alice).setRoundData(0, exp(0.7, 8), 0, 0, 0);
      await priceFeeds['sUSDe'].connect(alice).setRoundData(0, exp(0.7, 8), 0, 0, 0);
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

    it('full USDe seizure', async () => {
      const usdeInfo = await comet.getAssetInfoByAddress(tokens['USDe'].address);
      const susdeInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);
      const usdePrice = (await priceFeeds['USDe'].latestRoundData())[1];
      const susdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1];

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const usdeCollateralValue = mulPrice(usdeAmount, usdePrice, usdeInfo.scale);
      const susdeCollateralValue = mulPrice(susdeAmount, susdePrice, susdeInfo.scale);
      const totalCollateralizedValue =
        mulFactor(usdeCollateralValue, usdeInfo.borrowCollateralFactor) +
        mulFactor(susdeCollateralValue, susdeInfo.borrowCollateralFactor);

      const wantedUsdeCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(usdeInfo.liquidationFactor, targetHealthFactor) - usdeInfo.borrowCollateralFactor.toBigInt());
      expect(wantedUsdeCollateralValue).to.be.greaterThan(usdeCollateralValue);

      collateralsState['USDe'].seizeAmount = usdeAmount;
      collateralsState['USDe'].seizedValue = mulFactor(usdeCollateralValue, usdeInfo.liquidationFactor);
    });

    it('full sUSDe seizure', async () => {
      const susdeInfo = await comet.getAssetInfoByAddress(tokens['sUSDe'].address);
      const susdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1];
      const susdeCollateralValue = mulPrice(susdeAmount, susdePrice, susdeInfo.scale);

      debtRemainingValue -= collateralsState['USDe'].seizedValue;
      const totalCollateralizedValue = mulFactor(susdeCollateralValue, susdeInfo.borrowCollateralFactor);
      const wantedSusdeCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(susdeInfo.liquidationFactor, targetHealthFactor) - susdeInfo.borrowCollateralFactor.toBigInt());
      expect(wantedSusdeCollateralValue).to.be.greaterThan(susdeCollateralValue);

      collateralsState['sUSDe'].seizeAmount = susdeAmount;
      collateralsState['sUSDe'].seizedValue = mulFactor(susdeCollateralValue, susdeInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['sUSDe'].seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('newBalance becomes zero as residual bad debt is written off', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after both assets are fully seized', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after both assets are fully seized', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice USDe collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['USDe'].address)).to.be.equal(0);
    });

    it('alice sUSDe collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['sUSDe'].address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are cleared', async () => {
      expect(reservedBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied USDe is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['USDe'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['USDe'].totalsCollateralBefore.sub(collateralsState['USDe'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied sUSDe is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['sUSDe'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['sUSDe'].totalsCollateralBefore.sub(collateralsState['sUSDe'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full borrow amount', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet USDe collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['USDe'].address)).to.be.equal(collateralsState['USDe'].collateralReservesBefore.add(collateralsState['USDe'].seizeAmount));
    });

    it('comet sUSDe collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['sUSDe'].address)).to.be.equal(collateralsState['sUSDe'].collateralReservesBefore.add(collateralsState['sUSDe'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of first asset then full seizure of second (assets index 14 and 18)', function () {
    const uniAmount = exp(5, 18); // 5 UNI, worth $40 before the price drop
    const mkrAmount = exp(0.016, 18); // 0.016 MKR, worth $40 before the price drop
    const borrowAmount = exp(45, 6); // $45

    const collateralKeys = ['UNI', 'MKR'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['UNI'].address, uniAmount);
      await comet.connect(alice).supply(tokens['MKR'].address, mkrAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop both assets by 50%. Together they still cannot cover the $45 debt
      // after liquidation factors, so the contract fully seizes both assets.
      await priceFeeds['UNI'].connect(alice).setRoundData(0, exp(4, 8), 0, 0, 0);
      await priceFeeds['MKR'].connect(alice).setRoundData(0, exp(1250, 8), 0, 0, 0);
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

    it('full UNI seizure', async () => {
      const uniInfo = await comet.getAssetInfoByAddress(tokens['UNI'].address);
      const mkrInfo = await comet.getAssetInfoByAddress(tokens['MKR'].address);
      const uniPrice = (await priceFeeds['UNI'].latestRoundData())[1];
      const mkrPrice = (await priceFeeds['MKR'].latestRoundData())[1];

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const uniCollateralValue = mulPrice(uniAmount, uniPrice, uniInfo.scale);
      const mkrCollateralValue = mulPrice(mkrAmount, mkrPrice, mkrInfo.scale);
      const totalCollateralizedValue =
        mulFactor(uniCollateralValue, uniInfo.borrowCollateralFactor) +
        mulFactor(mkrCollateralValue, mkrInfo.borrowCollateralFactor);

      const wantedUniCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(uniInfo.liquidationFactor, targetHealthFactor) - uniInfo.borrowCollateralFactor.toBigInt());
      expect(wantedUniCollateralValue).to.be.greaterThan(uniCollateralValue);

      collateralsState['UNI'].seizeAmount = uniAmount;
      collateralsState['UNI'].seizedValue = mulFactor(uniCollateralValue, uniInfo.liquidationFactor);
    });

    it('full MKR seizure', async () => {
      const mkrInfo = await comet.getAssetInfoByAddress(tokens['MKR'].address);
      const mkrPrice = (await priceFeeds['MKR'].latestRoundData())[1];
      const mkrCollateralValue = mulPrice(mkrAmount, mkrPrice, mkrInfo.scale);

      debtRemainingValue -= collateralsState['UNI'].seizedValue;
      const totalCollateralizedValue = mulFactor(mkrCollateralValue, mkrInfo.borrowCollateralFactor);
      const wantedMkrCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(mkrInfo.liquidationFactor, targetHealthFactor) - mkrInfo.borrowCollateralFactor.toBigInt());
      expect(wantedMkrCollateralValue).to.be.greaterThan(mkrCollateralValue);

      collateralsState['MKR'].seizeAmount = mkrAmount;
      collateralsState['MKR'].seizedValue = mulFactor(mkrCollateralValue, mkrInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['MKR'].seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('newBalance becomes zero as residual bad debt is written off', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after both assets are fully seized', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after both assets are fully seized', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice UNI collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['UNI'].address)).to.be.equal(0);
    });

    it('alice MKR collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['MKR'].address)).to.be.equal(0);
    });

    it('comet ERC20 UNI token balance does not change during absorb', async () => {
      expect(await tokens['UNI'].balanceOf(comet.address)).to.be.equal(collateralsState['UNI'].tokenBalanceBefore);
    });

    it('comet ERC20 MKR token balance does not change during absorb', async () => {
      expect(await tokens['MKR'].balanceOf(comet.address)).to.be.equal(collateralsState['MKR'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice assetsIn is cleared', async () => {
      expect(assetsInBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are cleared', async () => {
      expect(reservedBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied UNI is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['UNI'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['UNI'].totalsCollateralBefore.sub(collateralsState['UNI'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied MKR is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['MKR'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['MKR'].totalsCollateralBefore.sub(collateralsState['MKR'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full borrow amount', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet UNI collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['UNI'].address)).to.be.equal(collateralsState['UNI'].collateralReservesBefore.add(collateralsState['UNI'].seizeAmount));
    });

    it('comet MKR collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['MKR'].address)).to.be.equal(collateralsState['MKR'].collateralReservesBefore.add(collateralsState['MKR'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: 5 different collaterals with non following asset indexes', function () {
    const collateralConfigs = [
      { symbol: 'WBTC', index: 3, amount: exp(0.0004, 8), droppedPrice: exp(32500, 8) },
      { symbol: 'cbETH', index: 7, amount: exp(0.01, 18), droppedPrice: exp(1650, 8) },
      { symbol: 'AAVE', index: 15, amount: exp(0.3, 18), droppedPrice: exp(50, 8) },
      { symbol: 'ARB', index: 19, amount: exp(30, 18), droppedPrice: exp(0.5, 8) },
      { symbol: 'tBTC', index: 12, amount: exp(0.0004, 18), droppedPrice: exp(32500, 8) },
    ];
    const borrowAmount = exp(65, 6); // $65

    const collateralKeys = collateralConfigs.map(c => c.symbol);
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let innerSnapshot: SnapshotRestorer;

    before(async function() {
      for (const config of collateralConfigs) {
        await comet.connect(alice).supply(tokens[config.symbol].address, config.amount);
      }
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop every collateral by 50%. The five assets still cannot cover the $65 debt
      // after liquidation factors, so the contract fully seizes each one and writes off bad debt.
      for (const config of collateralConfigs) {
        await priceFeeds[config.symbol].connect(alice).setRoundData(0, config.droppedPrice, 0, 0, 0);
      }
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
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);

      innerSnapshot = await takeSnapshot();
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    context('full seizure of 5 collaterals', function () {
      it('absorb is successful', async () => {
        absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
        await expect(absorbTx).to.not.be.reverted;
      });
  
      it('full seizure of all collaterals', async () => {
        for (const [index, config] of collateralConfigs.entries()) {
          const assetInfo = await comet.getAssetInfoByAddress(tokens[config.symbol].address);
          const price = (await priceFeeds[config.symbol].latestRoundData())[1];
          let remainingCollateralizedValue = 0n;
  
          const collateralValue = mulPrice(config.amount, price, assetInfo.scale);
  
          const remainingConfigs = collateralConfigs.slice(index);
          for (const remainingConfig of remainingConfigs) {
            const remainingInfo = await comet.getAssetInfoByAddress(tokens[remainingConfig.symbol].address);
            const remainingPrice = (await priceFeeds[remainingConfig.symbol].latestRoundData())[1];
            const remainingValue = mulPrice(remainingConfig.amount, remainingPrice, remainingInfo.scale);
            remainingCollateralizedValue += mulFactor(remainingValue, remainingInfo.borrowCollateralFactor);
          }
  
          const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - remainingCollateralizedValue) * factorScale
            / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
          expect(wantedCollateralValue).to.be.greaterThan(collateralValue);
  
          debtRemainingValue -= mulFactor(collateralValue, assetInfo.liquidationFactor);
        }
      });
  
      it('calculates newBalance as zero after all assets are fully seized', async () => {
        const balanceBeforeBadDebtWriteOff = -(debtRemainingValue * baseScale / baseTokenPrice);
        expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
      });
  
      it('newBalance becomes zero as residual bad debt is written off', async () => {
        newBalance = 0n;
      });
  
      it('alice borrow balance is zero after all assets are fully seized', async () => {
        expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
      });
  
      it('alice principal is zero after all assets are fully seized', async () => {
        expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
      });
  
      it('alice simple base balance is zero after absorb', async () => {
        expect(await comet.balanceOf(alice.address)).to.be.equal(0);
      });
  
      it('AbsorbDebt event is emitted for the full borrow amount', async () => {
        basePaidOut = newBalance - oldBalance;
        const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
  
        await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
      });
  
      for (const config of collateralConfigs) {
        it(`alice ${config.symbol} collateral balance is zero`, async () => {
          expect(await comet.collateralBalanceOf(alice.address, tokens[config.symbol].address)).to.be.equal(0);
        });
      }
  
      for (const config of collateralConfigs) {
        it(`comet ERC20 ${config.symbol} token balance does not change during absorb`, async () => {
          expect(await tokens[config.symbol].balanceOf(comet.address)).to.be.equal(collateralsState[config.symbol].tokenBalanceBefore);
        });
      }
  
      it('comet ERC20 base token balance does not change during absorb', async () => {
        expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
      });
  
      it('alice assetsIn is cleared', async () => {
        expect(assetsInBefore).to.not.equal(0);
        expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
      });
  
      it('alice reserved bits are cleared', async () => {
        expect(reservedBefore).to.not.equal(0);
        expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
      });
  
      for (const config of collateralConfigs) {
        it(`comet total supplied ${config.symbol} is zero`, async () => {
          const totalSupplyAsset = (await comet.totalsCollateral(tokens[config.symbol].address)).totalSupplyAsset;
  
          expect(totalSupplyAsset).to.be.equal(collateralsState[config.symbol].totalsCollateralBefore.sub(config.amount));
          expect(totalSupplyAsset).to.be.equal(0);
        });
      }
  
      it('comet total borrow base is zero', async () => {
        const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;
  
        expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
        expect(totalBorrowBase).to.be.equal(0);
      });
  
      it('comet base reserves are reduced by the full borrow amount', async () => {
        expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
      });
  
      for (const config of collateralConfigs) {
        it(`comet ${config.symbol} collateral reserves increase by all seized collateral`, async () => {
          expect(await comet.getCollateralReserves(tokens[config.symbol].address)).to.be.equal(
            collateralsState[config.symbol].collateralReservesBefore.add(config.amount)
          );
        });
      }
  
      it('comet total supply base is unchanged', async () => {
        expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
      });
    });
  
    // this context focuses only on AbsorbCollateral event validation.
    context('emit AbsorbCollateral events properly for each collateral', function () {
      before(async () => {
        await innerSnapshot.restore();
        debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      });
      after(async () => await innerSnapshot.restore());
  
      it('absorb is successful', async () => {
        absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
        await expect(absorbTx).to.not.be.reverted;
      });
  
      for (const [index, config] of collateralConfigs.entries()) {
        it(`emits AbsorbCollateral for full ${config.symbol} seizure`, async () => {
          const assetInfo = await comet.getAssetInfoByAddress(tokens[config.symbol].address);
          const price = (await priceFeeds[config.symbol].latestRoundData())[1].toBigInt();
          let remainingCollateralizedValue = 0n;
  
          const collateralValue = mulPrice(config.amount, price, assetInfo.scale.toBigInt());
  
          const remainingConfigs = collateralConfigs.slice(index);
          for (const remainingConfig of remainingConfigs) {
            const remainingInfo = await comet.getAssetInfoByAddress(tokens[remainingConfig.symbol].address);
            const remainingPrice = (await priceFeeds[remainingConfig.symbol].latestRoundData())[1];
            const remainingValue = mulPrice(remainingConfig.amount, remainingPrice, remainingInfo.scale);
            remainingCollateralizedValue += mulFactor(remainingValue, remainingInfo.borrowCollateralFactor);
          }
  
          const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - remainingCollateralizedValue) * factorScale
            / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
          expect(wantedCollateralValue).to.be.greaterThan(collateralValue);
  
          await expect(absorbTx)
            .to.emit(comet, 'AbsorbCollateral')
            .withArgs(absorber.address, alice.address, tokens[config.symbol].address, config.amount, collateralValue);
  
          debtRemainingValue -= mulFactor(collateralValue, assetInfo.liquidationFactor);
        });
      }
    });
  });
 
  context('multi-collateral: full seizure of second asset when remaining debt is above min debt value', function () {
    const compAmount = exp(0.5, 18); // 0.5 COMP, worth $50 before the price drop
    const wethAmount = exp(0.025, 18); // 0.025 WETH, worth $50 before the price drop
    const borrowAmount = exp(70, 6); // $70

    const collateralKeys = ['COMP', 'WETH'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, compAmount);
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // COMP falls from $100 to $80 and WETH falls from $2,000 to $1,200.
      // After COMP is fully seized, the remaining debt is still above baseBorrowMin,
      // but WETH is still not enough to cover it, so WETH is fully seized too.
      await priceFeeds['COMP'].connect(alice).setRoundData(0, exp(80, 8), 0, 0, 0);
      await priceFeeds['WETH'].connect(alice).setRoundData(0, exp(1200, 8), 0, 0, 0);
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

    it('full COMP seizure', async () => {
      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1];
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1];

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);

      const compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale);
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      const wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);

      collateralsState['COMP'].seizeAmount = compAmount;
      collateralsState['COMP'].seizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
      debtRemainingValue -= collateralsState['COMP'].seizedValue;
    });

    it('remaining debt after COMP seizure is above min debt value', async () => {
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
    });

    it('full WETH seizure', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1];
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);

      const totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);
      const wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWethCollateralValue).to.be.greaterThan(wethCollateralValue);

      collateralsState['WETH'].seizeAmount = wethAmount;
      collateralsState['WETH'].seizedValue = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['WETH'].seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('newBalance becomes zero as residual bad debt is written off', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after both assets are fully seized', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after both assets are fully seized', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('alice simple base balance is zero after absorb', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
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

    it('comet base reserves are reduced by the full borrow amount', async () => {
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

  context('1 collateral: full seizure when collateral value equals debt after liquidation factor', function () {
    const collateralAmount = exp(1, 18); // 1 COMP
    const borrowAmount = exp(45, 6); // $45

    const collateralKeys = ['COMP'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let collateralValue: bigint;
    let seizedValue: bigint;
    let debtValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const debtValue = mulPrice(borrowAmount, baseTokenPrice, baseScale);

      // We want exact equality after full seizure:
      //   seizedValue = collateralValue * liquidationFactor = debtValue
      // so:
      //   collateralValue = debtValue / liquidationFactor
      // For $45 debt and COMP LF 0.90: collateralValue = 45 / 0.90 = $50.
      const wantedCollateralValue = debtValue * factorScale / assetInfo.liquidationFactor.toBigInt();
      const exactCompPrice = wantedCollateralValue * assetInfo.scale.toBigInt() / collateralAmount;
      await priceFeeds['COMP'].connect(alice).setRoundData(0, exactCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
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

    it('full collateral amount with exact debt coverage', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1];
      debtValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      collateralValue = mulPrice(collateralAmount, compPrice, assetInfo.scale);
      seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
      collateralsState['COMP'].seizeAmount = collateralAmount;
    });

    it('debt is exactly seized value', async () => {
      expect(debtValue).to.be.equal(seizedValue);
    });

    it('debt is greater than baseBorrowMin', async () => {
      expect(debtValue).to.be.greaterThan(mulPrice(baseBorrowMin, baseTokenPrice, baseScale));
    });

    it('newBalance becomes zero because debt is exactly covered', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after full seizure', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after full seizure', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('comet total supplied collateral is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full borrow amount', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure when total collateral value equals debt after liquidation factors', function () {
    const compAmount = exp(1, 18); // 1 COMP
    const wethAmount = exp(0.01, 18); // 0.01 WETH
    const borrowAmount = exp(54, 6); // $54

    const collateralKeys = ['COMP', 'WETH'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let compCollateralValue: bigint;
    let wethCollateralValue: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['COMP'].address, compAmount);
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const debtValue = mulPrice(borrowAmount, baseTokenPrice, baseScale);

      // First asset: choose COMP value of $40 after the price change.
      //   COMP seizedValue = $40 * LF 0.90 = $36
      const compWantedCollateralValue = exp(40, 8);
      const exactCompPrice = compWantedCollateralValue * compInfo.scale.toBigInt() / compAmount;

      // Second asset must cover exactly the remaining debt:
      //   remaining debt = $54 - $36 = $18, which is above baseBorrowMin ($10)
      //   WETH collateralValue = $18 / LF 0.90 = $20
      const compWantedSeizedValue = mulFactor(compWantedCollateralValue, compInfo.liquidationFactor.toBigInt());
      const wethWantedCollateralValue = (debtValue - compWantedSeizedValue) * factorScale / wethInfo.liquidationFactor.toBigInt();
      const exactWethPrice = wethWantedCollateralValue * wethInfo.scale.toBigInt() / wethAmount;

      await priceFeeds['COMP'].connect(alice).setRoundData(0, exactCompPrice, 0, 0, 0);
      await priceFeeds['WETH'].connect(alice).setRoundData(0, exactWethPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
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

    it('full COMP seizure', async () => {
      const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1];
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1];

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale);
      wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      const wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);

      collateralsState['COMP'].seizeAmount = compAmount;
      collateralsState['COMP'].seizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
      debtRemainingValue -= collateralsState['COMP'].seizedValue;
    });

    it('remaining debt is greater than baseBorrowMin', async () => {
      // After COMP, remaining debt is exactly $18, above baseBorrowMin ($10).
      // Full WETH seizure gives:
      //   WETH seizedValue = $20 * LF 0.90 = $18
      // This avoids the minDebt branch and reaches the normal full-seizure path.
      expect(debtRemainingValue).to.be.greaterThan(mulPrice(baseBorrowMin, baseTokenPrice, baseScale));
    });

    it('full WETH seizure and exact remaining debt coverage', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      const totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);
      const wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWethCollateralValue).to.be.equal(wethCollateralValue);

      collateralsState['WETH'].seizeAmount = wethAmount;
      collateralsState['WETH'].seizedValue = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);
    });

    it('remaining weth seized value is equal to debt remaining value', async () => {
      expect(collateralsState['WETH'].seizedValue).to.be.equal(debtRemainingValue);
    });

    it('calculates newBalance as zero after both assets exactly cover the debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['WETH'].seizedValue;
      expect(debtRemainingValueAfterSeize).to.be.equal(0n);
    });

    it('newBalance becomes zero as residual bad debt is written off', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after both assets are fully seized', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after both assets are fully seized', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
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

    it('comet base reserves are reduced by the full borrow amount', async () => {
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

  context('multi-collateral: final collateral below min debt is fully seized as bad debt (assets index 3, 7, 19)', function () {
    const wbtcAmount = exp(0.001, 8); // $40
    const cbethAmount = exp(0.008, 18); // $21
    const arbAmount = exp(10, 18); // $5
    const borrowAmount = exp(65, 6); // $65

    const collateralKeys = ['WBTC', 'cbETH', 'ARB'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let wbtcCollateralValue: bigint;
    let cbethCollateralValue: bigint;
    let arbCollateralValue: bigint;

    before(async function() {
      await comet.connect(alice).supply(tokens['WBTC'].address, wbtcAmount); // index 3 in default24Assets
      await comet.connect(alice).supply(tokens['cbETH'].address, cbethAmount); // index 7 in default24Assets
      await comet.connect(alice).supply(tokens['ARB'].address, arbAmount); // index 19 in default24Assets
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      const wbtcInfo = await comet.getAssetInfoByAddress(tokens['WBTC'].address);
      const cbethInfo = await comet.getAssetInfoByAddress(tokens['cbETH'].address);
      const arbInfo = await comet.getAssetInfoByAddress(tokens['ARB'].address);

      // We choose prices from target USD values, rather than hardcoding prices:
      //   WBTC target value = $40  ->  $40 / 0.001 WBTC = $40,000
      //   cbETH target value = $21 ->  $21 / 0.008 cbETH = $2,625
      //   ARB target value = $5    ->  $5 / 10 ARB = $0.50
      const wbtcTargetValue = exp(40, 8);
      const cbethTargetValue = exp(21, 8);
      const arbTargetValue = exp(5, 8);
      const wbtcPrice = wbtcTargetValue * wbtcInfo.scale.toBigInt() / wbtcAmount;
      const cbethPrice = cbethTargetValue * cbethInfo.scale.toBigInt() / cbethAmount;
      const arbPrice = arbTargetValue * arbInfo.scale.toBigInt() / arbAmount;

      await priceFeeds['WBTC'].connect(alice).setRoundData(0, wbtcPrice, 0, 0, 0);
      await priceFeeds['cbETH'].connect(alice).setRoundData(0, cbethPrice, 0, 0, 0);
      await priceFeeds['ARB'].connect(alice).setRoundData(0, arbPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
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

    it('full WBTC seizure', async () => {
      const wbtcInfo = await comet.getAssetInfoByAddress(tokens['WBTC'].address);
      const cbethInfo = await comet.getAssetInfoByAddress(tokens['cbETH'].address);
      const arbInfo = await comet.getAssetInfoByAddress(tokens['ARB'].address);
      const wbtcPrice = (await priceFeeds['WBTC'].latestRoundData())[1];
      const cbethPrice = (await priceFeeds['cbETH'].latestRoundData())[1];
      const arbPrice = (await priceFeeds['ARB'].latestRoundData())[1];

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);

      wbtcCollateralValue = mulPrice(wbtcAmount, wbtcPrice, wbtcInfo.scale);
      cbethCollateralValue = mulPrice(cbethAmount, cbethPrice, cbethInfo.scale);
      arbCollateralValue = mulPrice(arbAmount, arbPrice, arbInfo.scale);
      const totalCollateralizedValue =
        mulFactor(wbtcCollateralValue, wbtcInfo.borrowCollateralFactor) +
        mulFactor(cbethCollateralValue, cbethInfo.borrowCollateralFactor) +
        mulFactor(arbCollateralValue, arbInfo.borrowCollateralFactor);

      const wantedWbtcCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wbtcInfo.liquidationFactor, targetHealthFactor) - wbtcInfo.borrowCollateralFactor.toBigInt());

      expect(wantedWbtcCollateralValue).to.be.greaterThan(wbtcCollateralValue);

      collateralsState['WBTC'].seizeAmount = wbtcAmount;
      collateralsState['WBTC'].seizedValue = mulFactor(wbtcCollateralValue, wbtcInfo.liquidationFactor);

      debtRemainingValue -= collateralsState['WBTC'].seizedValue;
    });

    it('debt after WBTC full seizure is still greater than minDebtValue', () => {
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
    });

    it('full cbETH seizure', async () => {
      const cbethInfo = await comet.getAssetInfoByAddress(tokens['cbETH'].address);
      const arbInfo = await comet.getAssetInfoByAddress(tokens['ARB'].address);
      const totalCollateralizedValue =
        mulFactor(cbethCollateralValue, cbethInfo.borrowCollateralFactor) +
        mulFactor(arbCollateralValue, arbInfo.borrowCollateralFactor);

      const wantedCbethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(cbethInfo.liquidationFactor, targetHealthFactor) - cbethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCbethCollateralValue).to.be.greaterThan(cbethCollateralValue);

      collateralsState['cbETH'].seizeAmount = cbethAmount;
      collateralsState['cbETH'].seizedValue = mulFactor(cbethCollateralValue, cbethInfo.liquidationFactor);

      debtRemainingValue -= collateralsState['cbETH'].seizedValue;
    });

    it('debt after cbETH full seizure is less than minDebtValue', () => {
      expect(debtRemainingValue).to.be.lessThan(minDebtValue);
    });

    it('ARB value is below current debt and cannot cover remaining debt', async () => {
      const arbInfo = await comet.getAssetInfoByAddress(tokens['ARB'].address);
      const arbSeizedValueIfFullySeized = mulFactor(arbCollateralValue, arbInfo.liquidationFactor);

      expect(arbCollateralValue).to.be.lessThan(debtRemainingValue);
      expect(arbSeizedValueIfFullySeized).to.be.lessThan(debtRemainingValue);
    });

    it('full ARB seizure as bad debt', async () => {
      const arbInfo = await comet.getAssetInfoByAddress(tokens['ARB'].address);
      const totalCollateralizedValue = mulFactor(arbCollateralValue, arbInfo.borrowCollateralFactor);

      const wantedArbCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(arbInfo.liquidationFactor, targetHealthFactor) - arbInfo.borrowCollateralFactor.toBigInt());
      expect(wantedArbCollateralValue).to.be.greaterThan(arbCollateralValue);

      collateralsState['ARB'].seizeAmount = arbAmount;
      collateralsState['ARB'].seizedValue = mulFactor(arbCollateralValue, arbInfo.liquidationFactor);
    });

    it('residual bad debt after all collateral is fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['ARB'].seizedValue;
      expect(debtRemainingValueAfterSeize).to.be.greaterThan(0n);
    });

    it('newBalance becomes zero as residual bad debt is written off', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice WBTC collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WBTC'].address)).to.be.equal(0);
    });

    it('alice cbETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['cbETH'].address)).to.be.equal(0);
    });

    it('alice ARB collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['ARB'].address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balances do not change during absorb', async () => {
      expect(await tokens['WBTC'].balanceOf(comet.address)).to.be.equal(collateralsState['WBTC'].tokenBalanceBefore);
      expect(await tokens['cbETH'].balanceOf(comet.address)).to.be.equal(collateralsState['cbETH'].tokenBalanceBefore);
      expect(await tokens['ARB'].balanceOf(comet.address)).to.be.equal(collateralsState['ARB'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are cleared', async () => {
      expect(reservedBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied WBTC is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['WBTC'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['WBTC'].totalsCollateralBefore.sub(collateralsState['WBTC'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied cbETH is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['cbETH'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['cbETH'].totalsCollateralBefore.sub(collateralsState['cbETH'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied ARB is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['ARB'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['ARB'].totalsCollateralBefore.sub(collateralsState['ARB'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the full borrow amount', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase for all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['WBTC'].address)).to.be.equal(collateralsState['WBTC'].collateralReservesBefore.add(collateralsState['WBTC'].seizeAmount));
      expect(await comet.getCollateralReserves(tokens['cbETH'].address)).to.be.equal(collateralsState['cbETH'].collateralReservesBefore.add(collateralsState['cbETH'].seizeAmount));
      expect(await comet.getCollateralReserves(tokens['ARB'].address)).to.be.equal(collateralsState['ARB'].collateralReservesBefore.add(collateralsState['ARB'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('1 collateral: debt below min debt and collateral cannot cover it', function () {
    const collateralAmount = exp(1, 18); // 1 AAVE
    const borrowAmount = exp(12, 6); // $12, initially above baseBorrowMin
    const repayAmount = exp(4, 6); // leaves $8 debt, below baseBorrowMin
    const droppedAavePrice = exp(5, 8); // collateral value becomes $5

    const collateralKeys = ['AAVE'];
    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let collateralValue: bigint;

    before(async function () {
      await comet.connect(alice).supply(tokens['AAVE'].address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // repay part of the borrow to have debt below baseBorrowMin
      await comet.connect(alice).supply(baseToken.address, repayAmount);

      await priceFeeds['AAVE'].connect(alice).setRoundData(0, droppedAavePrice, 0, 0, 0);
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
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

    it('alice borrow balance is below baseBorrowMin after repay', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount - repayAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.lessThan(baseBorrowMin);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('min debt branch wants to close debt but AAVE cannot cover it', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(tokens['AAVE'].address);
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);
      collateralValue = mulPrice(collateralAmount, droppedAavePrice, assetInfo.scale);

      // debtRemainingValue = 8e8, minDebtValue = 10e8, so absorb enters
      // _processDebtClosing. AAVE value left after LF is 5e8 * 0.85 = 4.25e8,
      // which is insufficient to close the 8e8 debt, so all AAVE is seized.
      collateralsState['AAVE'].seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
      collateralsState['AAVE'].seizeAmount = collateralAmount;

      expect(debtRemainingValue).to.be.lessThan(minDebtValue);
    });

    it('collateral value is less than debt remaining value: full seizure', () => {
      expect(collateralValue).to.be.lessThan(debtRemainingValue);
    });

    it('seized value is less than debt remaining value: full seizure', () => {
      expect(collateralsState['AAVE'].seizedValue).to.be.lessThan(debtRemainingValue);
    });

    it('calculates residual bad debt after all collateral is fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['AAVE'].seizedValue;
      expect(debtRemainingValueAfterSeize).to.be.greaterThan(0n);
    });

    it('newBalance becomes zero as residual bad debt is written off', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full remaining borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('alice collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['AAVE'].address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await tokens['AAVE'].balanceOf(comet.address)).to.be.equal(collateralsState['AAVE'].tokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet total supplied collateral is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(tokens['AAVE'].address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(collateralsState['AAVE'].totalsCollateralBefore.sub(collateralsState['AAVE'].seizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(totalBorrowBaseBefore.sub(basePaidOut));
      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the residual bad debt amount', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - basePaidOut);
    });

    it('comet collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(tokens['AAVE'].address)).to.be.equal(collateralsState['AAVE'].collateralReservesBefore.add(collateralsState['AAVE'].seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('24 collaterals: all collaterals are fully seized after moderate price drops', function () {
    const collateralSymbols = [
      'COMP', 'WETH', 'USDT', 'WBTC', 'DAI', 'wstETH', 'rsETH', 'cbETH',
      'rETH', 'weETH', 'ezETH', 'cbBTC', 'tBTC', 'LINK', 'UNI', 'AAVE',
      'LDO', 'CRV', 'MKR', 'ARB', 'OP', 'GMX', 'USDe', 'sUSDe',
    ];
    const largeCollateralValue = exp(9_000, 8);
    const stableCollateralValue = exp(100, 8);
    const dustCollateralValue = exp(1, 8);
    const priceDropFactor = 85n; // 15% price drop

    let collateralConfigs: {
      symbol: string;
      asset: FaucetToken;
      amount: bigint;
      initialPrice: bigint;
      droppedPrice: bigint;
    }[] = [];
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let borrowAmount: bigint;
    let maxBorrowValue: bigint;
    let debtRemainingValue: bigint;
    let totalSeizedValue: bigint;
    let collateralValues: { [symbol: string]: bigint } = {};
    let seizedValues: { [symbol: string]: bigint } = {};
    let collateralsState: Record<string, CollateralState> = {};

    before(async function() {
      for (const symbol of collateralSymbols) {
        const asset = tokens[symbol];
        const assetInfo = await comet.getAssetInfoByAddress(asset.address);
        const initialPrice = (await priceFeeds[symbol].latestRoundData())[1].toBigInt();
        let targetValue = dustCollateralValue;
        if (symbol === 'COMP') {
          targetValue = largeCollateralValue;
        } else if (symbol === 'USDT' || symbol === 'DAI') {
          targetValue = stableCollateralValue;
        }
        const amount = targetValue * assetInfo.scale.toBigInt() / initialPrice;

        collateralConfigs.push({
          symbol,
          asset,
          amount,
          initialPrice,
          droppedPrice: initialPrice * priceDropFactor / 100n,
        });
      }
    });

    it('uses all supported collateral assets', () => {
      expect(collateralConfigs.length).to.be.equal(24);
    });

    it('alice supplies every collateral', async () => {
      for (const config of collateralConfigs) {
        await expect(
          comet.connect(alice).supply(config.asset.address, config.amount)
        ).to.not.be.reverted;
      }
    });

    it('calculates a borrow amount close to the initial borrow capacity', async () => {
      maxBorrowValue = 0n;

      for (const config of collateralConfigs) {
        const assetInfo = await comet.getAssetInfoByAddress(config.asset.address);
        const collateralValue = mulPrice(config.amount, config.initialPrice, assetInfo.scale);
        maxBorrowValue += mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      }

      // Borrow just under the initial borrow limit so the position is valid before prices move.
      borrowAmount = maxBorrowValue * 99n / 100n * baseScale / baseTokenPrice;
    });

    it('alice borrows close to the initial borrow capacity', async () => {
      await expect(
        comet.connect(alice).withdraw(baseToken.address, borrowAmount)
      ).to.not.be.reverted;
    });

    it('alice borrow balance is equal to the borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('every collateral price drops', async () => {
      for (const config of collateralConfigs) {
        await priceFeeds[config.symbol].connect(alice).setRoundData(0, config.droppedPrice, 0, 0, 0);
      }
      await comet.accrueAccount(alice.address);
    });

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

    it('captures state before absorb', async () => {
      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const utilization = await comet.getUtilization();
      const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();
      const timeElapsed = 1n;
      const baseBorrowIndex = totalsBasic.baseBorrowIndex.toBigInt()
        + mulFactor(totalsBasic.baseBorrowIndex.toBigInt(), borrowRate * timeElapsed);

      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, baseBorrowIndex);
    });

    it('borrow balance is greater than or equal to the borrowed amount', async () => {
      expect(-oldBalance).to.be.greaterThanOrEqual(borrowAmount);
    });

    it('comet ERC20 base token balance is reduced by the borrow before absorb', async () => {
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('captures collateral state before absorb', async () => {
      collateralsState = await makeCollateralStates(comet, tokens, collateralSymbols);

      // Note: these checks are not strictly necessary, but they help to ensure that the collateral state is captured correctly.
      // This checks inside the for loop to avoid massive test output.
      for (const config of collateralConfigs) {
        expect(collateralsState[config.symbol].totalsCollateralBefore).to.be.equal(config.amount);
        expect(collateralsState[config.symbol].collateralReservesBefore).to.be.equal(0);
        expect(collateralsState[config.symbol].tokenBalanceBefore).to.be.equal(config.amount);
      }
    });

    it('post-drop collateral cannot cover the debt after liquidation factors', async () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      totalSeizedValue = 0n;

      for (const config of collateralConfigs) {
        const assetInfo = await comet.getAssetInfoByAddress(config.asset.address);
        collateralValues[config.symbol] = mulPrice(config.amount, config.droppedPrice, assetInfo.scale);
        seizedValues[config.symbol] = mulFactor(collateralValues[config.symbol], assetInfo.liquidationFactor);
        totalSeizedValue += seizedValues[config.symbol];
      }

      expect(totalSeizedValue).to.be.lessThan(debtRemainingValue);
    });

    it('target health math requires full seizure for each collateral', async () => {
      for (const [index, config] of collateralConfigs.entries()) {
        const assetInfo = await comet.getAssetInfoByAddress(config.asset.address);
        const remainingConfigs = collateralConfigs.slice(index);
        let remainingCollateralizedValue = 0n;

        for (const remainingConfig of remainingConfigs) {
          const remainingInfo = await comet.getAssetInfoByAddress(remainingConfig.asset.address);
          remainingCollateralizedValue += mulFactor(
            collateralValues[remainingConfig.symbol],
            remainingInfo.borrowCollateralFactor
          );
        }

        const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - remainingCollateralizedValue) * factorScale
            / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
        
        expect(wantedCollateralValue).to.be.greaterThan(collateralValues[config.symbol]);
        
        debtRemainingValue -= seizedValues[config.symbol];
      }
    });

    it('debt remaining value is greater than zero: bad debt', async () => {
      expect(debtRemainingValue).to.be.greaterThan(0n);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('newBalance becomes zero as residual bad debt is written off', async () => {
      newBalance = 0n;
    });

    it('alice borrow balance is zero after absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero after absorb', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('AbsorbDebt event is emitted for the full absorbed borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
    });

    it('all alice collateral balances are zero', async () => {
      for (const config of collateralConfigs) {
        expect(await comet.collateralBalanceOf(alice.address, config.asset.address)).to.be.equal(0);
      }
    });

    it('comet ERC20 collateral token balances do not change during absorb', async () => {
      for (const config of collateralConfigs) {
        expect(await config.asset.balanceOf(comet.address)).to.be.equal(collateralsState[config.symbol].tokenBalanceBefore);
      }
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('all collateral totals are zero', async () => {
      for (const config of collateralConfigs) {
        const totalSupplyAsset = (await comet.totalsCollateral(config.asset.address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(collateralsState[config.symbol].totalsCollateralBefore.sub(config.amount));
        expect(totalSupplyAsset).to.be.equal(0);
      }
    });

    it('comet total borrow base is zero', async () => {
      const totalBorrowBase = (await comet.totalsBasic()).totalBorrowBase;

      expect(totalBorrowBase).to.be.equal(0);
    });

    it('comet base reserves are reduced by the borrowed base tokens', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('all collateral reserves increase by the seized amounts', async () => {
      for (const config of collateralConfigs) {
        expect(await comet.getCollateralReserves(config.asset.address)).to.be.equal(
          collateralsState[config.symbol].collateralReservesBefore.add(config.amount)
        );
      }
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });
});