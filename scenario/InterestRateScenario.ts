import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { exp } from '../test/helpers';
import { BigNumber } from 'ethers';

function calculateSupplyRate(
  totalSupplyBase: BigNumber,
  totalBorrowBase: BigNumber,
  kink: BigNumber,
  interestRateBase: BigNumber,
  interestRateSlopeLow: BigNumber,
  interestRateSlopeHigh: BigNumber,
  reserveRate: BigNumber,
  factorScale = BigNumber.from(exp(1, 18))
): BigNumber {
  const utilization = calculateUtilization(totalSupplyBase, totalBorrowBase);
  const reserveScalingFactor = utilization.mul(factorScale.sub(reserveRate)).div(factorScale);
  if (utilization <= kink) {
    const interestRateWithoutBase = interestRateSlopeLow.mul(utilization).div(factorScale);
    const interestRateWithoutReserveScaling = interestRateBase.add(interestRateWithoutBase);
    return interestRateWithoutReserveScaling.mul(reserveScalingFactor).div(factorScale);
  } else {
    const rateSlopeLow = interestRateSlopeLow.mul(kink).div(factorScale);
    const rateSlopeHigh = interestRateSlopeHigh.mul(utilization.sub(kink)).div(factorScale);
    const interestRateWithoutReserveScaling = interestRateBase.add(rateSlopeLow).add(rateSlopeHigh);
    return interestRateWithoutReserveScaling.mul(reserveScalingFactor).div(factorScale);
  }
}

function calculateBorrowRate(
  totalSupplyBase: BigNumber,
  totalBorrowBase: BigNumber,
  kink: BigNumber,
  interestRateBase: BigNumber,
  interestRateSlopeLow: BigNumber,
  interestRateSlopeHigh: BigNumber,
  factorScale = BigNumber.from(exp(1, 18))
): BigNumber {
  const utilization = calculateUtilization(totalSupplyBase, totalBorrowBase);
  if (utilization.lte(kink)) {
    const interestRateWithoutBase = interestRateSlopeLow.mul(utilization).div(factorScale);
    return interestRateBase.add(interestRateWithoutBase);
  } else {
    const rateSlopeLow = interestRateSlopeLow.mul(kink).div(factorScale);
    const rateSlopeHigh = interestRateSlopeHigh.mul(utilization.sub(kink)).div(factorScale);
    return interestRateBase.add(rateSlopeLow).add(rateSlopeHigh);
  }
}

function calculateUtilization(
  totalSupplyBase,
  totalBorrowBase,
  factorScale = BigNumber.from(exp(1, 18))
): BigNumber {
  if (totalSupplyBase) {
    return BigNumber.from(0);
  } else {
    return totalBorrowBase.mul(factorScale).div(totalSupplyBase);
  }
}

// TODO: Add constraint to set total supply and borrow bases.
scenario(
  'Comet#interestRate > rates using on-chain configuration constants',
  { upgrade: true },
  async ({ comet, actors }) => {
    let { totalSupplyBase, totalBorrowBase } = await comet.totalsBasic();
    const kink = await comet.kink();
    const perSecondInterestRateBase = await comet.perSecondInterestRateBase();
    const perSecondInterestRateSlopeLow = await comet.perSecondInterestRateSlopeLow();
    const perSecondInterestRateSlopeHigh = await comet.perSecondInterestRateSlopeHigh();
    const reserveRate = await comet.reserveRate();

    expect(await comet.getUtilization()).to.equal(
      calculateUtilization(totalSupplyBase, totalBorrowBase)
    );
    expect(await comet.getSupplyRate()).to.equal(
      calculateSupplyRate(
        totalSupplyBase,
        totalBorrowBase,
        kink,
        perSecondInterestRateBase,
        perSecondInterestRateSlopeLow,
        perSecondInterestRateSlopeHigh,
        reserveRate
      )
    );
    expect(await comet.getBorrowRate()).to.equal(
      calculateBorrowRate(
        totalSupplyBase,
        totalBorrowBase,
        kink,
        perSecondInterestRateBase,
        perSecondInterestRateSlopeLow,
        perSecondInterestRateSlopeHigh
      )
    );
  }
);

// TODO: Add constraint to set total supply and borrow bases.
scenario(
  'Comet#interestRate > rates using hypothetical configuration constants',
  {
    upgrade: true, 
    configConstants: {
      perYearInterestRateBase: (5e16).toString() // 5% per year
    }
  },
  async ({ comet, actors }) => {
    expect(await comet.getUtilization()).to.equal(0);
    expect(await comet.getSupplyRate()).to.equal(0);
    expect(await comet.getBorrowRate()).to.equal(BigNumber.from(1585489599)); // 5% per year if annualized
  }
);

// TODO: Scenario for testing custom configuration constants using a constraint.
// ADD NEW CONSTRAINTS
// 1. To set configuration constants. This seems similar to the modern constraint since it'll require a redeploy, so maybe i can merge the two constraints together.
// 2. To set utilization. The constraint will increase/decrease the total supply/borrow to arrive at the target utilization. Maybe instead of taking utilization as an input, it can be more flexible by taking a struct of target total supplies/borrows for each asset (not just the base asset)
