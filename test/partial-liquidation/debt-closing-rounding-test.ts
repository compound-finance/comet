import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, default24Assets, divPrice } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

type RoundingScenario = {
  name: string;
  symbol: string;
  decimals: number;
  collateralAmount: bigint;
  borrowAmount: bigint;
  repayAmount: bigint;
  droppedPrice: bigint;
};

describe('partial liquidation: debt closing rounding', function() {
  const baseTokenPrice = exp(1, 8);
  const initialBaseFunding = baseTokenPrice * 10_000n;
  const baseBorrowMin = exp(10, 6); // $10
  const baseScale = 10n ** 6n;
  const factorScale = 10n ** 18n;

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

  function formatUsd(value: bigint): string {
    const whole = value / baseTokenPrice;
    const fractional = (value % baseTokenPrice).toString().padStart(8, '0');
    return `$${whole}.${fractional}`;
  }

  function debtClosingRoundingContext(config: RoundingScenario) {
    context(config.name, function() {
      let collateralAsset: FaucetToken;
      let absorbTx: ContractTransaction;
      let oldBalance: bigint;
      let debtRemainingValue: bigint;
      let minDebtValue: bigint;
      let collateralValue: bigint;
      let collateralValueLeft: bigint;
      let targetGrossCollateralValue: bigint;
      let seizedAmount: bigint;
      let wantedCollateralValue: bigint;
      let actualCoveredValue: bigint;
      let protocolLossValue: bigint;
      let protocolLossBaseUnits: bigint;
      let userBenefitValue: bigint;
      let roundingGrossLossValue: bigint;
      let basePaidOut: bigint;
      let totalBorrowBaseBefore: bigint;
      let baseReservesBefore: bigint;
      let totalsCollateralBefore: bigint;
      let collateralReservesBefore: bigint;
      let cometCollateralTokenBalanceBefore: bigint;
      let cometBaseTokenBalanceBefore: bigint;
      let assetsInBefore: number;
      let reservedBefore: number;

      before(async function() {
        collateralAsset = tokens[config.symbol];

        await comet.connect(alice).supply(collateralAsset.address, config.collateralAmount);
        await comet.connect(alice).withdraw(baseToken.address, config.borrowAmount);
        await comet.connect(alice).supply(baseToken.address, config.repayAmount);
        await priceFeeds[config.symbol].connect(alice).setRoundData(0, config.droppedPrice, 0, 0, 0);
        await comet.accrueAccount(alice.address);

        const principal = (await comet.userBasic(alice.address)).principal;
        const totalsBasic = await comet.totalsBasic();
        oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
        totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
        baseReservesBefore = (await comet.getReserves()).toBigInt();
        totalsCollateralBefore = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset.toBigInt();
        collateralReservesBefore = (await comet.getCollateralReserves(collateralAsset.address)).toBigInt();
        cometCollateralTokenBalanceBefore = (await collateralAsset.balanceOf(comet.address)).toBigInt();
        cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
        const userBasic = await comet.userBasic(alice.address);
        assetsInBefore = userBasic.assetsIn;
        reservedBefore = userBasic._reserved;
      });

      after(async () => await snapshot.restore());

      it('sanity check: user is liquidatable', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.be.true;
      });

      it('enters the min debt partial-close branch', async () => {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);

        debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
        minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);
        collateralValue = mulPrice(config.collateralAmount, config.droppedPrice, assetInfo.scale);
        collateralValueLeft = mulFactor(collateralValue, assetInfo.liquidationFactor);

        // sanity check that the asset is the correct one
        expect(assetInfo.scale).to.be.equal(10n ** BigInt(config.decimals));
      });

      it('remaining debt value is less than min debt value', async () => {
        expect(debtRemainingValue).to.be.lessThan(minDebtValue);
      });

      it('remaining debt value is less than collateral value left', async () => {
        expect(debtRemainingValue).to.be.lessThan(collateralValueLeft);
      });

      it('computes rounded seizure values for debt-closing path', async () => {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);

        // This mirrors _processDebtClosing:
        // seizedAmount = divPrice(floor(debt / LF), price, scale)
        // wantedCollateralValue = mulPrice(seizedAmount, price, scale)
        // Step 1: convert debt into a "gross collateral value" before liquidation discount.
        // This is debt / LF, using integer division (rounding down).
        targetGrossCollateralValue = debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt();

        // Step 2: convert that gross value into token units; divPrice rounds down to token precision.
        // This is where tiny value can be lost due to collateral decimals.
        seizedAmount = divPrice(targetGrossCollateralValue, config.droppedPrice, assetInfo.scale);

        // Step 3: reprice rounded token units back to value.
        wantedCollateralValue = mulPrice(seizedAmount, config.droppedPrice, assetInfo.scale);

        // Step 4: apply liquidation factor to get the debt value this seizure actually covers.
        actualCoveredValue = mulFactor(wantedCollateralValue, assetInfo.liquidationFactor);

        // Step 5: protocol closes full debt, but seized collateral may cover slightly less.
        // The difference is protocol-side loss (and user-side debt forgiveness benefit).
        protocolLossValue = debtRemainingValue - actualCoveredValue;

        // Step 6: same loss expressed in base token units (USDC 6 decimals), rounded down.
        protocolLossBaseUnits = protocolLossValue * baseScale / baseTokenPrice;
        userBenefitValue = protocolLossValue;

        // Extra visibility: pure value rounding from gross target value to repriced rounded value.
        roundingGrossLossValue = targetGrossCollateralValue - wantedCollateralValue;
      });

      it('actual collateral coverage is smaller than debt that gets closed', async () => {
        expect(actualCoveredValue).to.be.lessThan(debtRemainingValue);
      });

      it('protocol loss in USD value is positive', async () => {
        expect(protocolLossValue).to.be.greaterThan(0n);
      });

      it('protocol loss in base token units is non-negative', async () => {
        expect(protocolLossBaseUnits).to.be.greaterThanOrEqual(0n);
      });

      it('when base-unit loss rounds to zero, USD loss is below one base unit', async () => {
        const oneBaseUnitValue = baseTokenPrice / baseScale;
        if (protocolLossBaseUnits === 0n) {
          expect(protocolLossValue).to.be.lessThan(oneBaseUnitValue);
        } else {
          expect(protocolLossValue).to.be.greaterThanOrEqual(oneBaseUnitValue);
        }
      });

      it('user benefit from debt forgiveness equals protocol loss value', async () => {
        expect(userBenefitValue).to.be.equal(protocolLossValue);
      });

      it('debt closed value equals covered collateral value plus protocol loss', async () => {
        expect(debtRemainingValue).to.be.equal(actualCoveredValue + protocolLossValue);
      });

      it('user debt forgiveness equals the part not covered by seized collateral', async () => {
        expect(userBenefitValue).to.be.equal(debtRemainingValue - actualCoveredValue);
      });

      it('logs rounding impact in USD, units, and loss side', async () => {
        const oneBaseUnitValue = BigInt(baseTokenPrice.toString()) / BigInt(baseScale.toString());
        console.log(
          `\n[ROUNDING CASE] ${config.symbol} (${config.decimals} decimals)\n` +
          `  debt closed (USD):                ${formatUsd(debtRemainingValue)}\n` +
          `  collateral actually covered (USD): ${formatUsd(actualCoveredValue)}\n` +
          `  gross collateral rounding loss:    ${formatUsd(roundingGrossLossValue)}\n` +
          `  protocol loss (USD):              ${formatUsd(protocolLossValue)}\n` +
          `  protocol loss (base units):       ${protocolLossBaseUnits} (USDC)\n` +
          `  user benefit (USD):               ${formatUsd(userBenefitValue)}\n` +
          `  loss side:                        protocol (user receives extra debt forgiveness)`
        );

        if (protocolLossBaseUnits === 0n) {
          console.log(
            `  note: protocol loss in base units rounds down to 0 because ` +
            `${formatUsd(protocolLossValue)} < one base unit ${formatUsd(oneBaseUnitValue)}`
          );
        }
      });

      it('absorb is successful', async () => {
        absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
        await expect(absorbTx).to.not.be.reverted;
      });

      it('AbsorbCollateral reports the rounded seized collateral value', async () => {
        await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
          absorber.address,
          alice.address,
          collateralAsset.address,
          seizedAmount,
          wantedCollateralValue
        );
      });

      it('AbsorbDebt closes the whole debt even though actual collateral coverage is smaller', async () => {
        basePaidOut = -oldBalance;
        const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

        expect(valueOfBasePaidOut).to.be.equal(debtRemainingValue);
        expect(actualCoveredValue).to.be.lessThan(valueOfBasePaidOut);
        expect(valueOfBasePaidOut - actualCoveredValue).to.be.equal(protocolLossValue);
        await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
      });

      it('alice borrow is fully closed', async () => {
        expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
      });

      it('alice collateral balance is reduced by the seized amount', async () => {
        const collateralBalanceAfter = await comet.collateralBalanceOf(alice.address, collateralAsset.address);
        expect(collateralBalanceAfter).to.be.equal(config.collateralAmount - seizedAmount);
      });

      it('alice assetsIn does not change after partial seizure', async () => {
        expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore);
      });

      it('alice reserved bits do not change', async () => {
        expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
      });

      it('comet total supplied collateral is reduced by seized amount', async () => {
        const totalSupplyAssetAfter = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset.toBigInt();
        expect(totalSupplyAssetAfter).to.be.equal(totalsCollateralBefore - seizedAmount);
      });

      it('comet collateral reserves increase by seized amount', async () => {
        const collateralReservesAfter = (await comet.getCollateralReserves(collateralAsset.address)).toBigInt();
        expect(collateralReservesAfter).to.be.equal(collateralReservesBefore + seizedAmount);
      });

      it('comet total borrow base is reduced by absorbed base amount', async () => {
        const totalBorrowBaseAfter = (await comet.totalsBasic()).totalBorrowBase.toBigInt();
        expect(totalBorrowBaseAfter).to.be.equal(totalBorrowBaseBefore - basePaidOut);
      });

      it('comet total borrow base is zero after absorb', async () => {
        expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(0);
      });

      it('comet base reserves are reduced by full base paid out (including protocol loss)', async () => {
        const baseReservesAfter = (await comet.getReserves()).toBigInt();
        expect(baseReservesAfter).to.be.equal(baseReservesBefore - basePaidOut);
      });

      it('storage proof: collateral reserve delta covers less value than closed debt by protocol loss', async () => {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
        const collateralReservesAfter = (await comet.getCollateralReserves(collateralAsset.address)).toBigInt();
        const collateralReservesDelta = collateralReservesAfter - collateralReservesBefore;
        const coveredFromReservesDelta = mulFactor(
          mulPrice(collateralReservesDelta, config.droppedPrice, assetInfo.scale),
          assetInfo.liquidationFactor
        );

        expect(collateralReservesDelta).to.be.equal(seizedAmount);
        expect(coveredFromReservesDelta).to.be.equal(actualCoveredValue);
        expect(debtRemainingValue - coveredFromReservesDelta).to.be.equal(protocolLossValue);
      });

      it('rounding proof: shortfall is caused by collateral storage-unit granularity', async () => {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);
        const oneUnitCoveredValue = mulFactor(
          mulPrice(1n, config.droppedPrice, assetInfo.scale),
          assetInfo.liquidationFactor
        );

        // The shortfall exists because seizedAmount is rounded down to storage precision.
        if (oneUnitCoveredValue === 0n) {
          // For very fine-scale collateral, one raw unit can be worth < 1 price-wei after LF,
          // so value math cannot represent its contribution.
          expect(protocolLossValue).to.be.greaterThan(0n);
        } else {
          expect(protocolLossValue).to.be.lessThan(oneUnitCoveredValue);
          expect(actualCoveredValue + oneUnitCoveredValue).to.be.greaterThanOrEqual(debtRemainingValue);
        }
      });

      it('comet ERC20 collateral token balance is unchanged during absorb', async () => {
        expect((await collateralAsset.balanceOf(comet.address)).toBigInt()).to.be.equal(cometCollateralTokenBalanceBefore);
      });

      it('comet ERC20 base token balance is unchanged during absorb', async () => {
        expect((await baseToken.balanceOf(comet.address)).toBigInt()).to.be.equal(cometBaseTokenBalanceBefore);
      });
    });
  }

  debtClosingRoundingContext({
    name: '18 decimals collateral: rounded partial seizure closes more debt than it covers',
    symbol: 'COMP',
    decimals: 18,
    collateralAmount: exp(0.13, 18), // $13 before price drop
    borrowAmount: exp(10.2, 6),
    repayAmount: exp(0.7, 6), // leaves $9.50 debt
    droppedPrice: exp(85.9, 8), // about 14.1% price drop
  });

  debtClosingRoundingContext({
    name: '8 decimals collateral: rounded partial seizure closes more debt than it covers',
    symbol: 'WBTC',
    decimals: 8,
    collateralAmount: exp(0.00023, 8), // $14.95 before price drop
    borrowAmount: exp(10.2, 6),
    repayAmount: exp(0.7, 6), // leaves $9.50 debt
    droppedPrice: exp(52_000, 8), // 20% price drop
  });

  debtClosingRoundingContext({
    name: '6 decimals collateral: rounded partial seizure closes more debt than it covers',
    symbol: 'USDT',
    decimals: 6,
    collateralAmount: exp(12.3, 6), // $12.30 before price drop
    borrowAmount: exp(10.2, 6),
    repayAmount: exp(0.7, 6), // leaves $9.50 debt
    droppedPrice: exp(0.85, 8), // 15% price drop
  });
});
