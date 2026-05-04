import { ethers, expect, exp, makeProtocol, presentValue, mulPrice, mulFactor, default24Assets } from '../helpers';
import { CometHarnessInterfaceExtendedAssetList, FaucetToken, SimplePriceFeed } from 'build/types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { ContractTransaction } from 'ethers';
import { SnapshotRestorer, takeSnapshot } from '../helpers/snapshot';

// These tests document a rounding loss that occurs when Solidity integer truncation makes
// floor(LF × collateralValue) ≤ debtRemainingValue, even though the exact rational value
// LF × collateralValue > debtRemainingValue.  The contract sees the truncated value and falls
// into the full-seizure path, forgiving a small residual debt with no collateral backing.
// Loss bearer: the protocol.

type FullSeizureRoundingScenario = {
  name: string;
  symbol: string;
  decimals: number;
  collateralAmount: bigint;
  initialPrice: bigint;
  droppedPrice: bigint;
  borrowAmount: bigint;
  repayAmount: bigint;
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

  // Formats a price-unit value (1e8 per dollar) as "$whole.fractional"
  function formatUsd(value: bigint): string {
    const whole = value / baseTokenPrice;
    const fractional = (value % baseTokenPrice).toString().padStart(8, '0');
    return `$${whole}.${fractional}`;
  }

  // Formats an exact rational as a decimal string with `precision` digits after the point
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
      let basePaidOut: bigint;

      // rounded integer values — what the contract actually computes
      let debtRemainingValue: bigint;   // in price units (1e8 per dollar)
      let collateralValue: bigint;      // collateralAmount × price / scale
      let collateralValueLeft: bigint;  // floor(LF × collateralValue) — the truncated coverage

      // exact rational values — what math says should happen
      // exact LF coverage = exactCoverageNumerator / exactCoverageDenominator
      let exactCoverageNumerator: bigint;
      let exactCoverageDenominator: bigint;

      // protocolLoss = debtRemainingValue − collateralValueLeft
      // = the residual debt forgiven by the protocol with no collateral backing
      let protocolLoss: bigint;

      // for logging: exact surplus of LF coverage over debt
      let exactSurplusNumerator: bigint;
      let surplusUnitsDenominator: bigint;

      // storage snapshots
      let totalBorrowBaseBefore: bigint;
      let totalSupplyCollateralBefore: bigint;
      let collateralReservesBefore: bigint;
      let cometCollateralTokenBalanceBefore: bigint;
      let cometBaseTokenBalanceBefore: bigint;
      let assetsInBefore: number;
      let reservedBefore: number;

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
        basePaidOut = -oldBalance;

        const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);

        // debtRemainingValue = debt × basePrice / baseScale  (in 1e8-per-dollar price units)
        debtRemainingValue = mulPrice(-oldBalance, baseTokenPrice, baseScale);
        // collateralValue = collateralAmount × droppedPrice / scale
        collateralValue = mulPrice(config.collateralAmount, config.droppedPrice, assetInfo.scale);
        // collateralValueLeft = floor(LF × collateralValue)  [Solidity integer truncation]
        collateralValueLeft = mulFactor(collateralValue, assetInfo.liquidationFactor);

        // exact LF coverage as an integer ratio: (collateralAmount × price × LF) / (scale × factorScale)
        exactCoverageNumerator = config.collateralAmount * config.droppedPrice * assetInfo.liquidationFactor.toBigInt();
        exactCoverageDenominator = assetInfo.scale.toBigInt() * factorScale;

        // protocol loss: debt forgiven beyond the truncated LF coverage
        protocolLoss = debtRemainingValue - collateralValueLeft;

        // for logging: how much exact LF coverage exceeds debt (proof that exact math would have worked)
        exactSurplusNumerator = exactCoverageNumerator - debtRemainingValue * exactCoverageDenominator;
        surplusUnitsDenominator = config.droppedPrice * assetInfo.liquidationFactor.toBigInt();

        totalBorrowBaseBefore = totalsBasic.totalBorrowBase.toBigInt();
        totalSupplyCollateralBefore = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset.toBigInt();
        collateralReservesBefore = (await comet.getCollateralReserves(collateralAsset.address)).toBigInt();
        cometCollateralTokenBalanceBefore = (await collateralAsset.balanceOf(comet.address)).toBigInt();
        cometBaseTokenBalanceBefore = (await baseToken.balanceOf(comet.address)).toBigInt();
        const userBasic = await comet.userBasic(alice.address);
        assetsInBefore = userBasic.assetsIn;
        reservedBefore = userBasic._reserved;
      });

      after(async () => await snapshot.restore());

      it('alice is liquidatable', async () => {
        expect(await comet.isLiquidatable(alice.address)).to.be.true;
      });

      // Rounding proof:
      //   exact:   LF × collateralValue (rational)  > debtRemainingValue  → partial seizure should suffice
      //   rounded: floor(LF × collateralValue)       ≤ debtRemainingValue  → contract takes full-seizure path
      // The difference (protocolLoss) is forgiven as bad debt with no collateral backing.
      it('exact fractional LF coverage exceeds debt but integer truncation makes rounded coverage fall short', async () => {
        expect(exactCoverageNumerator).to.be.greaterThan(debtRemainingValue * exactCoverageDenominator);
        expect(collateralValueLeft).to.be.lessThanOrEqual(debtRemainingValue);
        // loss >= 0: positive when truncation creates a gap; 0 when surplus is sub-price-unit (Alice still loses sub-wei collateral)
        expect(protocolLoss).to.be.greaterThanOrEqual(0n);
      });

      it('logs rounding loss: protocol forgives residual debt not backed by collateral', async () => {
        const surplusTokensDenominator = surplusUnitsDenominator * (10n ** BigInt(config.decimals));
        console.log(
          `\n[ROUNDING LOSS] ${config.symbol} (${config.decimals} dec)  dropped price: ${formatUsd(config.droppedPrice)}\n` +
          `  debt to close:                        ${formatUsd(debtRemainingValue)}\n` +
          `  LF-adjusted collateral (exact):       $${formatFraction(exactCoverageNumerator, exactCoverageDenominator * baseTokenPrice)}\n` +
          `  LF-adjusted collateral (rounded):     ${formatUsd(collateralValueLeft)}  [floor(LF × collateralValue)]\n` +
          `  ─────────────────────────────────────────────────────────────────────────────────\n` +
          `  WHO LOSES:   protocol  (forgives residual debt without collateral backing)\n` +
          `  LOSS in USD: ${formatUsd(protocolLoss)}\n` +
          `  LOSS in wei: ${protocolLoss} price-units  (1 price-unit = 1e-8 USD)\n` +
          `  ─────────────────────────────────────────────────────────────────────────────────\n` +
          `  exact LF surplus above debt (collateral units): ${formatFraction(exactSurplusNumerator, surplusUnitsDenominator)}\n` +
          `  exact LF surplus above debt (tokens):           ${formatFraction(exactSurplusNumerator, surplusTokensDenominator)} ${config.symbol}`
        );
      });

      it('absorb succeeds', async () => {
        absorbTx = await comet.connect(absorber).absorb(absorber.address, [alice.address]);
        await expect(absorbTx).to.not.be.reverted;
      });

      // Event: full collateral seized because rounding made coverage appear insufficient
      it('AbsorbCollateral event shows full collateral seized due to rounding', async () => {
        await expect(absorbTx).to.emit(comet, 'AbsorbCollateral').withArgs(
          absorber.address,
          alice.address,
          collateralAsset.address,
          config.collateralAmount,
          collateralValue
        );
      });

      // Event: full debt absorbed — value includes the rounded residual that the protocol forgives
      it('AbsorbDebt event shows entire debt absorbed including rounded residual', async () => {
        const valueOfBasePaidOut = mulPrice(basePaidOut, baseTokenPrice, baseScale);
        await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(
          absorber.address, alice.address, basePaidOut, valueOfBasePaidOut
        );
      });

      // Storage proof: alice's positions cleared
      it('alice collateral balance is zero after full seizure', async () => {
        expect(await comet.collateralBalanceOf(alice.address, collateralAsset.address)).to.be.equal(0);
      });

      it('alice borrow balance is zero after absorb', async () => {
        expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
      });

      // Storage proof: protocol totals updated correctly
      it('total supplied collateral is zero after full seizure', async () => {
        const totalSupplyAssetAfter = (await comet.totalsCollateral(collateralAsset.address)).totalSupplyAsset.toBigInt();
        expect(totalSupplyAssetAfter).to.be.equal(totalSupplyCollateralBefore - config.collateralAmount);
        expect(totalSupplyAssetAfter).to.be.equal(0n);
      });

      it('collateral reserves increase by the full seized amount', async () => {
        const collateralReservesAfter = (await comet.getCollateralReserves(collateralAsset.address)).toBigInt();
        expect(collateralReservesAfter).to.be.equal(collateralReservesBefore + config.collateralAmount);
      });

      it('total borrow base decreases by the full absorbed debt', async () => {
        const totalBorrowBaseAfter = (await comet.totalsBasic()).totalBorrowBase.toBigInt();
        expect(totalBorrowBaseAfter).to.be.equal(totalBorrowBaseBefore - basePaidOut);
      });

      it('total borrow base is zero after absorb', async () => {
        expect((await comet.totalsBasic()).totalBorrowBase).to.be.equal(0);
      });

      // Storage proof: user flags
      it('alice assetsIn bit cleared after full collateral seizure', async () => {
        expect((await comet.userBasic(alice.address)).assetsIn).to.be.equal(assetsInBefore & ~(assetsInBefore));
      });

      it('alice reserved bits unchanged', async () => {
        expect((await comet.userBasic(alice.address))._reserved).to.be.equal(reservedBefore);
      });

      // ERC20 proof: absorb is pure accounting — no actual token transfers occur
      it('comet collateral token ERC20 balance unchanged during absorb', async () => {
        expect((await collateralAsset.balanceOf(comet.address)).toBigInt()).to.be.equal(cometCollateralTokenBalanceBefore);
      });

      it('comet base token ERC20 balance unchanged during absorb', async () => {
        expect((await baseToken.balanceOf(comet.address)).toBigInt()).to.be.equal(cometBaseTokenBalanceBefore);
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
  });
});
