import { ethers, expect, exp, presentValue, mulPrice, mulFactor, divPrice, default24Assets, CollateralState, makeCollateralStates,
  makeConfigurator, 
  principalValue} from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, CometProxyAdmin, Configurator, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';
import { AssetInfoStructOutput } from 'build/types/CometWithExtendedAssetList';

// These flows cover absorption after a collateral is soft-delisted by setting BCF to 0.
// The collateral no longer contributes to the borrow-side health value, but if LCF and LF
// remain positive it is still liquidatable and must reduce the account's debt when seized.
describe('absorb logic with delisted collaterals', function() {
  // Protocol
  let comet: CometHarnessInterfaceExtendedAssetList;
  let configurator: Configurator;
  let cometProxyAdmin: CometProxyAdmin;
  let configuratorProxyAddress: string;
  let cometProxyAddress: string;

  const baseTokenPrice = exp(1, 8);
  const initialBaseFunding = baseTokenPrice * 10_000n;
  const collateralAmount = exp(1, 18); // 1 COMP, $100 at initial price (BCF=0.8 → $80 borrow power)
  const borrowAmount = exp(70, 6); // $70 USDC, within the $80 borrow limit

  // Assets
  let tokens: { [symbol: string]: FaucetToken } = {};
  let baseToken: FaucetToken;
  let priceFeeds: { [symbol: string]: SimplePriceFeed } = {};

  let alice: SignerWithAddress;
  let absorber: SignerWithAddress;
  let pauseGuardian: SignerWithAddress;

  // Math
  const baseScale: bigint = 10n ** 6n;
  const factorScale: bigint = 10n ** 18n;
  let targetHealthFactor: bigint;

  let snapshot: SnapshotRestorer;

  before(async function() {
    const protocol = await makeConfigurator({
      base: 'USDC',
      assets: {
        USDC: { decimals: 6, initialPrice: 1 },
        ...default24Assets(),
      },
      baseTrackingBorrowSpeed: 0,
    });
    configuratorProxyAddress = protocol.configuratorProxy.address;
    cometProxyAddress = protocol.cometProxy.address;
    configurator = protocol.configurator.attach(configuratorProxyAddress);
    comet = protocol.cometWithExtendedAssetList.attach(cometProxyAddress);
    cometProxyAdmin = protocol.proxyAdmin;

    for (let asset in protocol.tokens) {
      if (asset === 'USDC') continue;
      tokens[asset] = protocol.tokens[asset] as FaucetToken;
      priceFeeds[asset] = protocol.priceFeeds[asset];
    }
    baseToken = protocol.tokens['USDC'] as FaucetToken;
    priceFeeds['USDC'] = protocol.priceFeeds['USDC'];

    [alice, absorber] = protocol.users;
    pauseGuardian = protocol.pauseGuardian;

    const allocateAmount = exp(1_000_000, 18);
    for (const token of Object.values(protocol.tokens)) {
      await (token as FaucetToken).allocateTo(alice.address, allocateAmount);
      await (token as FaucetToken).connect(alice).approve(comet.address, ethers.constants.MaxUint256);
    }

    // Make reserves on comet for borrowings
    await baseToken.allocateTo(comet.address, initialBaseFunding);

    await comet.connect(alice).supply(tokens['COMP'].address, collateralAmount);
    await comet.connect(alice).withdraw(baseToken.address, borrowAmount);
    targetHealthFactor = (await comet.targetHealthFactor()).toBigInt();

    snapshot = await takeSnapshot();
  });

  context('1 soft delisted collateral: BCF = 0 (partial seizure with falling into minDebt case)', function () {
    const droppedCompPrice = exp(80, 8); // 1 COMP is worth $80 after the price drop
    const collateralKeys = ['COMP'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let collateralValue: bigint;
    let totalCollateralizedValue: bigint;
    let wantedCollateralValue: bigint;
    let minDebtValue: bigint;
    let closeoutCollateralValueLeft: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let assetInfo: AssetInfoStructOutput;

    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      minDebtValue = mulPrice((await comet.baseBorrowMin()).toBigInt(), baseTokenPrice, baseScale);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is not borrow-collateralized after COMP BCF is zeroed', async () => {
      expect(await comet.isBorrowCollateralized(alice.address)).to.equal(false);
    });

    it('sanity check: alice is liquidatable because COMP LCF still counts for liquidation', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      // debtRemainingValue = 70e6 * 1e8 / 1e6 = 70e8
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });


    it('calculates COMP collateral value at the dropped price', async () => {
      // collateralValue = 1e18 * 80e8 / 1e18 = 80e8
      collateralValue = mulPrice(collateralAmount, droppedCompPrice, assetInfo.scale);
      expect(collateralValue).to.be.equal(exp(80, 8));
    });

    it('excludes the BCF-zero COMP from total collateralized value', async () => {
      // totalCollateralizedValue = collateralValue * BCF = 80e8 * 0 = 0
      totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      expect(totalCollateralizedValue).to.be.equal(0n);
    });

    it('calculates the COMP amount needed to close the debt', async () => {
      // With totalCollateralizedValue = 0 and BCF = 0, the target-HF formula reduces to:
      // wantedCollateralValue = debtRemainingValue / LF = 70e8 / 0.90 = 77.777...e8
      wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());

      expect(wantedCollateralValue).to.be.lessThan(collateralValue);
    });

    it('calculates the rounded COMP seize amount', () => {
      // seizeAmount = wantedCollateralValue * COMP scale / COMP price
      // = 77.777...e8 * 1e18 / 80e8 = 0.972222222125 COMP
      collateralsState['COMP'].seizeAmount = divPrice(wantedCollateralValue, droppedCompPrice, assetInfo.scale);
    });

    it('calculates the seized value from the rounded seize amount', () => {
      // seizedValue = wantedCollateralValue * LF
      // = 77.77777777e8 * 0.90 = 69.99999999e8
      collateralsState['COMP'].seizedValue = mulFactor(wantedCollateralValue, assetInfo.liquidationFactor);
    });

    it('subtracts the seized value from the debt remaining value and fall into minDebt case', () => {
      expect(debtRemainingValue - collateralsState['COMP'].seizedValue).to.be.lessThan(minDebtValue);
      // due to the rounding, remaining debt is 1 wei
      expect(debtRemainingValue - collateralsState['COMP'].seizedValue).to.be.equal(1n);
    });

    it('calculates closeout collateral value from the full COMP balance', () => {
      // _processDebtClosing starts from the full collateral balance:
      // closeoutCollateralValue = 1e18 * 80e8 / 1e18 = 80e8
      wantedCollateralValue = mulPrice(collateralAmount, droppedCompPrice, assetInfo.scale);
    });

    it('calculates closeout collateral value left after liquidation factor', () => {
      // closeoutCollateralValueLeft = wantedCollateralValue * LF
      // = 80e8 * 0.90 = 72e8
      closeoutCollateralValueLeft = mulFactor(wantedCollateralValue, assetInfo.liquidationFactor);
    });

    it('confirms the closeout branch can cover the full remaining debt', () => {
      // debtRemainingValue = 70e8 and closeoutCollateralValueLeft = 72e8,
      // so _processDebtClosing takes its partial-close branch.
      expect(debtRemainingValue).to.be.lessThan(closeoutCollateralValueLeft);
    });

    it('calculates closeout seize amount from the full remaining debt', () => {
      // collateral amount to seize = (debt / LF) / price
      // adjustedDebtValue = 70e8 * 1e18 / 0.90e18 = 77.77777777e8
      const adjustedDebtValue = debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt();
      collateralsState['COMP'].seizeAmount = divPrice(adjustedDebtValue, droppedCompPrice, assetInfo.scale);
    });

    it('recomputes closeout wanted collateral value from the closeout seize amount', () => {
      // wantedCollateralValue = closeoutSeizeAmount * COMP price / COMP scale
      // = 0.972222222125e18 * 80e8 / 1e18 = 77.77777777e8
      wantedCollateralValue = mulPrice(collateralsState['COMP'].seizeAmount, droppedCompPrice, assetInfo.scale);
    });

    it('treats the closeout seized value as the full remaining debt', () => {
      // _processDebtClosing sets seizedValue = debtRemainingValue in this branch,
      // so the 1 price-scale unit rounding shortfall does not leave a borrow.
      collateralsState['COMP'].seizedValue = debtRemainingValue;
    });

    it('deducts the seized COMP value from the debt even though COMP has BCF zero', () => {
      expect(debtRemainingValue - collateralsState['COMP'].seizedValue).to.be.equal(0n);
    });

    it('AbsorbCollateral seizes COMP even though COMP has BCF zero', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, wantedCollateralValue
      );
    });

    it('calculates new balance as zero after the seized COMP closes the debt', () => {
      newBalance = 0n;
    });

    it('AbsorbDebt writes off the closed borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice COMP collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(
        collateralAmount - collateralsState['COMP'].seizeAmount
      );
    });

    it('comet total supplied COMP is reduced by the seized amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.toBigInt() - collateralsState['COMP'].seizeAmount
      );
    });

    it('comet COMP reserves increase by the seized amount', async () => {
      expect((await comet.getCollateralReserves(tokens['COMP'].address)).toBigInt()).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.toBigInt() + collateralsState['COMP'].seizeAmount
      );
    });

    it('asset remains in the assetIn list because some COMP remains', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('alice borrow balance is zero', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('1 soft delisted collateral: BCF = 0, full seizure', function () {
    const droppedCompPrice = exp(50, 8); // 1 COMP is worth $50 after the price drop
    const collateralKeys = ['COMP'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let collateralValue: bigint;
    let totalCollateralizedValue: bigint;
    let wantedCollateralValue: bigint;
    let debtRemainingValueAfterSeize: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let reservedBefore: number;
    let assetInfo: AssetInfoStructOutput;

    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      reservedBefore = userBasic._reserved;
      assetInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is not borrow-collateralized after COMP BCF is zeroed', async () => {
      expect(await comet.isBorrowCollateralized(alice.address)).to.equal(false);
    });

    it('sanity check: alice is liquidatable because COMP LCF still counts for liquidation', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      // debtRemainingValue = 70e6 * 1e8 / 1e6 = 70e8
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('calculates COMP collateral value at the dropped price', async () => {
      // collateralValue = 1e18 * 50e8 / 1e18 = 50e8
      collateralValue = mulPrice(collateralAmount, droppedCompPrice, assetInfo.scale);
      expect(collateralValue).to.be.equal(exp(50, 8));
    });

    it('excludes the BCF-zero COMP from total collateralized value', async () => {
      // totalCollateralizedValue = collateralValue * BCF = 50e8 * 0 = 0
      totalCollateralizedValue = mulFactor(collateralValue, assetInfo.borrowCollateralFactor);
      expect(totalCollateralizedValue).to.be.equal(0n);
    });

    it('calculates that closing the debt wants more COMP than alice has', async () => {
      // With totalCollateralizedValue = 0 and BCF = 0, the target-HF formula reduces to:
      // wantedCollateralValue = debtRemainingValue / LF = 70e8 / 0.90 = 77.777...e8
      wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(assetInfo.liquidationFactor, targetHealthFactor) - assetInfo.borrowCollateralFactor.toBigInt());

      expect(wantedCollateralValue).to.be.greaterThan(collateralValue);
    });

    it('uses the full captured COMP amount as the seizure amount', async () => {
      collateralsState['COMP'].seizeAmount = collateralAmount;
      collateralsState['COMP'].seizedValue = mulFactor(collateralValue, assetInfo.liquidationFactor);
      wantedCollateralValue = collateralValue;

      // seizedValue = 50e8 * 0.90 = 45e8
      expect(collateralsState['COMP'].seizedValue).to.be.equal(exp(45, 8));
    });

    it('deducts the seized COMP value from the debt even though COMP has BCF zero', () => {
      debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['COMP'].seizedValue;

      // debtRemainingValueAfterSeize = 70e8 - 45e8 = 25e8
      expect(debtRemainingValueAfterSeize).to.be.equal(exp(25, 8));
    });

    it('AbsorbCollateral seizes all COMP even though COMP has BCF zero', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, wantedCollateralValue
      );
    });

    it('calculates new balance as zero after bad debt handling', () => {
      // The full seizure leaves residual debt, but totalCollateralizedValue remains zero,
      // so absorb writes off the residual shortfall as bad debt.
      expect(debtRemainingValueAfterSeize).to.be.greaterThan(0n);
      newBalance = 0n;
    });

    it('AbsorbDebt writes off the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('comet total supplied COMP is reduced by the full collateral amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.toBigInt() - collateralsState['COMP'].seizeAmount
      );
    });

    it('comet COMP reserves increase by the full collateral amount', async () => {
      expect((await comet.getCollateralReserves(tokens['COMP'].address)).toBigInt()).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.toBigInt() + collateralsState['COMP'].seizeAmount
      );
    });

    it('asset is removed from the assetIn list because all COMP was seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('alice borrow balance is zero', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('2 collaterals: soft delisted COMP first, normal WETH second, partial seizure leaves debt above minDebt', function () {
    const droppedCompPrice = exp(80, 8); // 1 COMP is worth $80 after the price drop
    const wethAmount = exp(0.001, 18); // 0.001 WETH, worth $2
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let debtRemainingValueAfterSeize: bigint;
    let compCollateralValue: bigint;
    let wethCollateralValue: bigint;
    let liquidationValue: bigint;
    let totalCollateralizedValue: bigint;
    let wantedCollateralValue: bigint;
    let minDebtValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let compInfo: AssetInfoStructOutput;
    let wethInfo: AssetInfoStructOutput;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      minDebtValue = mulPrice((await comet.baseBorrowMin()).toBigInt(), baseTokenPrice, baseScale);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is not borrow-collateralized after COMP BCF is zeroed', async () => {
      expect(await comet.isBorrowCollateralized(alice.address)).to.equal(false);
    });

    it('sanity check: alice is liquidatable because LCF-weighted collateral is below debt', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      // debtRemainingValue = 70e6 * 1e8 / 1e6 = 70e8
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('calculates COMP collateral value at the dropped price', () => {
      // compCollateralValue = 1e18 * 80e8 / 1e18 = 80e8
      compCollateralValue = mulPrice(collateralAmount, droppedCompPrice, compInfo.scale);
      expect(compCollateralValue).to.be.equal(exp(80, 8));
    });

    it('calculates WETH collateral value at the current price', async () => {
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // wethCollateralValue = 0.001e18 * 2000e8 / 1e18 = 2e8
      wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      expect(wethCollateralValue).to.be.equal(exp(2, 8));
    });

    it('calculates LCF-weighted liquidation value below debt', () => {
      // liquidationValue = COMP value * LCF + WETH value * LCF
      // = 80e8 * 0.85 + 2e8 * 0.80 = 69.6e8
      liquidationValue = mulFactor(compCollateralValue, compInfo.liquidateCollateralFactor)
        + mulFactor(wethCollateralValue, wethInfo.liquidateCollateralFactor);

      expect(liquidationValue).to.be.equal(exp(69.6, 8));
      expect(liquidationValue).to.be.lessThan(debtRemainingValue);
    });

    it('excludes soft delisted COMP but includes WETH in total collateralized value', () => {
      // totalCollateralizedValue = COMP value * 0 + WETH value * 0.75 = 1.5e8
      totalCollateralizedValue = mulFactor(compCollateralValue, compInfo.borrowCollateralFactor)
        + mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      expect(totalCollateralizedValue).to.be.equal(exp(1.5, 8));
    });

    it('calculates the COMP amount needed to reach target health', () => {
      // wantedCollateralValue =
      //   (targetHF * debt - totalCollateralizedValue) / (targetHF * LF - BCF)
      // = (1.05 * 70e8 - 1.5e8) / (1.05 * 0.90 - 0) = 76.19047619e8
      wantedCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());
    });

    it('COMP collateral value covers remaining debt', () => {
      expect(wantedCollateralValue).to.be.lessThan(compCollateralValue);
    });

    it('calculates seize amount of COMP collateral', async () => {
      collateralsState['COMP'].seizeAmount = divPrice(wantedCollateralValue, droppedCompPrice, compInfo.scale);
    });

    it('calculates seized value and leaves debt above minDebt', () => {
      // seizedValue = wantedCollateralValue * LF = 76.19047619e8 * 0.90 = 68.57142857e8
      collateralsState['COMP'].seizedValue = mulFactor(wantedCollateralValue, compInfo.liquidationFactor);
      debtRemainingValueAfterSeize = debtRemainingValue - collateralsState['COMP'].seizedValue;
    });

    it('remaining debt is above minDebt', () => {
      expect(debtRemainingValueAfterSeize).to.be.greaterThan(minDebtValue);
    });

    it('reaches target health without entering the minDebt closeout branch', () => {
      // debtRemainingValueAfterSeize * targetHF = 1.42857143e8 * 1.05 = 1.5e8
      expect(mulFactor(debtRemainingValueAfterSeize, targetHealthFactor)).to.be.equal(totalCollateralizedValue);
    });

    it('AbsorbCollateral seizes only part of COMP', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, wantedCollateralValue
      );
    });

    it('does not seize WETH', async () => {
      const absorbReceipt = await absorbTx.wait();
      const wethAbsorbCollateralEvents = absorbReceipt.events?.filter((event) =>
        event.event === 'AbsorbCollateral' && event.args?.asset === tokens['WETH'].address
      ) ?? [];

      expect(wethAbsorbCollateralEvents.length).to.be.equal(0);
    });

    it('alice COMP collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(
        collateralAmount - collateralsState['COMP'].seizeAmount
      );
    });

    it('alice WETH collateral balance is unchanged', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(wethAmount);
    });

    it('comet total supplied COMP is reduced by the seized amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.toBigInt() - collateralsState['COMP'].seizeAmount
      );
    });

    it('comet total supplied WETH is unchanged', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState['WETH'].totalsCollateralBefore);
    });

    it('comet COMP reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add( collateralsState['COMP'].seizeAmount
        ));
    });

    it('comet WETH reserves are unchanged', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(collateralsState['WETH'].collateralReservesBefore);
    });

    it('assetIn list is unchanged because both collateral balances remain', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance is unchanged', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('alice is stll being borrower', async () => {
      newBalance = -(debtRemainingValueAfterSeize * baseScale / baseTokenPrice);

      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(-newBalance);
    });

    it('alice borrow balance is above minDebt', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(await comet.baseBorrowMin());
    });

    it('alice has new principal', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(newPrincipal);
    });

    it('alice principal remains negative', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.lessThan(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the absorbed base amount', async () => {
      basePaidOut = newBalance - oldBalance;
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('2 collaterals: normal COMP first, soft delisted WETH second, partial seizure closes debt', function () {
    const droppedCompPrice = exp(20, 8); // 1 COMP is worth $20 after the price drop
    const wethAmount = exp(0.03, 18); // 0.03 WETH, worth $60
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let debtRemainingValueAfterCompSeize: bigint;
    let debtRemainingValueAfterWethSeize: bigint;
    let compCollateralValue: bigint;
    let wethCollateralValue: bigint;
    let liquidationValue: bigint;
    let totalCollateralizedValue: bigint;
    let wantedCompCollateralValue: bigint;
    let wantedWethCollateralValue: bigint;
    let minDebtValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let compInfo: AssetInfoStructOutput;
    let wethInfo: AssetInfoStructOutput;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      minDebtValue = mulPrice((await comet.baseBorrowMin()).toBigInt(), baseTokenPrice, baseScale);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is not borrow-collateralized after WETH BCF is zeroed and COMP price drops', async () => {
      expect(await comet.isBorrowCollateralized(alice.address)).to.equal(false);
    });

    it('sanity check: alice is liquidatable because LCF-weighted collateral is below debt', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      // debtRemainingValue = 70e6 * 1e8 / 1e6 = 70e8
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('calculates COMP collateral value at the dropped price', () => {
      // compCollateralValue = 1e18 * 20e8 / 1e18 = 20e8
      compCollateralValue = mulPrice(collateralAmount, droppedCompPrice, compInfo.scale);
      expect(compCollateralValue).to.be.equal(exp(20, 8));
    });

    it('calculates WETH collateral value at the current price', async () => {
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // wethCollateralValue = 0.03e18 * 2000e8 / 1e18 = 60e8
      wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      expect(wethCollateralValue).to.be.equal(exp(60, 8));
    });

    it('calculates LCF-weighted liquidation value below debt', () => {
      // liquidationValue = COMP value * LCF + WETH value * LCF
      // = 20e8 * 0.85 + 60e8 * 0.80 = 65e8
      liquidationValue = mulFactor(compCollateralValue, compInfo.liquidateCollateralFactor)
        + mulFactor(wethCollateralValue, wethInfo.liquidateCollateralFactor);

      expect(liquidationValue).to.be.equal(exp(65, 8));
      expect(liquidationValue).to.be.lessThan(debtRemainingValue);
    });

    it('includes normal COMP but excludes soft delisted WETH from total collateralized value', () => {
      // totalCollateralizedValue = COMP value * 0.8 + WETH value * 0 = 16e8
      totalCollateralizedValue = mulFactor(compCollateralValue, compInfo.borrowCollateralFactor)
        + mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      expect(totalCollateralizedValue).to.be.equal(exp(16, 8));
    });

    it('calculates that COMP alone cannot reach target health', () => {
      // wantedCompCollateralValue =
      //   (targetHF * debt - totalCollateralizedValue) / (targetHF * LF - BCF)
      // = (1.05 * 70e8 - 16e8) / (1.05 * 0.90 - 0.80) = 396.55172413e8
      wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());

      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);
    });

    it('COMP can not cover wanted collateral value, full seizure', () => {
      collateralsState['COMP'].seizeAmount = collateralAmount;
    });

    it('calculates seized COMP value and leaves debt above minDebt', () => {
      // comp seizedValue = 20e8 * 0.90 = 18e8
      collateralsState['COMP'].seizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
      debtRemainingValueAfterCompSeize = debtRemainingValue - collateralsState['COMP'].seizedValue;

      expect(debtRemainingValueAfterCompSeize).to.be.greaterThan(minDebtValue);
    });

    it('calculates the WETH value needed to reach target health', () => {
      // totalCollateralizedValue is zero after COMP is fully seized because WETH has BCF = 0.
      // wantedWethCollateralValue = (1.05 * 52e8 - 0) / (1.05 * 0.90 - 0) = 57.77777777e8
      wantedWethCollateralValue = (mulFactor(debtRemainingValueAfterCompSeize, targetHealthFactor)) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());
    });

    it('WETH collateral value covers the target-health seizure', () => {
      expect(wantedWethCollateralValue).to.be.lessThan(wethCollateralValue);
    });

    it('target-health WETH seizure would leave debt below minDebt', () => {
      // target-health seizedValue = 57.77777777e8 * 0.90 = 51.99999999e8
      // debt left = 52e8 - 51.99999999e8 = 1, so absorb switches to the minDebt closeout branch.
      const targetHealthSeizedValue = mulFactor(wantedWethCollateralValue, wethInfo.liquidationFactor);
      const debtRemainingValueAfterTargetHealthSeize = debtRemainingValueAfterCompSeize - targetHealthSeizedValue;

      expect(debtRemainingValueAfterTargetHealthSeize).to.be.lessThanOrEqual(minDebtValue);
    });

    it('calculates the WETH amount needed to close the remaining debt', async () => {
      // wantedWethCollateralValue = remaining debt / LF = 52e8 / 0.90 = 57.77777777e8
      wantedWethCollateralValue = debtRemainingValueAfterCompSeize * factorScale / wethInfo.liquidationFactor.toBigInt();
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();
      collateralsState['WETH'].seizeAmount = divPrice(wantedWethCollateralValue, wethPrice, wethInfo.scale);
    });

    it('calculates seized WETH value and closes the debt', () => {
      // The minDebt closeout branch treats the seized WETH as covering all remaining debt.
      collateralsState['WETH'].seizedValue = debtRemainingValueAfterCompSeize;
      debtRemainingValueAfterWethSeize = debtRemainingValueAfterCompSeize - collateralsState['WETH'].seizedValue;

      expect(collateralsState['WETH'].seizedValue).to.be.equal(exp(52, 8));
      expect(debtRemainingValueAfterWethSeize).to.be.equal(0n);
    });

    it('AbsorbCollateral seizes all COMP first', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, compCollateralValue
      );
    });

    it('AbsorbCollateral seizes only part of WETH second', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['WETH'].address, collateralsState['WETH'].seizeAmount, wantedWethCollateralValue
      );
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(
        wethAmount - collateralsState['WETH'].seizeAmount
      );
    });

    it('alice still holds WETH collateral after partial seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.greaterThan(0);
    });

    it('comet total supplied COMP is reduced by the full collateral amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet total supplied WETH is reduced by the seized amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['WETH'].totalsCollateralBefore.sub(collateralsState['WETH'].seizeAmount)
      );
    });

    it('comet COMP reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet WETH reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(
        collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount)
      );
    });

    it('assetIn list keeps only WETH because COMP was fully seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore & ~(1 << compInfo.offset));
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance is unchanged', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('alice borrow balance is zero', async () => {
      newBalance = 0n;

      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the full absorbed base amount', async () => {
      basePaidOut = newBalance - oldBalance;
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the full absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('1 collateral: full delisted COMP absorb', function () {
    const collateralKeys = ['COMP'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let totalCollateralizedValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let compInfo: AssetInfoStructOutput;

    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is not borrow-collateralized because COMP has no BCF', async () => {
      expect(await comet.isBorrowCollateralized(alice.address)).to.equal(false);
    });

    it('sanity check: alice is liquidatable because full-delisted COMP contributes no liquidation value', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      // debtRemainingValue = 70e6 * 1e8 / 1e6 = 70e8
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('excludes full-delisted COMP from total collateralized value', async () => {
      const collateralValue = mulPrice(collateralAmount, (await priceFeeds['COMP'].latestRoundData())[1], compInfo.scale);
      totalCollateralizedValue = mulFactor(collateralValue, compInfo.borrowCollateralFactor);
      expect(totalCollateralizedValue).to.be.equal(0n);
    });

    it('uses zero cached price and full COMP balance as the seizure amount', () => {
      collateralsState['COMP'].seizeAmount = collateralAmount;
      collateralsState['COMP'].seizedValue = 0n;

      expect(collateralsState['COMP'].seizedValue).to.be.equal(0n);
    });

    it('AbsorbCollateral seizes all COMP with zero wanted value', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, 0
      );
    });

    it('debt is not reduced by full-delisted COMP', () => {
      expect(debtRemainingValue - collateralsState['COMP'].seizedValue).to.be.equal(debtRemainingValue);
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('asset is removed from the assetIn list because all COMP was seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore & ~(1 << compInfo.offset));
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('bad debt handling clears alice borrow', async () => {
      newBalance = 0n;
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('AbsorbDebt writes off the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('comet total supplied COMP is reduced by the full collateral amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet COMP reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the full absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the full absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('2 collaterals: full delisted COMP first, normal WETH second', function () {
    const wethAmount = exp(0.04, 18); // 0.04 WETH, worth $80
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let debtRemainingValueAfterWethSeize: bigint;
    let wethCollateralValue: bigint;
    let totalCollateralizedValue: bigint;
    let wantedWethCollateralValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let compInfo: AssetInfoStructOutput;
    let wethInfo: AssetInfoStructOutput;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is liquidatable because WETH LCF-weighted value is below debt', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('calculates WETH collateralized value after full-delisted COMP is ignored', async () => {
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // wethCollateralValue = 0.04e18 * 2000e8 / 1e18 = 80e8
      wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      expect(totalCollateralizedValue).to.be.equal(exp(60, 8));
    });

    it('full-delisted COMP is fully seized with zero wanted value', async () => {
      collateralsState['COMP'].seizeAmount = collateralAmount;
      collateralsState['COMP'].seizedValue = 0n;
    });

    it('emits AbsorbCollateral event for COMP', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, 0
      );
    });

    it('calculates partial WETH seizure after COMP reduces no debt', async () => {
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // wantedWethCollateralValue = (1.05 * 70e8 - 60e8) / (1.05 * 0.90 - 0.75)
      wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());

      expect(wantedWethCollateralValue).to.be.lessThan(wethCollateralValue);

      collateralsState['WETH'].seizeAmount = divPrice(wantedWethCollateralValue, wethPrice, wethInfo.scale);
      collateralsState['WETH'].seizedValue = mulFactor(wantedWethCollateralValue, wethInfo.liquidationFactor);
    });

    it('AbsorbCollateral seizes only part of WETH second', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['WETH'].address, collateralsState['WETH'].seizeAmount, wantedWethCollateralValue
      );
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice still holds WETH collateral after partial seizure', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(
        wethAmount - collateralsState['WETH'].seizeAmount
      );
    });

    it('comet total supplied COMP is reduced by the full collateral amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet total supplied WETH is reduced by the seized amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['WETH'].totalsCollateralBefore.sub(collateralsState['WETH'].seizeAmount)
      );
    });

    it('comet COMP reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet WETH reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(
        collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount)
      );
    });

    it('assetIn list keeps only WETH because COMP was fully seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore & ~(1 << compInfo.offset));
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance is unchanged', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('alice remains a borrower after WETH reaches target health', async () => {
      debtRemainingValueAfterWethSeize = debtRemainingValue - collateralsState['WETH'].seizedValue;
      newBalance = -(debtRemainingValueAfterWethSeize * baseScale / baseTokenPrice);

      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(-newBalance);
    });

    it('alice borrow balance is above minDebt', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(await comet.baseBorrowMin());
    });

    it('alice has new principal', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(newPrincipal);
    });

    it('alice principal remains negative', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.lessThan(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the absorbed WETH value only', async () => {
      basePaidOut = newBalance - oldBalance;
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed WETH value only', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('2 collaterals: normal COMP first is fully seized, full delisted WETH second is also seized', function () {
    const droppedCompPrice = exp(20, 8); // 1 COMP is worth $20 after the price drop
    const wethAmount = exp(0.03, 18); // 0.03 WETH, worth $60 but fully delisted
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let compCollateralValue: bigint;
    let debtRemainingValueAfterCompSeize: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let compInfo: AssetInfoStructOutput;
    let wethInfo: AssetInfoStructOutput;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is liquidatable from normal COMP liquidation value only', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('calculates that normal COMP is fully seized first', () => {
      // compCollateralValue = 1e18 * 20e8 / 1e18 = 20e8
      compCollateralValue = mulPrice(collateralAmount, droppedCompPrice, compInfo.scale);
      collateralsState['COMP'].seizeAmount = collateralAmount;
      collateralsState['COMP'].seizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
      debtRemainingValueAfterCompSeize = debtRemainingValue - collateralsState['COMP'].seizedValue;

      expect(debtRemainingValueAfterCompSeize).to.be.greaterThan(0n);
    });

    it('AbsorbCollateral seizes all COMP first', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, compCollateralValue
      );
    });

    it('AbsorbCollateral seizes all full-delisted WETH with zero wanted value', async () => {
      collateralsState['WETH'].seizeAmount = wethAmount;
      collateralsState['WETH'].seizedValue = 0n;
    });

    it('emits AbsorbCollateral event for WETH', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['WETH'].address, collateralsState['WETH'].seizeAmount, 0
      );
    });

    it('full-delisted WETH does not reduce the remaining debt', () => {
      expect(debtRemainingValueAfterCompSeize - collateralsState['WETH'].seizedValue).to.be.equal(debtRemainingValueAfterCompSeize);
    });

    it('alice COMP and WETH collateral balances are zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(0);
    });

    it('assetIn list removes both seized collaterals', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(
        assetsInBefore & ~(1 << compInfo.offset) & ~(1 << wethInfo.offset)
      );
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('bad debt handling clears alice borrow', async () => {
      newBalance = 0n;
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('AbsorbDebt writes off the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('comet total supplied COMP is reduced by the full collateral amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet total supplied WETH is reduced by the full collateral amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['WETH'].totalsCollateralBefore.sub(collateralsState['WETH'].seizeAmount)
      );
    });

    it('comet COMP reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet WETH reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(
        collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount)
      );
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance is unchanged', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the full absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the full absorbed base amount', async () => {
      expect((await comet.getReserves())).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('2 collaterals: normal COMP partially covers debt, full delisted WETH is not touched', function () {
    const droppedCompPrice = exp(80, 8); // 1 COMP is worth $80 after the price drop
    const wethAmount = exp(0.03, 18); // WETH is fully delisted but should remain untouched
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let debtRemainingValueAfterCompSeize: bigint;
    let compCollateralValue: bigint;
    let totalCollateralizedValue: bigint;
    let wantedCompCollateralValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let compInfo: AssetInfoStructOutput;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is liquidatable from normal COMP liquidation value only', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('calculates normal COMP collateralized value', () => {
      // compCollateralValue = 1e18 * 80e8 / 1e18 = 80e8
      compCollateralValue = mulPrice(collateralAmount, droppedCompPrice, compInfo.scale);
      totalCollateralizedValue = mulFactor(compCollateralValue, compInfo.borrowCollateralFactor);

      expect(totalCollateralizedValue).to.be.equal(exp(64, 8));
    });

    it('calculates partial COMP seizure to reach target health', () => {
      wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());

      expect(wantedCompCollateralValue).to.be.lessThan(compCollateralValue);

      collateralsState['COMP'].seizeAmount = divPrice(wantedCompCollateralValue, droppedCompPrice, compInfo.scale);
      collateralsState['COMP'].seizedValue = mulFactor(wantedCompCollateralValue, compInfo.liquidationFactor);
      debtRemainingValueAfterCompSeize = debtRemainingValue - collateralsState['COMP'].seizedValue;
    });

    it('remaining debt is above minDebt', async () => {
      // we need this test to prevent accidently dropping into the minDebt branch
      expect(debtRemainingValueAfterCompSeize).to.be.greaterThan(mulPrice(await comet.baseBorrowMin(), baseTokenPrice, baseScale));
    });

    it('AbsorbCollateral seizes only part of COMP', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, wantedCompCollateralValue
      );
    });

    it('does not seize full-delisted WETH after COMP reaches target health', async () => {
      const absorbReceipt = await absorbTx.wait();
      const wethAbsorbCollateralEvents = absorbReceipt.events?.filter((event) =>
        event.event === 'AbsorbCollateral' && event.args?.asset === tokens['WETH'].address
      ) ?? [];

      expect(wethAbsorbCollateralEvents.length).to.be.equal(0);
    });

    it('alice WETH collateral balance is unchanged', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(wethAmount);
    });

    it('alice COMP collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(
        collateralAmount - collateralsState['COMP'].seizeAmount
      );
    });

    it('comet total supplied COMP is reduced by the seized amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet total supplied WETH is unchanged', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState['WETH'].totalsCollateralBefore);
    });

    it('comet COMP reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet WETH reserves are unchanged', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(collateralsState['WETH'].collateralReservesBefore);
    });

    it('assetIn list is unchanged because both collateral balances remain', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance is unchanged', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('alice remains a borrower after COMP reaches target health', async () => {
      newBalance = -(debtRemainingValueAfterCompSeize * baseScale / baseTokenPrice);

      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(-newBalance);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(0);
    });

    it('alice borrow balance is above minDebt', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(await comet.baseBorrowMin());
    });

    it('alice has new principal', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(newPrincipal);
    });

    it('alice principal remains negative', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.lessThan(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the absorbed COMP value only', async () => {
      basePaidOut = newBalance - oldBalance;
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed COMP value only', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('2 collaterals: both COMP and WETH are full delisted and both are absorbed', function () {
    const wethAmount = exp(0.03, 18);
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let compInfo: AssetInfoStructOutput;
    let wethInfo: AssetInfoStructOutput;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is liquidatable because both collaterals contribute no liquidation value', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('AbsorbCollateral seizes all COMP with zero wanted value', async () => {
      collateralsState['COMP'].seizeAmount = collateralAmount;
      collateralsState['COMP'].seizedValue = 0n;
    });

    it('emits AbsorbCollateral event for COMP', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, 0
      );
    });

    it('AbsorbCollateral seizes all WETH with zero wanted value', async () => {
      collateralsState['WETH'].seizeAmount = wethAmount;
      collateralsState['WETH'].seizedValue = 0n;
    });

    it('emits AbsorbCollateral event for WETH', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['WETH'].address, collateralsState['WETH'].seizeAmount, 0
      );
    });

    it('full-delisted collaterals do not reduce the remaining debt', () => {
      expect(debtRemainingValue - collateralsState['COMP'].seizedValue - collateralsState['WETH'].seizedValue)
        .to.be.equal(debtRemainingValue);
    });

    it('alice COMP and WETH collateral balances are zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(0);
    });

    it('assetIn list removes both seized collaterals', async () => {
      const newAssetsIn = await comet.userBasic(alice.address);
      expect(newAssetsIn.assetsIn).to.be.equal(assetsInBefore & ~(1 << compInfo.offset) & ~(1 << wethInfo.offset));
      expect(newAssetsIn.assetsIn).to.be.equal(0);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('bad debt handling clears alice borrow', async () => {
      newBalance = 0n;
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('AbsorbDebt writes off the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('comet total supplied COMP is reduced by the full collateral amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet total supplied WETH is reduced by the full collateral amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['WETH'].totalsCollateralBefore.sub(collateralsState['WETH'].seizeAmount)
      );
    });

    it('comet COMP reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet WETH reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(
        collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount)
      );
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance is unchanged', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the full absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the full absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('1 collateral: COMP has BCF, LCF, and LF set to zero', function () {
    const collateralKeys = ['COMP'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidationFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is liquidatable because LF-zero COMP contributes no liquidation value', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      // doesn't matter what the value is, need > 0
      expect(debtRemainingValue).to.be.greaterThan(0n);
    });

    it('does not emit AbsorbCollateral for LF-zero COMP', async () => {
      const absorbReceipt = await absorbTx.wait();
      const compAbsorbCollateralEvents = absorbReceipt.events?.filter((event) =>
        event.event === 'AbsorbCollateral' && event.args?.asset === tokens['COMP'].address
      ) ?? [];

      expect(compAbsorbCollateralEvents.length).to.be.equal(0);
    });

    it('alice COMP collateral balance is unchanged', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(collateralAmount);
    });

    it('comet total supplied COMP is unchanged', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState['COMP'].totalsCollateralBefore);
    });

    it('comet COMP reserves are unchanged', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore);
    });

    it('assetIn list is unchanged because COMP was skipped', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('bad debt handling clears alice borrow', async () => {
      newBalance = 0n;
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('AbsorbDebt writes off the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the full absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the full absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('2 collaterals: LF-zero COMP first, normal WETH second is partially seized', function () {
    const wethAmount = exp(0.04, 18); // 0.04 WETH, worth $80
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let debtRemainingValueAfterWethSeize: bigint;
    let wethCollateralValue: bigint;
    let totalCollateralizedValue: bigint;
    let wantedWethCollateralValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let wethInfo: AssetInfoStructOutput;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidationFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is liquidatable because normal WETH LCF-weighted value is below debt', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('does not emit AbsorbCollateral for LF-zero COMP', async () => {
      const absorbReceipt = await absorbTx.wait();
      const compAbsorbCollateralEvents = absorbReceipt.events?.filter((event) =>
        event.event === 'AbsorbCollateral' && event.args?.asset === tokens['COMP'].address
      ) ?? [];

      expect(compAbsorbCollateralEvents.length).to.be.equal(0);
    });

    it('calculates WETH collateralized value after LF-zero COMP is skipped', async () => {
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      // wethCollateralValue = 0.04e18 * 2000e8 / 1e18 = 80e8
      wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      totalCollateralizedValue = mulFactor(wethCollateralValue, wethInfo.borrowCollateralFactor);

      expect(totalCollateralizedValue).to.be.equal(exp(60, 8));
    });

    it('calculates partial WETH seizure to reach target health', async () => {
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      wantedWethCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(wethInfo.liquidationFactor, targetHealthFactor) - wethInfo.borrowCollateralFactor.toBigInt());

      expect(wantedWethCollateralValue).to.be.lessThan(wethCollateralValue);

      collateralsState['WETH'].seizeAmount = divPrice(wantedWethCollateralValue, wethPrice, wethInfo.scale);
      collateralsState['WETH'].seizedValue = mulFactor(wantedWethCollateralValue, wethInfo.liquidationFactor);
      debtRemainingValueAfterWethSeize = debtRemainingValue - collateralsState['WETH'].seizedValue;
    });

    it('remaining debt is above minDebt', async () => {
      // we need this test to prevent accidently dropping into the minDebt branch
      expect(debtRemainingValueAfterWethSeize).to.be.greaterThan(mulPrice(await comet.baseBorrowMin(), baseTokenPrice, baseScale));
    });

    it('AbsorbCollateral seizes only part of WETH', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['WETH'].address, collateralsState['WETH'].seizeAmount, wantedWethCollateralValue
      );
    });

    it('alice COMP collateral balance is unchanged', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(collateralAmount);
    });

    it('alice WETH collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(
        wethAmount - collateralsState['WETH'].seizeAmount
      );
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.greaterThan(0);
    });

    it('comet total supplied COMP is unchanged', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState['COMP'].totalsCollateralBefore);
    });

    it('comet total supplied WETH is reduced by the seized amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['WETH'].totalsCollateralBefore.sub(collateralsState['WETH'].seizeAmount)
      );
    });

    it('comet COMP reserves are unchanged', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore);
    });

    it('comet WETH reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(
        collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount)
      );
    });

    it('assetIn list is unchanged because both collateral balances remain', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance is unchanged', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('alice remains a borrower after WETH reaches target health', async () => {
      newBalance = -(debtRemainingValueAfterWethSeize * baseScale / baseTokenPrice);

      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(-newBalance);
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(0);
    });

    it('alice borrow balance is above minDebt', async () => {
      expect(await comet.borrowBalanceOf(alice.address)).to.be.greaterThan(await comet.baseBorrowMin());
    });

    it('alice has new principal', async () => {
      const totalsBasic = await comet.totalsBasic();
      const newPrincipal = principalValue(newBalance, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(newPrincipal);
    });

    it('alice principal remains negative', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.lessThan(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the absorbed WETH value only', async () => {
      basePaidOut = newBalance - oldBalance;
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the absorbed WETH value only', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('2 collaterals: normal COMP first is fully seized, LF-zero WETH second is untouched', function () {
    const droppedCompPrice = exp(20, 8); // 1 COMP is worth $20 after the price drop
    const wethAmount = exp(0.03, 18);
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let debtRemainingValueAfterCompSeize: bigint;
    let compCollateralValue: bigint;
    let totalCollateralizedValue: bigint;
    let wantedCompCollateralValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let compInfo: AssetInfoStructOutput;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await configurator.updateAssetLiquidationFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is liquidatable from normal COMP liquidation value only', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('calculates that normal COMP cannot reach target health', () => {
      // compCollateralValue = 1e18 * 20e8 / 1e18 = 20e8
      compCollateralValue = mulPrice(collateralAmount, droppedCompPrice, compInfo.scale);
      totalCollateralizedValue = mulFactor(compCollateralValue, compInfo.borrowCollateralFactor);
      wantedCompCollateralValue = (mulFactor(debtRemainingValue, targetHealthFactor) - totalCollateralizedValue) * factorScale
        / (mulFactor(compInfo.liquidationFactor, targetHealthFactor) - compInfo.borrowCollateralFactor.toBigInt());

      expect(wantedCompCollateralValue).to.be.greaterThan(compCollateralValue);
    });

    it('calculates full COMP seizure and residual debt', () => {
      collateralsState['COMP'].seizeAmount = collateralAmount;
      collateralsState['COMP'].seizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
      debtRemainingValueAfterCompSeize = debtRemainingValue - collateralsState['COMP'].seizedValue;

      expect(debtRemainingValueAfterCompSeize).to.be.greaterThan(0n);
    });

    it('AbsorbCollateral seizes all COMP', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, compCollateralValue
      );
    });

    it('does not emit AbsorbCollateral for LF-zero WETH', async () => {
      const absorbReceipt = await absorbTx.wait();
      const wethAbsorbCollateralEvents = absorbReceipt.events?.filter((event) =>
        event.event === 'AbsorbCollateral' && event.args?.asset === tokens['WETH'].address
      ) ?? [];

      expect(wethAbsorbCollateralEvents.length).to.be.equal(0);
    });

    it('alice COMP collateral balance is zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
    });

    it('alice WETH collateral balance is unchanged', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(wethAmount);
    });

    it('comet total supplied COMP is reduced by the full collateral amount', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(
        collateralsState['COMP'].totalsCollateralBefore.sub(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet total supplied WETH is unchanged', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState['WETH'].totalsCollateralBefore);
    });

    it('comet COMP reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet WETH reserves are unchanged', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(collateralsState['WETH'].collateralReservesBefore);
    });

    it('assetIn list keeps only WETH because COMP was fully seized', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore & ~(1 << compInfo.offset));
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance is unchanged', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('bad debt handling clears alice borrow', async () => {
      newBalance = 0n;
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('AbsorbDebt writes off the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the full absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the full absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('2 collaterals: both COMP and WETH have BCF, LCF, and LF set to zero', function () {
    const wethAmount = exp(0.03, 18);
    const collateralKeys = ['COMP', 'WETH'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetLiquidationFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await configurator.updateAssetLiquidationFactor(cometProxyAddress, tokens['WETH'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is liquidatable because both collaterals contribute no liquidation value', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      // matter only > 0
      expect(debtRemainingValue).to.be.greaterThan(0n);
    });

    it('does not emit AbsorbCollateral for either LF-zero collateral', async () => {
      const absorbReceipt = await absorbTx.wait();
      const absorbCollateralEvents = absorbReceipt.events?.filter((event) => event.event === 'AbsorbCollateral') ?? [];

      expect(absorbCollateralEvents.length).to.be.equal(0);
    });

    it('alice COMP and WETH collateral balances are unchanged', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(collateralAmount);
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(wethAmount);
    });

    it('comet total supplied COMP is unchanged', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['COMP'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState['COMP'].totalsCollateralBefore);
    });

    it('comet total supplied WETH is unchanged', async () => {
      const totalSupplyAssetAfter = (await comet.totalsCollateral(tokens['WETH'].address)).totalSupplyAsset;
      expect(totalSupplyAssetAfter).to.be.equal(collateralsState['WETH'].totalsCollateralBefore);
    });

    it('comet COMP reserves are unchanged', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(collateralsState['COMP'].collateralReservesBefore);
    });

    it('comet WETH reserves are unchanged', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(collateralsState['WETH'].collateralReservesBefore);
    });

    it('assetIn list is unchanged because both collaterals were skipped', async () => {
      expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('bad debt handling clears alice borrow', async () => {
      newBalance = 0n;
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('AbsorbDebt writes off the full borrow amount', async () => {
      basePaidOut = newBalance - oldBalance;
      const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

      await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
        absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
      );
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    it('comet ERC20 COMP token balance is unchanged', async () => {
      expect(await tokens['COMP'].balanceOf(comet.address)).to.be.equal(collateralsState['COMP'].tokenBalanceBefore);
    });

    it('comet ERC20 WETH token balance is unchanged', async () => {
      expect(await tokens['WETH'].balanceOf(comet.address)).to.be.equal(collateralsState['WETH'].tokenBalanceBefore);
    });

    it('alice base balance is zero', async () => {
      expect(await comet.balanceOf(alice.address)).to.be.equal(0);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the full absorbed base amount', async () => {
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the full absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('5 collaterals: BCF-zero, normal, LCF-zero, LF-zero, and BCF-zero assets', function () {
    const droppedCompPrice = exp(10, 8); // 1 COMP is worth $10 after the price drop
    const wethAmount = exp(0.001, 18); // 0.001 WETH, worth $2
    const usdtAmount = exp(10, 6); // 10 USDT, LCF zero but LF positive
    const wbtcAmount = exp(0.001, 8); // 0.001 WBTC, LF zero
    const daiAmount = exp(63, 18); // 63 DAI, BCF zero
    const collateralKeys = ['COMP', 'WETH', 'USDT', 'WBTC', 'DAI'];

    let collateralsState: Record<string, CollateralState>;
    let absorbTx: ContractTransaction;
    let oldBalance: bigint;
    let newBalance: bigint;
    let basePaidOut: bigint;
    let debtRemainingValue: bigint;
    let compCollateralValue: bigint;
    let wethCollateralValue: bigint;
    let daiCollateralValue: bigint;
    let debtRemainingValueAfterCompSeize: bigint;
    let debtRemainingValueAfterWethSeize: bigint;
    let wantedDaiCollateralValue: bigint;
    let totalSupplyBaseBefore: bigint;
    let totalBorrowBaseBefore: bigint;
    let baseReservesBefore: bigint;
    let cometBaseTokenBalanceBefore: bigint;
    let assetsInBefore: number;
    let reservedBefore: number;
    let compInfo: AssetInfoStructOutput;
    let wethInfo: AssetInfoStructOutput;
    let usdtInfo: AssetInfoStructOutput;
    let wbtcInfo: AssetInfoStructOutput;
    let daiInfo: AssetInfoStructOutput;

    before(async function() {
      await comet.connect(alice).supply(tokens['WETH'].address, wethAmount);
      await comet.connect(alice).supply(tokens['USDT'].address, usdtAmount);
      await comet.connect(alice).supply(tokens['WBTC'].address, wbtcAmount);
      await comet.connect(alice).supply(tokens['DAI'].address, daiAmount);

      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['USDT'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['USDT'].address, 0);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['WBTC'].address, 0);
      await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['WBTC'].address, 0);
      await configurator.updateAssetLiquidationFactor(cometProxyAddress, tokens['WBTC'].address, 0);
      await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['DAI'].address, 0);
      await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

      await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
      await comet.accrueAccount(alice.address);

      const userBasic = await comet.userBasic(alice.address);
      const totalsBasic = await comet.totalsBasic();
      oldBalance = presentValue(userBasic.principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      totalSupplyBaseBefore = totalsBasic.totalSupplyBase.toBigInt();
      totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
      baseReservesBefore = (await comet.getReserves()).toBigInt();
      cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
      collateralsState = await makeCollateralStates(comet, tokens, collateralKeys);
      assetsInBefore = userBasic.assetsIn;
      reservedBefore = userBasic._reserved;
      compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
      wethInfo = await comet.getAssetInfoByAddress(tokens['WETH'].address);
      usdtInfo = await comet.getAssetInfoByAddress(tokens['USDT'].address);
      wbtcInfo = await comet.getAssetInfoByAddress(tokens['WBTC'].address);
      daiInfo = await comet.getAssetInfoByAddress(tokens['DAI'].address);
    });

    after(async () => await snapshot.restore());

    it('sanity check: alice is liquidatable across the mixed collateral set', async () => {
      expect(await comet.isLiquidatable(alice.address)).to.equal(true);
    });

    it('absorb succeeds', async () => {
      absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
      await expect(absorbTx).to.not.be.reverted;
    });

    it('calculates debt remaining value before absorb', () => {
      debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
      expect(debtRemainingValue).to.be.equal(exp(70, 8));
    });

    it('AbsorbCollateral seizes all first BCF-zero COMP', async () => {
      compCollateralValue = mulPrice(collateralAmount, droppedCompPrice, compInfo.scale);
      collateralsState['COMP'].seizeAmount = collateralAmount;
      collateralsState['COMP'].seizedValue = mulFactor(compCollateralValue, compInfo.liquidationFactor);
      debtRemainingValueAfterCompSeize = debtRemainingValue - collateralsState['COMP'].seizedValue;
    });

    it('emit AbsorbCollateral event for COMP', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['COMP'].address, collateralsState['COMP'].seizeAmount, compCollateralValue
      );
    });

    it('AbsorbCollateral seizes all second normal WETH', async () => {
      const wethPrice = (await priceFeeds['WETH'].latestRoundData())[1].toBigInt();

      wethCollateralValue = mulPrice(wethAmount, wethPrice, wethInfo.scale);
      collateralsState['WETH'].seizeAmount = wethAmount;
      collateralsState['WETH'].seizedValue = mulFactor(wethCollateralValue, wethInfo.liquidationFactor);
      debtRemainingValueAfterWethSeize = debtRemainingValueAfterCompSeize - collateralsState['WETH'].seizedValue;
    });

    it('emit AbsorbCollateral event for WETH', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['WETH'].address, collateralsState['WETH'].seizeAmount, wethCollateralValue
      );
    });

    it('AbsorbCollateral seizes all third LCF-zero USDT with zero wanted value', async () => {
      collateralsState['USDT'].seizeAmount = usdtAmount;
      collateralsState['USDT'].seizedValue = 0n;
    });

    it('emit AbsorbCollateral event for USDT', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['USDT'].address, collateralsState['USDT'].seizeAmount, 0
      );
    });

    it('USDT seizure does not decrease the remaining debt', () => {
      expect(debtRemainingValueAfterWethSeize - collateralsState['USDT'].seizedValue).to.be.equal(debtRemainingValueAfterWethSeize);
    });

    it('does not emit AbsorbCollateral for fourth LF-zero WBTC', async () => {
      const absorbReceipt = await absorbTx.wait();
      const wbtcAbsorbCollateralEvents = absorbReceipt.events?.filter((event) =>
        event.event === 'AbsorbCollateral' && event.args?.asset === tokens['WBTC'].address
      ) ?? [];

      expect(wbtcAbsorbCollateralEvents.length).to.be.equal(0);
    });

    it('remaining debt is above minDebt', async () => {
      // we need this test to prevent accidentally dropping into the minDebt branch
      expect(debtRemainingValueAfterWethSeize).to.be.greaterThan(mulPrice(await comet.baseBorrowMin(), baseTokenPrice, baseScale));
    });

    it('calculates DAI value needed to close the remaining debt', async () => {
      const daiPrice = (await priceFeeds['DAI'].latestRoundData())[1].toBigInt();

      daiCollateralValue = mulPrice(daiAmount, daiPrice, daiInfo.scale);
      wantedDaiCollateralValue = debtRemainingValueAfterWethSeize * factorScale / daiInfo.liquidationFactor.toBigInt();

      expect(wantedDaiCollateralValue).to.be.lessThan(daiCollateralValue);

      collateralsState['DAI'].seizeAmount = divPrice(wantedDaiCollateralValue, daiPrice, daiInfo.scale);
      collateralsState['DAI'].seizedValue = debtRemainingValueAfterWethSeize;
    });

    it('AbsorbCollateral partially seizes fifth BCF-zero DAI', async () => {
      await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
        absorber.address, alice.address, tokens['DAI'].address, collateralsState['DAI'].seizeAmount, wantedDaiCollateralValue
      );
    });

    it('alice COMP, WETH, and USDT collateral balances are zero', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['COMP'].address)).to.be.equal(0);
      expect(await comet.collateralBalanceOf(alice.address, tokens['WETH'].address)).to.be.equal(0);
      expect(await comet.collateralBalanceOf(alice.address, tokens['USDT'].address)).to.be.equal(0);
    });

    it('alice WBTC collateral balance is unchanged', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['WBTC'].address)).to.be.equal(wbtcAmount);
    });

    it('alice DAI collateral balance is reduced by the seized amount', async () => {
      expect(await comet.collateralBalanceOf(alice.address, tokens['DAI'].address)).to.be.equal(
        daiAmount - collateralsState['DAI'].seizeAmount
      );
    });

    it('assetIn list keeps WBTC and DAI after absorb', async () => {
      const assetsInAfter = (await comet.userBasic(alice.address)).assetsIn;

      expect(assetsInAfter).to.be.equal(
        assetsInBefore
          & ~(1 << compInfo.offset)
          & ~(1 << wethInfo.offset)
          & ~(1 << usdtInfo.offset)
      );
      expect(assetsInAfter).to.be.equal((1 << wbtcInfo.offset) | (1 << daiInfo.offset));
    });

    it('alice reserved bits are unchanged', async () => {
      expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
    });

    it('comet COMP reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['COMP'].address)).to.be.equal(
        collateralsState['COMP'].collateralReservesBefore.add(collateralsState['COMP'].seizeAmount)
      );
    });

    it('comet WETH reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['WETH'].address)).to.be.equal(
        collateralsState['WETH'].collateralReservesBefore.add(collateralsState['WETH'].seizeAmount)
      );
    });

    it('comet USDT reserves increase by the full collateral amount', async () => {
      expect(await comet.getCollateralReserves(tokens['USDT'].address)).to.be.equal(
        collateralsState['USDT'].collateralReservesBefore.add(collateralsState['USDT'].seizeAmount)
      );
    });

    it('comet WBTC reserves are unchanged', async () => {
      expect(await comet.getCollateralReserves(tokens['WBTC'].address)).to.be.equal(collateralsState['WBTC'].collateralReservesBefore);
    });

    it('comet DAI reserves increase by the seized amount', async () => {
      expect(await comet.getCollateralReserves(tokens['DAI'].address)).to.be.equal(
        collateralsState['DAI'].collateralReservesBefore.add(collateralsState['DAI'].seizeAmount)
      );
    });

    it('comet ERC20 base token balance is unchanged', async () => {
      expect(await baseToken.balanceOf(comet.address)).to.be.equal(cometBaseTokenBalanceBefore);
    });

    for (const collateralKey of collateralKeys) {
      it(`comet ERC20 ${collateralKey} token balance is unchanged`, async () => {
        expect(await tokens[collateralKey].balanceOf(comet.address)).to.be.equal(collateralsState[collateralKey].tokenBalanceBefore);
      });
    }

    it('alice borrow balance is zero', async () => {
      newBalance = 0n;
      expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(newBalance);
    });

    it('alice principal is zero', async () => {
      expect((await comet.userBasic(alice.address)).principal).to.be.equal(0);
    });

    it('comet total supply base is unchanged', async () => {
      expect((await comet.totalsBasic()).totalSupplyBase).to.be.equal(totalSupplyBaseBefore);
    });

    it('comet total borrow base is reduced by the full absorbed base amount', async () => {
      basePaidOut = newBalance - oldBalance;
      expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(totalBorrowBaseBefore - basePaidOut);
    });

    it('comet base reserves are reduced by the full absorbed base amount', async () => {
      expect((await comet.getReserves()).toBigInt()).to.be.equal(baseReservesBefore - basePaidOut);
    });
  });

  context('revert cases', function () {
    context('1 soft delisted collateral: BCF = 0 and collateral is deactivated', function () {
      const droppedCompPrice = exp(80, 8); // 1 COMP is worth $80 after the price drop

      before(async function() {
        await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
        await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);
    
        await priceFeeds['COMP'].connect(alice).setRoundData(0, droppedCompPrice, 0, 0, 0);
        await comet.accrueAccount(alice.address);
    
        const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
        await comet.connect(pauseGuardian).deactivateCollateral(compInfo.offset);
      });
    
      after(async () => await snapshot.restore());
    
      it('sanity check: alice is liquidatable because deactivation is ignored by the liquidation path', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.equal(true);
      });
    
      it('borrow collateralization check reverts before the BCF-zero skip', async () => {
        await expect(comet.isBorrowCollateralized(alice.address))
          .to.be.revertedWithCustomError(comet, 'TokenIsDeactivated')
          .withArgs(tokens['COMP'].address);
      });
    
      it('absorb reverts', async () => {
        await expect(comet.connect(absorber).absorb(absorber.address, [alice.address]))
          .to.be.revertedWithCustomError(comet, 'TokenIsDeactivated')
          .withArgs(tokens['COMP'].address);
      });
    });

    context('1 soft delisted collateral: BCF = 0, LCF = 0, LF > 0 and collateral is deactivated', function () {
      before(async function() {
        await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
        await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
        await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

        const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
        await comet.connect(pauseGuardian).deactivateCollateral(compInfo.offset);
      });

      after(async () => await snapshot.restore());

      it('sanity check: alice is liquidatable because LCF zero skips deactivated COMP in the liquidation path', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.equal(true);
      });

      it('borrow collateralization check reverts before the BCF-zero skip', async () => {
        await expect(comet.isBorrowCollateralized(alice.address))
          .to.be.revertedWithCustomError(comet, 'TokenIsDeactivated')
          .withArgs(tokens['COMP'].address);
      });

      it('absorb reverts', async () => {
        await expect(comet.connect(absorber).absorb(absorber.address, [alice.address]))
          .to.be.revertedWithCustomError(comet, 'TokenIsDeactivated')
          .withArgs(tokens['COMP'].address);
      });
    });

    context('1 soft delisted collateral: BCF = 0, LCF = 0, LF = 0 and collateral is deactivated', function () {
      before(async function() {
        await configurator.updateAssetBorrowCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
        await configurator.updateAssetLiquidateCollateralFactor(cometProxyAddress, tokens['COMP'].address, 0);
        await configurator.updateAssetLiquidationFactor(cometProxyAddress, tokens['COMP'].address, 0);
        await cometProxyAdmin.deployAndUpgradeTo(configuratorProxyAddress, cometProxyAddress);

        const compInfo = await comet.getAssetInfoByAddress(tokens['COMP'].address);
        await comet.connect(pauseGuardian).deactivateCollateral(compInfo.offset);
      });

      after(async () => await snapshot.restore());

      it('sanity check: alice is liquidatable because LCF zero skips deactivated COMP in the liquidation path', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.equal(true);
      });

      it('borrow collateralization check reverts before the BCF-zero skip', async () => {
        await expect(comet.isBorrowCollateralized(alice.address))
          .to.be.revertedWithCustomError(comet, 'TokenIsDeactivated')
          .withArgs(tokens['COMP'].address);
      });

      it('absorb reverts', async () => {
        await expect(comet.connect(absorber).absorb(absorber.address, [alice.address]))
          .to.be.revertedWithCustomError(comet, 'TokenIsDeactivated')
          .withArgs(tokens['COMP'].address);
      });
    });
  });
});