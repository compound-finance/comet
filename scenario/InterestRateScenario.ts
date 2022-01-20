import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { annualize, defactor, exp, factor } from '../test/helpers';
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

// TODO: Add constraint to set utilization.
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

// TODO: Add constraint to set utilization.
scenario(
  'Comet#interestRate > rates using hypothetical configuration constants',
  {
    upgrade: true,
    cometConfig: {
      perYearInterestRateBase: (5e16).toString(), // 5% per year
    },
  },
  async ({ comet, actors }) => {
    expect(await comet.getUtilization()).to.equal(0);
    expect(annualize(await comet.getSupplyRate())).to.equal(0.0);
    expect(annualize(await comet.getBorrowRate())).to.be.approximately(0.05, 0.001);
  }
);

// TODO: Scenario for testing custom configuration constants using a utilization constraint.
scenario(
  'Comet#interestRate > when utilization is 50%',
  { utilization: 0.5, upgrade: true },
  async ({ comet, actors }, world) => {
    expect(defactor(await comet.getUtilization())).to.be.approximately(0.5, 0.000001);

    // Note: this is dependent on the `deployments/fuji/configuration.json` variables
    // TODO: Consider if there's a better way to test the live curve.
    if (world.base.name === 'fuji') {
      // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
      // utilzation = 50%
      // ( 1% + 2% * 50% ) * 50% * (100% - 10%)
      // ( 1% + 1% ) * 50% * 90% -> 1% * 90% = 0.9%
      expect(annualize(await comet.getSupplyRate())).to.be.approximately(0.009, 0.001);

      // interestRateBase + interestRateSlopeLow * utilization
      // utilzation = 50%
      // ( 1% + 2% * 50% )
      expect(annualize(await comet.getBorrowRate())).to.be.approximately(0.02, 0.001);
    }
  }
);
