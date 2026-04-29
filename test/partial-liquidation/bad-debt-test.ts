import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, default24Assets } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { BigNumber, ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

describe.only('partial liquidation: bad debt', function() {
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

  // Prices
  const initialPrices = {
    USDC: exp(1, 8),
    COMP: exp(100, 8),
    WETH: exp(2800, 8),
  };

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
      const newCompPrice = initialPrices.COMP * 50n / 100n;
      await priceFeeds['COMP'].connect(alice).setRoundData(0, newCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const principal = (await comet.userBasic(alice.address)).principal;
      const totalsBasic = await comet.totalsBasic();
      const userBasic = await comet.userBasic(alice.address);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase;
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

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

    it('emits AbsorbCollateral for the full collateral amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const targetHealthFactor = (await comet.targetHealthFactor()).toBigInt();

      // Debt is $80 and 1 COMP is now worth $50.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const collateralValue = mulPrice(collateralAmount, compPrice, assetInfo.scale.toBigInt());

      // The target HF formula wants more than $50 of collateral, so the contract seizes all COMP.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor.toBigInt());
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor.toBigInt(), targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValue).to.be.greaterThan(collateralValue);

      // Full seizure means seizeAmount is 1 COMP and seizedValue is $50 * LF 0.90 = $45.
      seizeAmount = collateralAmount;
      seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, collateralAsset.address, seizeAmount, collateralValue);
    });

    it('calculates newBalance as zero after full seizure bad debt handling', async () => {
      // The full seizure repays about $45 of the $80 debt, leaving about $35 unpaid.
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('since all collateral is gone, the contract writes off the residual bad debt', async () => {
      newBalance = 0n;
      expect(newBalance).to.be.equal(0n);
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
      const usdcPrice = (await priceFeeds['USDC'].latestRoundData())[1].toBigInt();
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, usdcPrice, baseScale);

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
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('emits AbsorbCollateral for the full collateral amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const price = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();

      // Debt is $80 and 100 LDO is now worth $50.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const collateralValue = mulPrice(collateralAmount, price, assetInfo.scale.toBigInt());

      // The target HF formula wants more than $50 of collateral, so the contract seizes all LDO.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor.toBigInt());
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor.toBigInt(), targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValue).to.be.greaterThan(collateralValue);

      seizeAmount = collateralAmount;
      seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, collateralAsset.address, seizeAmount, collateralValue);
    });

    it('calculates newBalance as zero after full seizure bad debt handling', async () => {
      const debtRemainingValueAfterSeize = debtRemainingValue - seizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);
    });

    it('since all collateral is gone, the contract writes off the residual bad debt', async () => {
      newBalance = 0n;
      expect(newBalance).to.be.equal(0n);
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
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('emits AbsorbCollateral for the full collateral amount', async () => {
      const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
      const price = (await priceFeeds['sUSDe'].latestRoundData())[1].toBigInt();

      // Debt is $70 and 100 tokens at the last index are now worth $50.
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const collateralValue = mulPrice(collateralAmount, price, assetInfo.scale.toBigInt());

      // The target HF formula wants more than $50 of collateral, so the contract seizes all of it.
      const totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor.toBigInt());
      const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor.toBigInt(), targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCollateralValue).to.be.greaterThan(collateralValue);

      seizeAmount = collateralAmount;
      seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, collateralAsset.address, seizeAmount, collateralValue);
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

      await compAsset.connect(alice).approve(comet.address, compAmount);
      await comet.connect(alice).supply(compAsset.address, compAmount);

      await wethAsset.connect(alice).approve(comet.address, wethAmount);
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
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('emits AbsorbCollateral for full COMP seizure', async () => {
      const compInfo = await comet.getAssetInfoByAddress(compAsset.address);
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const compPrice = (await priceFeeds['COMP'].latestRoundData())[1].toBigInt();
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);

      // COMP is first in asset order. After the 20% price drop, 0.5 COMP is worth $40.
      const compCollateralValue = mulPrice(compAmount, compPrice, compInfo.scale.toBigInt());
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale.toBigInt());
      const totalCollateralizedValue =
        mulFactor(compCollateralValue, compInfo.borrowCollateralFactor.toBigInt()) +
        mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor.toBigInt());

      // The target HF formula wants more than $40 from COMP, so COMP is fully seized.
      const wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor.toBigInt(), targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);

      compSeizeAmount = compAmount;
      compSeizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, compAsset.address, compSeizeAmount, compCollateralValue);
    });

    it('emits AbsorbCollateral for full WETH seizure', async () => {
      const wethInfo = await comet.getAssetInfoByAddress(wethAsset.address);
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();
      const wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale.toBigInt());

      // After COMP full seizure, debt is $80 - $36 = $44.
      debtRemainingValue -= compSeizedValue;

      // WETH is worth $44, but the target HF formula wants more than all of it,
      // so the second asset is also fully seized.
      const totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor.toBigInt());
      const wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor.toBigInt(), targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
      expect(wantedWethCollateralValue).to.be.greaterThan(wethCollateralValue);

      wethSeizeAmount = wethAmount;
      wethSeizedValue = mulFactor(wethCollateralValue, wethInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, wethAsset.address, wethSeizeAmount, wethCollateralValue);
    });

    it('calculates newBalance as zero after both assets are fully seized', async () => {
      // Both assets together repay $36 + $39.60 = $75.60, leaving $4.40 bad debt.
      const debtRemainingValueAfterSeize = debtRemainingValue - wethSeizedValue;
      const balanceBeforeBadDebtWriteOff = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);
      expect(balanceBeforeBadDebtWriteOff).to.be.lessThan(0n);

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
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('emits AbsorbCollateral for full AAVE seizure', async () => {
      const aaveInfo = await comet.getAssetInfoByAddress(aaveAsset.address);
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const aavePrice = (await priceFeeds['AAVE'].latestRoundData())[1].toBigInt();
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const aaveCollateralValue = mulPrice(aaveAmount, aavePrice, aaveInfo.scale.toBigInt());
      const ldoCollateralValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale.toBigInt());
      const totalCollateralizedValue =
        mulFactor(aaveCollateralValue, aaveInfo.borrowCollateralFactor.toBigInt()) +
        mulFactor(ldoCollateralValue, ldoInfo.borrowCollateralFactor.toBigInt());

      const wantedAaveCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(aaveInfo.liquidationFactor.toBigInt(), targetHealthFactor) - aaveInfo.borrowCollateralFactor.toBigInt());
      expect(wantedAaveCollateralValue).to.be.greaterThan(aaveCollateralValue);

      aaveSeizeAmount = aaveAmount;
      aaveSeizedValue = mulFactor(aaveCollateralValue, aaveInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, aaveAsset.address, aaveSeizeAmount, aaveCollateralValue);
    });

    it('emits AbsorbCollateral for full LDO seizure', async () => {
      const ldoInfo = await comet.getAssetInfoByAddress(ldoAsset.address);
      const ldoPrice = (await priceFeeds['LDO'].latestRoundData())[1].toBigInt();
      const ldoCollateralValue = mulPrice(ldoAmount, ldoPrice, ldoInfo.scale.toBigInt());

      debtRemainingValue -= aaveSeizedValue;
      const totalCollateralizedValue = mulFactor(ldoCollateralValue, ldoInfo.borrowCollateralFactor.toBigInt());
      const wantedLdoCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(ldoInfo.liquidationFactor.toBigInt(), targetHealthFactor) - ldoInfo.borrowCollateralFactor.toBigInt());
      expect(wantedLdoCollateralValue).to.be.greaterThan(ldoCollateralValue);

      ldoSeizeAmount = ldoAmount;
      ldoSeizedValue = mulFactor(ldoCollateralValue, ldoInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, ldoAsset.address, ldoSeizeAmount, ldoCollateralValue);
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
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('emits AbsorbCollateral for full USDe seizure', async () => {
      const usdeInfo = await comet.getAssetInfoByAddress(usdeAsset.address);
      const susdeInfo = await comet.getAssetInfoByAddress(susdeAsset.address);
      const usdePrice = (await priceFeeds['USDe'].latestRoundData())[1].toBigInt();
      const susdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const usdeCollateralValue = mulPrice(usdeAmount, usdePrice, usdeInfo.scale.toBigInt());
      const susdeCollateralValue = mulPrice(susdeAmount, susdePrice, susdeInfo.scale.toBigInt());
      const totalCollateralizedValue =
        mulFactor(usdeCollateralValue, usdeInfo.borrowCollateralFactor.toBigInt()) +
        mulFactor(susdeCollateralValue, susdeInfo.borrowCollateralFactor.toBigInt());

      const wantedUsdeCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(usdeInfo.liquidationFactor.toBigInt(), targetHealthFactor) - usdeInfo.borrowCollateralFactor.toBigInt());
      expect(wantedUsdeCollateralValue).to.be.greaterThan(usdeCollateralValue);

      usdeSeizeAmount = usdeAmount;
      usdeSeizedValue = mulFactor(usdeCollateralValue, usdeInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, usdeAsset.address, usdeSeizeAmount, usdeCollateralValue);
    });

    it('emits AbsorbCollateral for full sUSDe seizure', async () => {
      const susdeInfo = await comet.getAssetInfoByAddress(susdeAsset.address);
      const susdePrice = (await priceFeeds['sUSDe'].latestRoundData())[1].toBigInt();
      const susdeCollateralValue = mulPrice(susdeAmount, susdePrice, susdeInfo.scale.toBigInt());

      debtRemainingValue -= usdeSeizedValue;
      const totalCollateralizedValue = mulFactor(susdeCollateralValue, susdeInfo.borrowCollateralFactor.toBigInt());
      const wantedSusdeCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(susdeInfo.liquidationFactor.toBigInt(), targetHealthFactor) - susdeInfo.borrowCollateralFactor.toBigInt());
      expect(wantedSusdeCollateralValue).to.be.greaterThan(susdeCollateralValue);

      susdeSeizeAmount = susdeAmount;
      susdeSeizedValue = mulFactor(susdeCollateralValue, susdeInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, susdeAsset.address, susdeSeizeAmount, susdeCollateralValue);
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
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('emits AbsorbCollateral for full UNI seizure', async () => {
      const uniInfo = await comet.getAssetInfoByAddress(uniAsset.address);
      const mkrInfo = await comet.getAssetInfoByAddress(mkrAsset.address);
      const uniPrice = (await priceFeeds['UNI'].latestRoundData())[1].toBigInt();
      const mkrPrice = (await priceFeeds['MKR'].latestRoundData())[1].toBigInt();

      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      const uniCollateralValue = mulPrice(uniAmount, uniPrice, uniInfo.scale.toBigInt());
      const mkrCollateralValue = mulPrice(mkrAmount, mkrPrice, mkrInfo.scale.toBigInt());
      const totalCollateralizedValue =
        mulFactor(uniCollateralValue, uniInfo.borrowCollateralFactor.toBigInt()) +
        mulFactor(mkrCollateralValue, mkrInfo.borrowCollateralFactor.toBigInt());

      const wantedUniCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(uniInfo.liquidationFactor.toBigInt(), targetHealthFactor) - uniInfo.borrowCollateralFactor.toBigInt());
      expect(wantedUniCollateralValue).to.be.greaterThan(uniCollateralValue);

      uniSeizeAmount = uniAmount;
      uniSeizedValue = mulFactor(uniCollateralValue, uniInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, uniAsset.address, uniSeizeAmount, uniCollateralValue);
    });

    it('emits AbsorbCollateral for full MKR seizure', async () => {
      const mkrInfo = await comet.getAssetInfoByAddress(mkrAsset.address);
      const mkrPrice = (await priceFeeds['MKR'].latestRoundData())[1].toBigInt();
      const mkrCollateralValue = mulPrice(mkrAmount, mkrPrice, mkrInfo.scale.toBigInt());

      debtRemainingValue -= uniSeizedValue;
      const totalCollateralizedValue = mulFactor(mkrCollateralValue, mkrInfo.borrowCollateralFactor.toBigInt());
      const wantedMkrCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(mkrInfo.liquidationFactor.toBigInt(), targetHealthFactor) - mkrInfo.borrowCollateralFactor.toBigInt());
      expect(wantedMkrCollateralValue).to.be.greaterThan(mkrCollateralValue);

      mkrSeizeAmount = mkrAmount;
      mkrSeizedValue = mulFactor(mkrCollateralValue, mkrInfo.liquidationFactor.toBigInt());

      await expect(absorbTx)
        .to.emit(comet, 'AbsorbCollateral')
        .withArgs(absorber.address, alice.address, mkrAsset.address, mkrSeizeAmount, mkrCollateralValue);
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
    const collateralConfigsByIndex = [...collateralConfigs].sort((a, b) => a.index - b.index);
    const borrowAmount = exp(65, 6); // $65

    let collateralAssets: { [symbol: string]: FaucetToken } = {};
    let absorbTx: ContractTransaction;
    let totalsCollateralBefore: { [symbol: string]: BigNumber } = {};
    let collateralReservesBefore: { [symbol: string]: BigNumber } = {};
    let cometCollateralTokenBalanceBefore: { [symbol: string]: BigNumber } = {};
    let collateralValues: { [symbol: string]: bigint } = {};
    let seizeAmounts: { [symbol: string]: bigint } = {};
    let seizedValues: { [symbol: string]: bigint } = {};
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
    });

    after(async () => await snapshot.restore());

    it('sanity check: user is liquidatable', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.be.true;
    });

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
      await expect(absorbTx).to.be.not.be.reverted;
    });

    it('emits AbsorbCollateral for full seizure of all collaterals', async () => {
      for (const [index, config] of collateralConfigsByIndex.entries()) {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAssets[config.symbol].address);
        const price = (await priceFeeds[config.symbol].latestRoundData())[1].toBigInt();
        let remainingCollateralizedValue = 0n;

        collateralValues[config.symbol] = mulPrice(config.amount, price, assetInfo.scale.toBigInt());

        const remainingConfigs = collateralConfigsByIndex.slice(index);
        for (const remainingConfig of remainingConfigs) {
          const remainingInfo = await comet.getAssetInfoByAddress(collateralAssets[remainingConfig.symbol].address);
          const remainingPrice = (await priceFeeds[remainingConfig.symbol].latestRoundData())[1].toBigInt();
          const remainingValue = mulPrice(remainingConfig.amount, remainingPrice, remainingInfo.scale.toBigInt());
          remainingCollateralizedValue += mulFactor(remainingValue, remainingInfo.borrowCollateralFactor.toBigInt());
        }

        const wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - remainingCollateralizedValue) * factorScale
          / (mulFactor(assetInfo.liquidationFactor.toBigInt(), targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());
        expect(wantedCollateralValue).to.be.greaterThan(collateralValues[config.symbol]);

        seizeAmounts[config.symbol] = config.amount;
        seizedValues[config.symbol] = mulFactor(collateralValues[config.symbol], assetInfo.liquidationFactor.toBigInt());

        await expect(absorbTx)
          .to.emit(comet, 'AbsorbCollateral')
          .withArgs(absorber.address, alice.address, collateralAssets[config.symbol].address, seizeAmounts[config.symbol], collateralValues[config.symbol]);

        debtRemainingValue -= seizedValues[config.symbol];
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

        expect(totalSupplyAsset).to.be.equal(totalsCollateralBefore[config.symbol].sub(seizeAmounts[config.symbol]));
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
          collateralReservesBefore[config.symbol].add(seizeAmounts[config.symbol])
        );
      });
    }

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });
  });
});