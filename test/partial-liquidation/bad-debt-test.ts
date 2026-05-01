import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, default24Assets } from '../helpers';
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

  // Snapshot
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

  context('1 collateral: full seizure, user has not enough collateral to cover debt (asset index 0)', function () {
    const collateralAmount = exp(1, 18); // 1 COMP, initially worth $100
    const borrowAmount = exp(80, 6); // $80

    let collateralAsset: FaucetToken;
    let totalsCollateralBefore: BigNumber;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let seizedValue: bigint;
    let seizeAmount: bigint;

    before(async function() {
      collateralAsset = tokens['COMP'];
      await comet.connect(alice).supply(collateralAsset.address, collateralAmount);
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

    it('alice assets in is equal to the collateral bitmap', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const expectedAssetsIn = 1 << assetInfo.offset;

      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved is equal to zero', async () => {
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

    it('alice principal is equal to -borrowed amount', async () => {
      const principal = (await comet.userBasic(alice.address)).principal;
      expect(principal).to.be.equal(-borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('full seizure of collateral amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
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
      seizeAmount = collateralAmount;
      seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after full seizure bad debt handling', async () => {
      // The full seizure repays about $45 of the $80 debt, leaving about $35 unpaid.
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
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
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
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
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('1 collateral: full seizure, user has not enough collateral to cover debt (asset index 16)', function () {
    const collateralAmount = exp(100, 18); // 100 LDO, initially worth $200
    const borrowAmount = exp(80, 6); // $80

    let collateralAsset: FaucetToken;
    let totalsCollateralBefore: BigNumber;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let seizedValue: bigint;
    let seizeAmount: bigint;

    before(async function() {
      collateralAsset = tokens['LDO']; // index 16 in default24Assets
      await comet.connect(alice).supply(collateralAsset.address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop LDO from $2 to $0.50. The collateral is now worth $50,
      // so it cannot cover the $80 debt even after full seizure.
      await priceFeeds['LDO'].connect(alice).setRoundData(0, exp(0.5, 8), 0, 0, 0);
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

    it('alice principal is equal to -borrowed amount', async () => {
      const principal = (await comet.userBasic(alice.address)).principal;
      expect(principal).to.be.equal(-borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('full seizure of the first collateral amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const price = (await priceFeeds['LDO'].latestRoundData())[1];

      // Debt is $80 and 100 LDO is now worth $50.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const collateralValue = mulPrice(collateralAmount, price, assetInfo.scale);

      // The target HF formula wants more than $50 of collateral, so the contract seizes all LDO.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValue).to.be.greaterThan(collateralValue);

      seizeAmount = collateralAmount;
      seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after full seizure bad debt handling', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
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
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
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
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('1 collateral: full seizure, user has not enough collateral to cover debt (last asset index)', function () {
    const collateralAmount = exp(100, 18); // 100 last-index tokens, initially worth $100
    const borrowAmount = exp(70, 6); // $70

    let collateralAsset: FaucetToken;
    let totalsCollateralBefore: BigNumber;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let seizedValue: bigint;
    let seizeAmount: bigint;

    before(async function() {
      collateralAsset = tokens['sUSDe']; // last index in default24Assets
      await comet.connect(alice).supply(collateralAsset.address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      // Drop the last asset from $1 to $0.50. The collateral is now worth $50,
      // so it cannot cover the $70 debt even after full seizure.
      await priceFeeds['sUSDe'].connect(alice).setRoundData(0, exp(0.5, 8), 0, 0, 0);
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

    it('alice principal is equal to -borrowed amount', async () => {
      const principal = (await comet.userBasic(alice.address)).principal;
      expect(principal).to.be.equal(-borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('full seizure of the last collateral amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const price = (await priceFeeds['sUSDe'].latestRoundData())[1];

      // Debt is $70 and 100 tokens at the last index are now worth $50.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const collateralValue = mulPrice(collateralAmount, price, assetInfo.scale);

      // The target HF formula wants more than $50 of collateral, so the contract seizes all of it.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValue).to.be.greaterThan(collateralValue);

      seizeAmount = collateralAmount;
      seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after full seizure bad debt handling', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;
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
      expect(principal).to.be.equal(newBalance);
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
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
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
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
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
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of first asset then full seizure of second (assets index 0 and 1)', function () {
    const compAmount = exp(0.5, 18); // 0.5 COMP, worth $50 before the price drop
    const wethAmount = exp(0.0275, 18); // 0.0275 WETH at $2,000 = $55
    const borrowAmount = exp(80, 6); // $80

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

    before(async function() {
      compAsset = tokens['COMP'];
      wethAsset = tokens['WETH'];

      await comet.connect(alice).supply(compAsset.address, compAmount);
      await comet.connect(alice).supply(wethAsset.address, wethAmount);
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
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('full seizure of the first collateral asset', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
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

      compSeizeAmount = compAmount;
      compSeizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
    });

    it('full seizure of the second collateral asset', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1];
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);

      // After COMP full seizure, debt is $80 - $36 = $44.
      debtRemainingValue -= compSeizedValue;

      // WETH is worth $44, but the target HF formula wants more than all of it,
      // so the second asset is also fully seized.
      const totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);
      const wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWethCollateralValue).to.be.greaterThan(wethCollateralValue);

      wethSeizeAmount = wethAmount;
      wethSeizedValue = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      // Both assets together repay $36 + $39.60 = $75.60, leaving $4.40 bad debt.
      const debtRemainingValueAfterSeize = debtRemainingValue - wethSeizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect(assetsInBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
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

    it('comet base reserves are reduced by the full borrow amount', async () => {
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

  context('multi-collateral: full seizure of first asset then full seizure of second (assets index 15 and 16)', function () {
    const aaveAmount = exp(0.4, 18); // 0.4 AAVE, worth $40 before the price drop
    const ldoAmount = exp(20, 18); // 20 LDO, worth $40 before the price drop
    const borrowAmount = exp(45, 6); // $45

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
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let aaveSeizeAmount: bigint;
    let aaveSeizedValue: bigint;
    let ldoSeizeAmount: bigint;
    let ldoSeizedValue: bigint;

    before(async function() {
      aaveAsset = tokens['AAVE']; // index 15 in default24Assets
      ldoAsset = tokens['LDO']; // index 16 in default24Assets

      await comet.connect(alice).supply(aaveAsset.address, aaveAmount);
      await comet.connect(alice).supply(ldoAsset.address, ldoAmount);
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
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('AAVE is at asset index 15', async () => {
      expect((await comet.getAssetInfoByAddress(aaveAsset.address)).offset).to.be.equal(15);
    });

    it('LDO is at asset index 16', async () => {
      expect((await comet.getAssetInfoByAddress(ldoAsset.address)).offset).to.be.equal(16);
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

    it('alice assetsIn only includes AAVE', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);
      const expectedAssetsIn = 1 << aaveInfo.offset;

      expect(assetsInBefore).to.be.equal(expectedAssetsIn);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved has the bit for LDO', async () => {
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const expectedReserved = 1 << (ldoInfo.offset - 16);

      expect(reservedBefore).to.be.equal(expectedReserved);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    it('comet total supplied AAVE is equal to alice supplied amount', async () => {
      aaveTotalsCollateralBefore = (await comet.totalsCollateral(aaveAsset.address)).totalSupplyAsset;
      expect(aaveTotalsCollateralBefore).to.be.equal(aaveAmount);
    });

    it('comet total supplied LDO is equal to alice supplied amount', async () => {
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

    it('full AAVE seizure', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
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

      aaveSeizeAmount = aaveAmount;
      aaveSeizedValue = mulFactor(aaveCollateralValue, aaveInfo.liquidationFactor);
    });

    it('full LDO seizure', async () => {
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1];
      const ldoCollateralValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale);

      debtRemainingValue -= aaveSeizedValue;
      const totalCollateralizedValue = mulFactor(ldoCollateralValue, ldoInfo.borrowCollateralFactor);
      const wantedLdoCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(ldoInfo.liquidationFactor, targetHealthFactor) - ldoInfo.borrowCollateralFactor.toBigInt());
      expect(wantedLdoCollateralValue).to.be.greaterThan(ldoCollateralValue);

      ldoSeizeAmount = ldoAmount;
      ldoSeizedValue = mulFactor(ldoCollateralValue, ldoInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - ldoSeizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, aaveAsset.address)).to.be.equal(0);
    });

    it('alice LDO collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, ldoAsset.address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are cleared', async () => {
      expect(reservedBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied AAVE is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(aaveAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(aaveTotalsCollateralBefore.sub(aaveSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied LDO is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(ldoAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(ldoTotalsCollateralBefore.sub(ldoSeizeAmount));
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
      expect(await comet.getCollateralReserves(aaveAsset.address)).to.be.equal(aaveCollateralReservesBefore.add(aaveSeizeAmount));
    });

    it('comet LDO collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(ldoAsset.address)).to.be.equal(ldoCollateralReservesBefore.add(ldoSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of first asset then full seizure of second (last two asset indexes: 22 and 23)', function () {
    const usdeAmount = exp(50, 18); // 50 USDe, worth $50 before the price drop
    const susdeAmount = exp(50, 18); // 50 sUSDe, worth $50 before the price drop
    const borrowAmount = exp(70, 6); // $70

    let usdeAsset: FaucetToken;
    let susdeAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let usdeTotalsCollateralBefore: BigNumber;
    let susdeTotalsCollateralBefore: BigNumber;
    let usdeCollateralReservesBefore: BigNumber;
    let susdeCollateralReservesBefore: BigNumber;
    let cometUsdeTokenBalanceBefore: BigNumber;
    let cometSusdeTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let usdeSeizeAmount: bigint;
    let usdeSeizedValue: bigint;
    let susdeSeizeAmount: bigint;
    let susdeSeizedValue: bigint;

    before(async function() {
      usdeAsset = tokens['USDe']; // index 22 in default24Assets
      susdeAsset = tokens['sUSDe']; // index 23 in default24Assets

      await comet.connect(alice).supply(usdeAsset.address, usdeAmount);
      await comet.connect(alice).supply(susdeAsset.address, susdeAmount);
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
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('USDe is at asset index 22', async () => {
      expect((await comet.getAssetInfoByAddress(usdeAsset.address)).offset).to.be.equal(22);
    });

    it('sUSDe is at asset index 23', async () => {
      expect((await comet.getAssetInfoByAddress(susdeAsset.address)).offset).to.be.equal(23);
    });

    it('alice USDe collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, usdeAsset.address)).to.be.equal(usdeAmount);
    });

    it('alice sUSDe collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, susdeAsset.address)).to.be.equal(susdeAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn is zero because both assets are above index 15', async () => {
      expect(assetsInBefore).to.be.equal(0);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved has the bits for USDe and sUSDe', async () => {
      const usdeInfo = await comet.getAssetInfoByAddress(usdeAsset.address);
      const susdeInfo = await comet.getAssetInfoByAddress(susdeAsset.address);
      const expectedReserved = (1 << (usdeInfo.offset - 16)) | (1 << (susdeInfo.offset - 16));

      expect(reservedBefore).to.be.equal(expectedReserved);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    it('comet total supplied USDe is equal to alice supplied amount', async () => {
      usdeTotalsCollateralBefore = (await comet.totalsCollateral(usdeAsset.address)).totalSupplyAsset;
      expect(usdeTotalsCollateralBefore).to.be.equal(usdeAmount);
    });

    it('comet total supplied sUSDe is equal to alice supplied amount', async () => {
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

    it('alice principal is equal to -borrowed amount', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('full USDe seizure', async () => {
      const usdeInfo = await comet.getAssetInfoByAddress(usdeAsset.address);
      const susdeInfo = await comet.getAssetInfoByAddress(susdeAsset.address);
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

      usdeSeizeAmount = usdeAmount;
      usdeSeizedValue = mulFactor(usdeCollateralValue, usdeInfo.liquidationFactor);
    });

    it('full sUSDe seizure', async () => {
      const susdeInfo = await comet.getAssetInfoByAddress(susdeAsset.address);
      const susdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1];
      const susdeCollateralValue = mulPrice(susdeAmount, susdePrice, susdeInfo.scale);

      debtRemainingValue -= usdeSeizedValue;
      const totalCollateralizedValue = mulFactor(susdeCollateralValue, susdeInfo.borrowCollateralFactor);
      const wantedSusdeCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(susdeInfo.liquidationFactor, targetHealthFactor) - susdeInfo.borrowCollateralFactor.toBigInt());
      expect(wantedSusdeCollateralValue).to.be.greaterThan(susdeCollateralValue);

      susdeSeizeAmount = susdeAmount;
      susdeSeizedValue = mulFactor(susdeCollateralValue, susdeInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - susdeSeizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, usdeAsset.address)).to.be.equal(0);
    });

    it('alice sUSDe collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, susdeAsset.address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are cleared', async () => {
      expect(reservedBefore).to.not.equal(0);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(0);
    });

    it('comet total supplied USDe is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(usdeAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(usdeTotalsCollateralBefore.sub(usdeSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied sUSDe is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(susdeAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(susdeTotalsCollateralBefore.sub(susdeSeizeAmount));
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
      expect(await comet.getCollateralReserves(usdeAsset.address)).to.be.equal(usdeCollateralReservesBefore.add(usdeSeizeAmount));
    });

    it('comet sUSDe collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(susdeAsset.address)).to.be.equal(susdeCollateralReservesBefore.add(susdeSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of first asset then full seizure of second (assets index 14 and 18)', function () {
    const uniAmount = exp(5, 18); // 5 UNI, worth $40 before the price drop
    const mkrAmount = exp(0.016, 18); // 0.016 MKR, worth $40 before the price drop
    const borrowAmount = exp(45, 6); // $45

    let uniAsset: FaucetToken;
    let mkrAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let uniTotalsCollateralBefore: BigNumber;
    let mkrTotalsCollateralBefore: BigNumber;
    let uniCollateralReservesBefore: BigNumber;
    let mkrCollateralReservesBefore: BigNumber;
    let cometUniTokenBalanceBefore: BigNumber;
    let cometMkrTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let uniSeizeAmount: bigint;
    let uniSeizedValue: bigint;
    let mkrSeizeAmount: bigint;
    let mkrSeizedValue: bigint;

    before(async function() {
      uniAsset = tokens['UNI']; // index 14 in default24Assets
      mkrAsset = tokens['MKR']; // index 18 in default24Assets

      await comet.connect(alice).supply(uniAsset.address, uniAmount);
      await comet.connect(alice).supply(mkrAsset.address, mkrAmount);
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
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('UNI is at asset index 14', async () => {
      expect((await comet.getAssetInfoByAddress(uniAsset.address)).offset).to.be.equal(14);
    });

    it('MKR is at asset index 18', async () => {
      expect((await comet.getAssetInfoByAddress(mkrAsset.address)).offset).to.be.equal(18);
    });

    it('alice UNI collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, uniAsset.address)).to.be.equal(uniAmount);
    });

    it('alice MKR collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, mkrAsset.address)).to.be.equal(mkrAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn only includes UNI', async () => {
      const uniInfo = await comet.getAssetInfoByAddress(uniAsset.address);
      const expectedAssetsIn = 1 << uniInfo.offset;

      expect(assetsInBefore).to.be.equal(expectedAssetsIn);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved has the bit for MKR', async () => {
      const mkrInfo = await comet.getAssetInfoByAddress(mkrAsset.address);
      const expectedReserved = 1 << (mkrInfo.offset - 16);

      expect(reservedBefore).to.be.equal(expectedReserved);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    it('comet total supplied UNI is equal to alice supplied amount', async () => {
      uniTotalsCollateralBefore = (await comet.totalsCollateral(uniAsset.address)).totalSupplyAsset;
      expect(uniTotalsCollateralBefore).to.be.equal(uniAmount);
    });

    it('comet total supplied MKR is equal to alice supplied amount', async () => {
      mkrTotalsCollateralBefore = (await comet.totalsCollateral(mkrAsset.address)).totalSupplyAsset;
      expect(mkrTotalsCollateralBefore).to.be.equal(mkrAmount);
    });

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    it('collateral reserves are equal to zero', async () => {
      uniCollateralReservesBefore = await comet.getCollateralReserves(uniAsset.address);
      mkrCollateralReservesBefore = await comet.getCollateralReserves(mkrAsset.address);

      expect(uniCollateralReservesBefore).to.be.equal(0);
      expect(mkrCollateralReservesBefore).to.be.equal(0);
    });

    it('comet ERC20 UNI token balance is equal to supplied UNI before absorb', async () => {
      cometUniTokenBalanceBefore = await uniAsset.balanceOf(comet.address);
      expect(cometUniTokenBalanceBefore).to.be.equal(uniAmount);
    });

    it('comet ERC20 MKR token balance is equal to supplied MKR before absorb', async () => {
      cometMkrTokenBalanceBefore = await mkrAsset.balanceOf(comet.address);
      expect(cometMkrTokenBalanceBefore).to.be.equal(mkrAmount);
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

    it('full UNI seizure', async () => {
      const uniInfo = await comet.getAssetInfoByAddress(uniAsset.address);
      const mkrInfo = await comet.getAssetInfoByAddress(mkrAsset.address);
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

      uniSeizeAmount = uniAmount;
      uniSeizedValue = mulFactor(uniCollateralValue, uniInfo.liquidationFactor);
    });

    it('full MKR seizure', async () => {
      const mkrInfo = await comet.getAssetInfoByAddress(mkrAsset.address);
      const mkrPrice = (await priceFeeds['MKR'].latestRoundData())[1];
      const mkrCollateralValue = mulPrice(mkrAmount, mkrPrice, mkrInfo.scale);

      debtRemainingValue -= uniSeizedValue;
      const totalCollateralizedValue = mulFactor(mkrCollateralValue, mkrInfo.borrowCollateralFactor);
      const wantedMkrCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(mkrInfo.liquidationFactor, targetHealthFactor) - mkrInfo.borrowCollateralFactor.toBigInt());
      expect(wantedMkrCollateralValue).to.be.greaterThan(mkrCollateralValue);

      mkrSeizeAmount = mkrAmount;
      mkrSeizedValue = mulFactor(mkrCollateralValue, mkrInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - mkrSeizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, uniAsset.address)).to.be.equal(0);
    });

    it('alice MKR collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, mkrAsset.address)).to.be.equal(0);
    });

    it('comet ERC20 UNI token balance does not change during absorb', async () => {
      expect(await uniAsset.balanceOf(comet.address)).to.be.equal(cometUniTokenBalanceBefore);
    });

    it('comet ERC20 MKR token balance does not change during absorb', async () => {
      expect(await mkrAsset.balanceOf(comet.address)).to.be.equal(cometMkrTokenBalanceBefore);
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

    it('comet total supplied UNI is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(uniAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(uniTotalsCollateralBefore.sub(uniSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied MKR is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(mkrAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(mkrTotalsCollateralBefore.sub(mkrSeizeAmount));
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
      expect(await comet.getCollateralReserves(uniAsset.address)).to.be.equal(uniCollateralReservesBefore.add(uniSeizeAmount));
    });

    it('comet MKR collateral reserves increase by all seized collateral', async () => {
      expect(await comet.getCollateralReserves(mkrAsset.address)).to.be.equal(mkrCollateralReservesBefore.add(mkrSeizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure of 5 different collaterals with random asset indexes', function () {
    const collateralConfigs = [
      { symbol: 'WBTC', index: 3, amount: exp(0.0004, 8), droppedPrice: exp(32500, 8) },
      { symbol: 'cbETH', index: 7, amount: exp(0.01, 18), droppedPrice: exp(1650, 8) },
      { symbol: 'AAVE', index: 15, amount: exp(0.3, 18), droppedPrice: exp(50, 8) },
      { symbol: 'ARB', index: 19, amount: exp(30, 18), droppedPrice: exp(0.5, 8) },
      { symbol: 'tBTC', index: 12, amount: exp(0.0004, 18), droppedPrice: exp(32500, 8) },
    ];
    const borrowAmount = exp(65, 6); // $65

    let collateralAssets: { [symbol: string]: FaucetToken } = {};
    let absorbTx: ContractTransaction;
    let totalsCollateralBefore: { [symbol: string]: BigNumber } = {};
    let collateralReservesBefore: { [symbol: string]: BigNumber } = {};
    let cometCollateralTokenBalanceBefore: { [symbol: string]: BigNumber } = {};
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
      for (const config of collateralConfigs) {
        collateralAssets[config.symbol] = tokens[config.symbol];
        await comet.connect(alice).supply(collateralAssets[config.symbol].address, config.amount);
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
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    for (const config of collateralConfigs) {
      it(`${config.symbol} is at asset index ${config.index}`, async () => {
        expect((await comet.getAssetInfoByAddress(collateralAssets[config.symbol].address)).offset).to.be.equal(config.index);
      });
    }

    for (const config of collateralConfigs) {
      it(`alice ${config.symbol} collateral balance is equal to supplied amount`, async () => {
        expect(await comet.collateralBalanceOf(alice.address, collateralAssets[config.symbol].address)).to.be.equal(config.amount);
      });
    }

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn includes assets with indexes below 16', async () => {
      const expectedAssetsIn = collateralConfigs.reduce((bitmap, config) => {
        return config.index < 16 ? bitmap | (1 << config.index) : bitmap;
      }, 0);

      expect(assetsInBefore).to.be.equal(expectedAssetsIn);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved has the bits for assets with indexes 16 and above', async () => {
      const expectedReserved = collateralConfigs.reduce((bitmap, config) => {
        return config.index >= 16 ? bitmap | (1 << (config.index - 16)) : bitmap;
      }, 0);

      expect(reservedBefore).to.be.equal(expectedReserved);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    for (const config of collateralConfigs) {
      it(`comet total supplied ${config.symbol} is equal to alice supplied amount`, async () => {
        totalsCollateralBefore[config.symbol] = (await comet.totalsCollateral(collateralAssets[config.symbol].address)).totalSupplyAsset;
        expect(totalsCollateralBefore[config.symbol]).to.be.equal(config.amount);
      });
    }

    it('comet total borrow base is equal to alice borrowed amount', async () => {
      totalBorrowBaseBefore = (await comet.totalsBasic()).totalBorrowBase;
      expect(totalBorrowBaseBefore).to.be.equal(borrowAmount);
    });

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
    });

    for (const config of collateralConfigs) {
      it(`${config.symbol} collateral reserves are equal to zero`, async () => {
        collateralReservesBefore[config.symbol] = await comet.getCollateralReserves(collateralAssets[config.symbol].address);
        expect(collateralReservesBefore[config.symbol]).to.be.equal(0);
      });
    }

    for (const config of collateralConfigs) {
      it(`comet ERC20 ${config.symbol} token balance is equal to supplied amount before absorb`, async () => {
        cometCollateralTokenBalanceBefore[config.symbol] = await collateralAssets[config.symbol].balanceOf(comet.address);
        expect(cometCollateralTokenBalanceBefore[config.symbol]).to.be.equal(config.amount);
      });
    }

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

    it('full seizure of all collaterals', async () => {
      for (const [index, config] of collateralConfigs.entries()) {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAssets[config.symbol].address);
        const price = (await priceFeeds[config.symbol].latestRoundData())[1];
        let remainingCollateralizedValue = 0n;

        const collateralValue = mulPrice(config.amount, price, assetInfo.scale);

        const remainingConfigs = collateralConfigs.slice(index);
        for (const remainingConfig of remainingConfigs) {
          const remainingInfo = await comet.getAssetInfoByAddress(collateralAssets[remainingConfig.symbol].address);
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
        expect(await comet.collateralBalanceOf(alice.address, collateralAssets[config.symbol].address)).to.be.equal(0);
      });
    }

    for (const config of collateralConfigs) {
      it(`comet ERC20 ${config.symbol} token balance does not change during absorb`, async () => {
        expect(await collateralAssets[config.symbol].balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore[config.symbol]);
      });
    }

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

    for (const config of collateralConfigs) {
      it(`comet total supplied ${config.symbol} is zero`, async () => {
        const totalSupplyAsset = (await comet.totalsCollateral(collateralAssets[config.symbol].address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore[config.symbol].sub(config.amount));
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
        expect(await comet.getCollateralReserves(collateralAssets[config.symbol].address)).to.be.equal(
          collateralReservesBefore[config.symbol].add(config.amount)
        );
      });
    }

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  // This context intentionally mirrors the setup and liquidation flow from the
  // previous context. Storage and balance changes are covered there; this
  // context focuses only on AbsorbCollateral event validation.
  context('multi-collateral: emit AbsorbCollateral events properly', function () {
    const collateralConfigs = [
      { symbol: 'WBTC', index: 3, amount: exp(0.0004, 8), droppedPrice: exp(32500, 8) },
      { symbol: 'cbETH', index: 7, amount: exp(0.01, 18), droppedPrice: exp(1650, 8) },
      { symbol: 'AAVE', index: 15, amount: exp(0.3, 18), droppedPrice: exp(50, 8) },
      { symbol: 'ARB', index: 19, amount: exp(30, 18), droppedPrice: exp(0.5, 8) },
      { symbol: 'tBTC', index: 12, amount: exp(0.0004, 18), droppedPrice: exp(32500, 8) },
    ];
    const borrowAmount = exp(65, 6); // $65

    let collateralAssets: { [symbol: string]: FaucetToken } = {};
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      for (const config of collateralConfigs) {
        collateralAssets[config.symbol] = tokens[config.symbol];
        await comet.connect(alice).supply(collateralAssets[config.symbol].address, config.amount);
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
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    for (const [index, config] of collateralConfigs.entries()) {
      it(`emits AbsorbCollateral for full ${config.symbol} seizure`, async () => {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAssets[config.symbol].address);
        const price = (await priceFeeds[config.symbol].latestRoundData())[1].toBigInt();
        let remainingCollateralizedValue = 0n;

        const collateralValue = mulPrice(config.amount, price, assetInfo.scale.toBigInt());

        const remainingConfigs = collateralConfigs.slice(index);
        for (const remainingConfig of remainingConfigs) {
          const remainingInfo = await comet.getAssetInfoByAddress(collateralAssets[remainingConfig.symbol].address);
          const remainingPrice = (await priceFeeds[remainingConfig.symbol].latestRoundData())[1];
          const remainingValue = mulPrice(remainingConfig.amount, remainingPrice, remainingInfo.scale);
          remainingCollateralizedValue += mulFactor(remainingValue, remainingInfo.borrowCollateralFactor);
        }

        const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - remainingCollateralizedValue) * factorScale
          / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
        expect(wantedCollateralValue).to.be.greaterThan(collateralValue);

        await expect(absorbTx)
          .to.emit(comet, 'AbsorbCollateral')
          .withArgs(absorber.address, alice.address, collateralAssets[config.symbol].address, config.amount, collateralValue);

        debtRemainingValue -= mulFactor(collateralValue, assetInfo.liquidationFactor);
      });
    }
  });

  context('multi-collateral: full seizure of second asset when remaining debt is above min debt value', function () {
    const compAmount = exp(0.5, 18); // 0.5 COMP, worth $50 before the price drop
    const wethAmount = exp(0.025, 18); // 0.025 WETH, worth $50 before the price drop
    const borrowAmount = exp(70, 6); // $70

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
    let wethSeizeAmount: bigint;
    let wethSeizedValue: bigint;

    before(async function() {
      compAsset = tokens['COMP'];
      wethAsset = tokens['WETH'];

      await comet.connect(alice).supply(compAsset.address, compAmount);
      await comet.connect(alice).supply(wethAsset.address, wethAmount);
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

      expect(assetsInBefore).to.be.equal(expectedAssetsIn);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved is equal to zero', async () => {
      expect(reservedBefore).to.be.equal(0);
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
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(-borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('full COMP seizure', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
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

      compSeizeAmount = compAmount;
      compSeizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
      debtRemainingValue -= compSeizedValue;
    });

    it('remaining debt after COMP seizure is above min debt value', async () => {
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
    });

    it('full WETH seizure', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1];
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);

      const totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);
      const wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWethCollateralValue).to.be.greaterThan(wethCollateralValue);

      wethSeizeAmount = wethAmount;
      wethSeizedValue = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - wethSeizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits do not change', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
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

    it('comet base reserves are reduced by the full borrow amount', async () => {
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

  context('1 collateral: full seizure when collateral value equals debt after liquidation factor', function () {
    const collateralAmount = exp(1, 18); // 1 COMP
    const borrowAmount = exp(45, 6); // $45

    let collateralAsset: FaucetToken;
    let totalsCollateralBefore: BigNumber;
    let absorbTx: ContractTransaction;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let collateralValue: bigint;
    let seizedValue: bigint;
    let seizeAmount: bigint;
    let debtValue: bigint;

    before(async function() {
      collateralAsset = tokens['COMP'];
      await comet.connect(alice).supply(collateralAsset.address, collateralAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
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
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('alice collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(collateralAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
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

    it('comet ERC20 collateral token balance is equal to supplied collateral before absorb', async () => {
      cometCollateralTokenBalanceBefore = await collateralAsset.balanceOf(comet.address);
      expect(cometCollateralTokenBalanceBefore).to.be.equal(collateralAmount);
    });

    it('comet ERC20 base token balance is reduced by the borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('full collateral amount with exact debt coverage', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1];
      debtValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      collateralValue = mulPrice(collateralAmount, compPrice, assetInfo.scale);
      seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
      seizeAmount = collateralAmount;
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
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('comet total supplied collateral is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
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
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });

  context('multi-collateral: full seizure when total collateral value equals debt after liquidation factors', function () {
    const compAmount = exp(1, 18); // 1 COMP
    const wethAmount = exp(0.01, 18); // 0.01 WETH
    const borrowAmount = exp(54, 6); // $54

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
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let compCollateralValue: bigint;
    let wethCollateralValue: bigint;
    let compSeizeAmount: bigint;
    let compSeizedValue: bigint;
    let wethSeizeAmount: bigint;
    let wethSeizedValue: bigint;
    let debtRemainingValue: bigint;

    before(async function() {
      compAsset = tokens['COMP'];
      wethAsset = tokens['WETH'];

      await comet.connect(alice).supply(compAsset.address, compAmount);
      await comet.connect(alice).supply(wethAsset.address, wethAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
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
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
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

      expect(assetsInBefore).to.be.equal(expectedAssetsIn);
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

    it('comet reserves are equal to the initial base funding', async () => {
      expect(await comet.getReserves()).to.be.equal(initialBaseFunding);
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
      await expect(absorbTx).to.not.be.reverted;
    });

    it('full COMP seizure', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
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

      compSeizeAmount = compAmount;
      compSeizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
      debtRemainingValue -= compSeizedValue;
    });

    it('remaining debt is greater than baseBorrowMin', async () => {
      // After COMP, remaining debt is exactly $18, above baseBorrowMin ($10).
      // Full WETH seizure gives:
      //   WETH seizedValue = $20 * LF 0.90 = $18
      // This avoids the minDebt branch and reaches the normal full-seizure path.
      expect(debtRemainingValue).to.be.greaterThan(mulPrice(baseBorrowMin, baseTokenPrice, baseScale));
    });

    it('full WETH seizure and exact remaining debt coverage', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);
      const wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWethCollateralValue).to.be.equal(wethCollateralValue);

      wethSeizeAmount = wethAmount;
      wethSeizedValue = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);
    });

    it('remaining weth seized value is equal to debt remaining value', async () => {
      expect(wethSeizedValue).to.be.equal(debtRemainingValue);
    });

    it('calculates newBalance as zero after both assets exactly cover the debt', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - wethSeizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, compAsset.address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wethAsset.address)).to.be.equal(0);
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

    it('alice assetsIn is cleared', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
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

    it('comet base reserves are reduced by the full borrow amount', async () => {
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

  context('multi-collateral: final collateral below min debt is fully seized as bad debt (assets index 3, 7, 19)', function () {
    const wbtcAmount = exp(0.001, 8); // $40
    const cbethAmount = exp(0.008, 18); // $21
    const arbAmount = exp(10, 18); // $5
    const borrowAmount = exp(65, 6); // $65

    let wbtcAsset: FaucetToken;
    let cbethAsset: FaucetToken;
    let arbAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let wbtcTotalsCollateralBefore: BigNumber;
    let cbethTotalsCollateralBefore: BigNumber;
    let arbTotalsCollateralBefore: BigNumber;
    let wbtcCollateralReservesBefore: BigNumber;
    let cbethCollateralReservesBefore: BigNumber;
    let arbCollateralReservesBefore: BigNumber;
    let cometWbtcTokenBalanceBefore: BigNumber;
    let cometCbethTokenBalanceBefore: BigNumber;
    let cometArbTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let assetsInBefore: number;
    let reservedBefore: number;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let wbtcCollateralValue: bigint;
    let cbethCollateralValue: bigint;
    let arbCollateralValue: bigint;
    let wbtcSeizeAmount: bigint;
    let wbtcSeizedValue: bigint;
    let cbethSeizeAmount: bigint;
    let cbethSeizedValue: bigint;
    let arbSeizeAmount: bigint;
    let arbSeizedValue: bigint;

    before(async function() {
      wbtcAsset = tokens['WBTC']; // index 3 in default24Assets
      cbethAsset = tokens['cbETH']; // index 7 in default24Assets
      arbAsset = tokens['ARB']; // index 19 in default24Assets

      await comet.connect(alice).supply(wbtcAsset.address, wbtcAmount);
      await comet.connect(alice).supply(cbethAsset.address, cbethAmount);
      await comet.connect(alice).supply(arbAsset.address, arbAmount);
      await comet.connect(alice).withdraw(baseToken.address, borrowAmount);

      const wbtcInfo = await comet.getAssetInfoByAddress(wbtcAsset.address);
      const cbethInfo = await comet.getAssetInfoByAddress(cbethAsset.address);
      const arbInfo = await comet.getAssetInfoByAddress(arbAsset.address);

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
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      // We paste the sanity check here to prevent going forward if the user is not liquidatable.
      // Because if the user is not liquidatable, the whole flow will be reverted.
      expect(await comet.isLiquidatable(alice.address)).to.equal(true, 'User is not liquidatable');
    });

    after(async () => await snapshot.restore());

    it('collaterals are at the expected asset indexes', async () => {
      expect((await comet.getAssetInfoByAddress(wbtcAsset.address)).offset).to.be.equal(3);
      expect((await comet.getAssetInfoByAddress(cbethAsset.address)).offset).to.be.equal(7);
      expect((await comet.getAssetInfoByAddress(arbAsset.address)).offset).to.be.equal(19);
    });

    it('alice collateral balances are equal to supplied amounts', async () => {
      expect(await comet.collateralBalanceOf(alice.address, wbtcAsset.address)).to.be.equal(wbtcAmount);
      expect(await comet.collateralBalanceOf(alice.address, cbethAsset.address)).to.be.equal(cbethAmount);
      expect(await comet.collateralBalanceOf(alice.address, arbAsset.address)).to.be.equal(arbAmount);
    });

    it('alice borrow balance is equal to borrowed amount', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount);
    });

    it('alice assetsIn includes WBTC and cbETH', async () => {
      const wbtcInfo = await comet.getAssetInfoByAddress(wbtcAsset.address);
      const cbethInfo = await comet.getAssetInfoByAddress(cbethAsset.address);
      const expectedAssetsIn = (1 << wbtcInfo.offset) | (1 << cbethInfo.offset);

      expect(assetsInBefore).to.be.equal(expectedAssetsIn);
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(expectedAssetsIn);
    });

    it('alice reserved has the bit for ARB', async () => {
      const arbInfo = await comet.getAssetInfoByAddress(arbAsset.address);
      const expectedReserved = 1 << (arbInfo.offset - 16);

      expect(reservedBefore).to.be.equal(expectedReserved);
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(expectedReserved);
    });

    it('comet total supplied collateral amounts are equal to alice supplied amounts', async () => {
      wbtcTotalsCollateralBefore = (await comet.totalsCollateral(wbtcAsset.address)).totalSupplyAsset;
      cbethTotalsCollateralBefore = (await comet.totalsCollateral(cbethAsset.address)).totalSupplyAsset;
      arbTotalsCollateralBefore = (await comet.totalsCollateral(arbAsset.address)).totalSupplyAsset;

      expect(wbtcTotalsCollateralBefore).to.be.equal(wbtcAmount);
      expect(cbethTotalsCollateralBefore).to.be.equal(cbethAmount);
      expect(arbTotalsCollateralBefore).to.be.equal(arbAmount);
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
      cbethCollateralReservesBefore = await comet.getCollateralReserves(cbethAsset.address);
      arbCollateralReservesBefore = await comet.getCollateralReserves(arbAsset.address);

      expect(wbtcCollateralReservesBefore).to.be.equal(0);
      expect(cbethCollateralReservesBefore).to.be.equal(0);
      expect(arbCollateralReservesBefore).to.be.equal(0);
    });

    it('comet ERC20 collateral token balances are equal to supplied amounts before absorb', async () => {
      cometWbtcTokenBalanceBefore = await wbtcAsset.balanceOf(comet.address);
      cometCbethTokenBalanceBefore = await cbethAsset.balanceOf(comet.address);
      cometArbTokenBalanceBefore = await arbAsset.balanceOf(comet.address);

      expect(cometWbtcTokenBalanceBefore).to.be.equal(wbtcAmount);
      expect(cometCbethTokenBalanceBefore).to.be.equal(cbethAmount);
      expect(cometArbTokenBalanceBefore).to.be.equal(arbAmount);
    });

    it('comet ERC20 base token balance is reduced by the borrow before absorb', async () => {
      cometBaseTokenBalanceBefore = await baseToken.balanceOf(comet.address);
      expect(cometBaseTokenBalanceBefore).to.be.equal(initialBaseFunding - borrowAmount);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('full WBTC seizure', async () => {
      const wbtcInfo = await comet.getAssetInfoByAddress(wbtcAsset.address);
      const cbethInfo = await comet.getAssetInfoByAddress(cbethAsset.address);
      const arbInfo = await comet.getAssetInfoByAddress(arbAsset.address);
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

      wbtcSeizeAmount = wbtcAmount;
      wbtcSeizedValue = mulFactor(wbtcCollateralValue, wbtcInfo.liquidationFactor);

      debtRemainingValue -= wbtcSeizedValue;
    });

    it('debt after WBTC full seizure is still greater than minDebtValue', () => {
      expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
    });

    it('full cbETH seizure', async () => {
      const cbethInfo = await comet.getAssetInfoByAddress(cbethAsset.address);
      const arbInfo = await comet.getAssetInfoByAddress(arbAsset.address);
      const totalCollateralizedValue =
        mulFactor(cbethCollateralValue, cbethInfo.borrowCollateralFactor) +
        mulFactor(arbCollateralValue, arbInfo.borrowCollateralFactor);

      const wantedCbethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(cbethInfo.liquidationFactor, targetHealthFactor) - cbethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCbethCollateralValue).to.be.greaterThan(cbethCollateralValue);

      cbethSeizeAmount = cbethAmount;
      cbethSeizedValue = mulFactor(cbethCollateralValue, cbethInfo.liquidationFactor);

      debtRemainingValue -= cbethSeizedValue;
    });

    it('debt after cbETH full seizure is less than minDebtValue', () => {
      expect(debtRemainingValue).to.be.lessThan(minDebtValue);
    });

    it('ARB value is below current debt and cannot cover remaining debt', async () => {
      const arbInfo = await comet.getAssetInfoByAddress(arbAsset.address);
      const arbSeizedValueIfFullySeized = mulFactor(arbCollateralValue, arbInfo.liquidationFactor);

      expect(arbCollateralValue).to.be.lessThan(debtRemainingValue);
      expect(arbSeizedValueIfFullySeized).to.be.lessThan(debtRemainingValue);
    });

    it('full ARB seizure as bad debt', async () => {
      const arbInfo = await comet.getAssetInfoByAddress(arbAsset.address);
      const totalCollateralizedValue = mulFactor(arbCollateralValue, arbInfo.borrowCollateralFactor);

      const wantedArbCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(arbInfo.liquidationFactor, targetHealthFactor) - arbInfo.borrowCollateralFactor.toBigInt());
      expect(wantedArbCollateralValue).to.be.greaterThan(arbCollateralValue);

      arbSeizeAmount = arbAmount;
      arbSeizedValue = mulFactor(arbCollateralValue, arbInfo.liquidationFactor);
    });

    it('residual bad debt after all collateral is fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - arbSeizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, wbtcAsset.address)).to.be.equal(0);
    });

    it('alice cbETH collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, cbethAsset.address)).to.be.equal(0);
    });

    it('alice ARB collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, arbAsset.address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balances do not change during absorb', async () => {
      expect(await wbtcAsset.balanceOf(comet.address)).to.be.equal(cometWbtcTokenBalanceBefore);
      expect(await cbethAsset.balanceOf(comet.address)).to.be.equal(cometCbethTokenBalanceBefore);
      expect(await arbAsset.balanceOf(comet.address)).to.be.equal(cometArbTokenBalanceBefore);
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
      const totalSupplyAsset = (await comet.totalsCollateral(wbtcAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(wbtcTotalsCollateralBefore.sub(wbtcSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied cbETH is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(cbethAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(cbethTotalsCollateralBefore.sub(cbethSeizeAmount));
      expect(totalSupplyAsset).to.be.equal(0);
    });

    it('comet total supplied ARB is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(arbAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(arbTotalsCollateralBefore.sub(arbSeizeAmount));
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
      expect(await comet.getCollateralReserves(wbtcAsset.address)).to.be.equal(wbtcCollateralReservesBefore.add(wbtcSeizeAmount));
      expect(await comet.getCollateralReserves(cbethAsset.address)).to.be.equal(cbethCollateralReservesBefore.add(cbethSeizeAmount));
      expect(await comet.getCollateralReserves(arbAsset.address)).to.be.equal(arbCollateralReservesBefore.add(arbSeizeAmount));
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

    let collateralAsset: FaucetToken;
    let absorbTx: ContractTransaction;
    let totalsCollateralBefore: BigNumber;
    let totalSupplyBaseBefore: BigNumber;
    let totalBorrowBaseBefore: BigNumber;
    let collateralReservesBefore: BigNumber;
    let cometCollateralTokenBalanceBefore: BigNumber;
    let cometBaseTokenBalanceBefore: BigNumber;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let minDebtValue: bigint;
    let collateralValue: bigint;
    let seizedValue: bigint;
    let seizeAmount: bigint;

    before(async function() {
      collateralAsset = tokens['AAVE'];
    });

    after(async () => await snapshot.restore());

    it('alice supplies AAVE', async () => {
      await expect(
        comet.connect(alice).supply(collateralAsset.address, collateralAmount)
      ).to.not.be.reverted;
    });

    it('alice borrows above baseBorrowMin', async () => {
      await expect(
        comet.connect(alice).withdraw(baseToken.address, borrowAmount)
      ).to.not.be.reverted;
    });

    it('alice borrow balance is above baseBorrowMin', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(baseBorrowMin);
    });

    it('alice repays part of the borrow', async () => {
      await expect(
        comet.connect(alice).supply(baseToken.address, repayAmount)
      ).to.not.be.reverted;
    });

    it('alice borrow balance is below baseBorrowMin after repay', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount - repayAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.lessThan(baseBorrowMin);
    });

    it('AAVE price drops', async () => {
      await priceFeeds['AAVE'].connect(alice).setRoundData(0, droppedAavePrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);
    });

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

    it('alice collateral balance is equal to supplied amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(collateralAmount);
    });

    it('alice borrow balance remains below baseBorrowMin before absorb', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(borrowAmount - repayAmount);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.lessThan(baseBorrowMin);
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

    it('captures account state before absorb', async () => {
      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);

      expect(oldBalance).to.be.equal(-(borrowAmount - repayAmount));
    });

    it('min debt branch wants to close debt but AAVE cannot cover it', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);
      collateralValue = mulPrice(collateralAmount, droppedAavePrice, assetInfo.scale);

      // debtRemainingValue = 8e8, minDebtValue = 10e8, so absorb enters
      // _processDebtClosing. AAVE value left after LF is 5e8 * 0.85 = 4.25e8,
      // which is insufficient to close the 8e8 debt, so all AAVE is seized.
      seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
      seizeAmount = collateralAmount;

      expect(debtRemainingValue).to.be.lessThan(minDebtValue);
    });

    it('collateral value is less than debt remaining value: full seizure', () => {
      expect(collateralValue).to.be.lessThan(debtRemainingValue);
    });

    it('seized value is less than debt remaining value: full seizure', () => {
      expect(seizedValue).to.be.lessThan(debtRemainingValue);
    });

    it('absorb is successful', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates residual bad debt after all collateral is fully seized', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;
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
      expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(0);
    });

    it('comet ERC20 collateral token balance does not change during absorb', async () => {
      expect(await collateralAsset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore);
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet total supplied collateral is zero', async () => {
      const totalSupplyAsset = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset;

      expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore.sub(seizeAmount));
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
      expect(await comet.getCollateralReserves(collateralAsset.address)).to.be.equal(collateralReservesBefore.add(seizeAmount));
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
    let totalsCollateralBefore: { [symbol: string]: BigNumber } = {};
    let collateralReservesBefore: { [symbol: string]: BigNumber } = {};
    let cometCollateralTokenBalanceBefore: { [symbol: string]: BigNumber } = {};

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
      for (const config of collateralConfigs) {
        totalsCollateralBefore[config.symbol] = (await comet.totalsCollateral(config.asset.address)).totalSupplyAsset;
        collateralReservesBefore[config.symbol] = await comet.getCollateralReserves(config.asset.address);
        cometCollateralTokenBalanceBefore[config.symbol] = await config.asset.balanceOf(comet.address);

        // Note: these checks are not strictly necessary, but they help to ensure that the collateral state is captured correctly.
        // This checks inside the for loop to avoid massive test output.
        expect(totalsCollateralBefore[config.symbol]).to.be.equal(config.amount);
        expect(collateralReservesBefore[config.symbol]).to.be.equal(0);
        expect(cometCollateralTokenBalanceBefore[config.symbol]).to.be.equal(config.amount);
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
        expect(await config.asset.balanceOf(comet.address)).to.be.equal(cometCollateralTokenBalanceBefore[config.symbol]);
      }
    });

    it('comet ERC20 base token balance does not change during absorb', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('all collateral totals are zero', async () => {
      for (const config of collateralConfigs) {
        const totalSupplyAsset = (await comet.totalsCollateral(config.asset.address)).totalSupplyAsset;

        expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore[config.symbol].sub(config.amount));
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
          collateralReservesBefore[config.symbol].add(config.amount)
        );
      }
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });
});