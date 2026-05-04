import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, default24Assets } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

type FullSeizureRoundingScenario = {
  name: string;
  symbol: string;
  decimals: number;
  collateralAmount: bigint;
  initialPrice: bigint;
  droppedPrice: bigint;
  borrowAmount: bigint;
  repayAmount: bigint;
  debtBelowMin?: boolean;
};

describe('partial liquidation: full seizure from debt closing rounding', function() {
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

  function formatUsd(value: bigint): string {
    const whole = value / baseTokenPrice;
    const fractional = (value % baseTokenPrice).toString().padStart(8, '0');
    return `$${whole}.${fractional}`;
  }

  function formatFraction(numerator: bigint, denominator: bigint, precision = 24): string {
    const whole = numerator / denominator;
    const fractional = numerator % denominator * 10n ** BigInt(precision) / denominator;

    return `${whole}.${fractional.toString().padStart(precision, '0')}`;
  }

  function fullSeizureRoundingContext(config: FullSeizureRoundingScenario) {
    context(config.name, function() {
      let collateralAsset: FaucetToken;
      let absorbTx: ContractTransaction;
      let oldBalance: bigint;
      let debtRemainingValue: bigint;
      let minDebtValue: bigint;
      let collateralValue: bigint;
      let collateralValueLeft: bigint;
      let exactCoverageNumerator: bigint;
      let exactCoverageDenominator: bigint;
      let roundedResidualValue: bigint;
      let basePaidOut: bigint;

      before(async function() {
        collateralAsset = tokens[config.symbol];

        await priceFeeds[config.symbol].connect(alice).setRoundData(0, config.initialPrice, 0, 0, 0);
        await comet.connect(alice).supply(collateralAsset.address, config.collateralAmount);
        await comet.connect(alice).withdraw(baseToken.address, config.borrowAmount);
        await comet.connect(alice).supply(baseToken.address, config.repayAmount);
        await priceFeeds[config.symbol].connect(alice).setRoundData(0, config.droppedPrice, 0, 0, 0);
        await comet.accrueAccount(alice.address);

        const principal = (await comet.userBasic(alice.address)).principal;
        const totalsBasic = await comet.totalsBasic();
        oldBalance = presentValue(principal, totalsBasic.baseSupplyIndex, totalsBasic.baseBorrowIndex);
      });

      after(async () => await snapshot.restore());

      it('sanity check: user is liquidatable', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.be.true;
      });

      it('exact math can cover the debt but rounded contract math cannot', async () => {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);

        debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
        minDebtValue = mulPrice(baseBorrowMin, baseTokenPrice, baseScale);
        collateralValue = mulPrice(config.collateralAmount, config.droppedPrice, assetInfo.scale);
        collateralValueLeft = mulFactor(collateralValue, assetInfo.liquidationFactor);
        exactCoverageNumerator = config.collateralAmount * config.droppedPrice * assetInfo.liquidationFactor.toBigInt();
        exactCoverageDenominator = assetInfo.scale.toBigInt() * factorScale;
        roundedResidualValue = debtRemainingValue - collateralValueLeft;
        const exactCoverageSurplusNumerator = exactCoverageNumerator - debtRemainingValue * exactCoverageDenominator;
        const surplusCollateralUnitsDenominator = config.droppedPrice * assetInfo.liquidationFactor.toBigInt();
        const surplusCollateralUnits = formatFraction(exactCoverageSurplusNumerator, surplusCollateralUnitsDenominator);
        const surplusCollateralTokens = formatFraction(
          exactCoverageSurplusNumerator,
          surplusCollateralUnitsDenominator * assetInfo.scale.toBigInt()
        );
        const exactSurplusUsd = formatFraction(exactCoverageSurplusNumerator, exactCoverageDenominator * baseTokenPrice);

        expect(assetInfo.scale).to.be.equal(10n ** BigInt(config.decimals));
        if (config.debtBelowMin === false) {
          expect(debtRemainingValue).to.be.greaterThan(minDebtValue);
        } else {
          expect(debtRemainingValue).to.be.lessThan(minDebtValue);
        }
        expect(exactCoverageNumerator).to.be.greaterThan(debtRemainingValue * exactCoverageDenominator);
        expect(collateralValueLeft).to.be.lessThanOrEqual(debtRemainingValue);

        console.log(
          `[${config.symbol} ${config.decimals} decimals] exact collateral can cover ${formatUsd(debtRemainingValue)}, ` +
          `but rounded contract coverage is ${formatUsd(collateralValueLeft)}; ` +
          `rounded residual: ${formatUsd(roundedResidualValue)} (${roundedResidualValue} price wei); ` +
          `exact surplus: $${exactSurplusUsd}; ` +
          `surplus collateral: ${surplusCollateralTokens} ${config.symbol} (${surplusCollateralUnits} raw units)`
        );
      });

      it('absorb is successful', async () => {
        absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
        await expect(absorbTx).to.not.be.reverted;
      });

      it('AbsorbCollateral shows full collateral seizure', async () => {
        await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
          absorber.address,
          alice.address,
          collateralAsset.address,
          config.collateralAmount,
          collateralValue
        );
      });

      it('alice collateral balance is zero after absorb', async () => {
        expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(0);
      });

      it('AbsorbDebt closes the account debt', async () => {
        basePaidOut = -oldBalance;
        const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);

        await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
        expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
      });
    });
  }

  fullSeizureRoundingContext({
    name: '18 decimals collateral: exact coverage is enough but rounded contract coverage causes full seizure',
    symbol: 'COMP',
    decimals: 18,
    collateralAmount: 122881904022765490n,
    initialPrice: exp(105, 8),
    droppedPrice: exp(85.9, 8),
    borrowAmount: exp(10.2, 6),
    repayAmount: exp(0.7, 6), // leaves $9.50 debt
  });

  fullSeizureRoundingContext({
    name: '8 decimals collateral: exact coverage is enough but rounded contract coverage causes full seizure',
    symbol: 'WBTC',
    decimals: 8,
    collateralAmount: 21953n,
    initialPrice: exp(70_000, 8),
    droppedPrice: 5000000506145n, // $50,000.00506145
    borrowAmount: exp(10.2, 6),
    repayAmount: 321149n, // leaves $9.878851 debt
  });

  fullSeizureRoundingContext({
    name: '6 decimals collateral: exact coverage is enough but rounded contract coverage causes full seizure',
    symbol: 'USDT',
    decimals: 6,
    collateralAmount: 11844266n,
    initialPrice: exp(1.03, 8),
    droppedPrice: 80000123n, // $0.80000123
    borrowAmount: exp(10.2, 6),
    repayAmount: 1198344n, // leaves $9.001656 debt
  });

  fullSeizureRoundingContext({
    name: 'large notional collateral: exact coverage is enough but rounded contract coverage causes full seizure',
    symbol: 'COMP',
    decimals: 18,
    collateralAmount: 11641443538998835855647n, // ~11,641 COMP
    initialPrice: exp(105, 8),
    droppedPrice: exp(85.9, 8),
    borrowAmount: exp(900000.2, 6),
    repayAmount: exp(0.2, 6), // leaves $900,000 debt
    debtBelowMin: false,
  });
});
