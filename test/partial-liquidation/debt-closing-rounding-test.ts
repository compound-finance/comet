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
      let basePaidOut: bigint;

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

        expect(assetInfo.scale).to.be.equal(10n ** BigInt(config.decimals));
        expect(debtRemainingValue).to.be.lessThan(minDebtValue);
        expect(debtRemainingValue).to.be.lessThan(collateralValueLeft);
      });

      it('current rounding makes actual collateral coverage smaller than closed debt', async () => {
        const assetInfo = await comet.getAssetInfoByAddress(collateralAsset.address);

        // This mirrors _processDebtClosing:
        // seizedAmount = divPrice(floor(debt / LF), price, scale)
        // wantedCollateralValue = mulPrice(seizedAmount, price, scale)
        targetGrossCollateralValue = debtRemainingValue * factorScale / assetInfo.liquidationFactor.toBigInt();
        seizedAmount = divPrice(targetGrossCollateralValue, config.droppedPrice, assetInfo.scale);
        wantedCollateralValue = mulPrice(seizedAmount, config.droppedPrice, assetInfo.scale);
        actualCoveredValue = mulFactor(wantedCollateralValue, assetInfo.liquidationFactor);
        protocolLossValue = debtRemainingValue - actualCoveredValue;

        console.log(
          `[${config.symbol} ${config.decimals} decimals] debt closed: ${formatUsd(debtRemainingValue)}, ` +
          `actual covered: ${formatUsd(actualCoveredValue)}, protocol shortfall: ${formatUsd(protocolLossValue)}`
        );

        expect(actualCoveredValue).to.be.lessThan(debtRemainingValue);
        expect(protocolLossValue).to.be.greaterThan(0n);
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
        await expect(absorbTx).to.emit(comet, 'AbsorbDebt').withArgs(absorber.address, alice.address, basePaidOut, valueOfBasePaidOut);
      });

      it('alice borrow is fully closed', async () => {
        expect(await comet.borrowBalanceOf(alice.address)).to.be.equal(0);
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
