import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { annualize, defactor, exp, factor } from '../test/helpers';
import { BigNumber } from 'ethers';
import { FuzzType } from './constraints/Fuzzing';

function calculateSupplyRate(
  utilization: BigNumber,
  kink: BigNumber,
  interestRateBase: BigNumber,
  interestRateSlopeLow: BigNumber,
  interestRateSlopeHigh: BigNumber,
  reserveRate: BigNumber,
  factorScale = BigNumber.from(exp(1, 18))
): BigNumber {
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
  utilization: BigNumber,
  kink: BigNumber,
  interestRateBase: BigNumber,
  interestRateSlopeLow: BigNumber,
  interestRateSlopeHigh: BigNumber,
  factorScale = BigNumber.from(exp(1, 18))
): BigNumber {
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
  totalSupplyBase: BigNumber,
  totalBorrowBase: BigNumber,
  baseSupplyIndex: BigNumber,
  baseBorrowIndex: BigNumber,
  factorScale = BigNumber.from(exp(1, 18))
): BigNumber {
  if (totalSupplyBase.isZero()) {
    return BigNumber.from(0);
  } else {
    const totalSupply = totalSupplyBase.mul(baseSupplyIndex).div(factorScale);
    const totalBorrow = totalBorrowBase.mul(baseBorrowIndex).div(factorScale);
    return totalBorrow.mul(factorScale).div(totalSupply);
  }
}

scenario(
  'Comet#interestRate > rates using on-chain configuration constants',
  { upgrade: true },
  async ({ comet, actors }) => {
    let { totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex } = await comet.totalsBasic();
    const kink = await comet.kink();
    const perSecondInterestRateBase = await comet.perSecondInterestRateBase();
    const perSecondInterestRateSlopeLow = await comet.perSecondInterestRateSlopeLow();
    const perSecondInterestRateSlopeHigh = await comet.perSecondInterestRateSlopeHigh();
    const reserveRate = await comet.reserveRate();

    const actualUtilization = await comet.getUtilization();
    const expectedUtilization = calculateUtilization(totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex);

    expect(defactor(actualUtilization)).to.be.approximately(defactor(expectedUtilization), 0.00001);
    expect(await comet.getSupplyRate()).to.equal(
      calculateSupplyRate(
        actualUtilization,
        kink,
        perSecondInterestRateBase,
        perSecondInterestRateSlopeLow,
        perSecondInterestRateSlopeHigh,
        reserveRate
      )
    );
    expect(await comet.getBorrowRate()).to.equal(
      calculateBorrowRate(
        actualUtilization,
        kink,
        perSecondInterestRateBase,
        perSecondInterestRateSlopeLow,
        perSecondInterestRateSlopeHigh
      )
    );
  }
);

scenario(
  'Comet#interestRate > below kink rates using hypothetical configuration constants',
  {
    upgrade: true,
    cometConfig: {
      perYearInterestRateBase: (0.005e18).toString(), // 0.5% per year
      perYearInterestRateSlopeLow: (0.05e18).toString(),
      perYearInterestRateSlopeHigh: (0.2e18).toString(),
      reserveRate: (0.1e18).toString(), // 1%,
      kink: (0.8e18).toString(), // 80%
    },
    utilization: 0.5,
  },
  async ({ comet, actors }) => {
    expect(defactor(await comet.getUtilization())).to.be.approximately(0.5, 0.00001);
    expect(annualize(await comet.getSupplyRate())).to.be.approximately(0.0135, 0.001);
    expect(annualize(await comet.getBorrowRate())).to.be.approximately(0.03, 0.001);
  }
);

scenario(
  'Comet#interestRate > above kink rates using hypothetical configuration constants',
  {
    upgrade: true,
    cometConfig: {
      perYearInterestRateBase: (0.005e18).toString(), // 0.5% per year
      perYearInterestRateSlopeLow: (0.05e18).toString(),
      perYearInterestRateSlopeHigh: (0.2e18).toString(),
      reserveRate: (0.1e18).toString(), // 1%,
      kink: (0.8e18).toString(), // 80%
    },
    utilization: 0.85,
  },
  async ({ comet, actors }) => {
    expect(defactor(await comet.getUtilization())).to.be.approximately(0.85, 0.00001);
    expect(annualize(await comet.getSupplyRate())).to.be.approximately(0.0421, 0.001);
    expect(annualize(await comet.getBorrowRate())).to.be.approximately(0.055, 0.001);
  }
);

scenario(
  'Comet#interestRate > rates using fuzzed configuration constants',
  {
    upgrade: true,
    cometConfig: {
      // TODO: Read types directly from Solidity?
      perYearInterestRateBase: { type: FuzzType.UINT64 },
      reserveRate: { type: FuzzType.UINT64, max: (1e18).toString() /* 100% */ },
      kink: (8e17).toString(), // 80%
    }
  },
  async ({ comet, actors }) => {
    let { totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex } = await comet.totalsBasic();
    const kink = await comet.kink();
    const perSecondInterestRateBase = await comet.perSecondInterestRateBase();
    const perSecondInterestRateSlopeLow = await comet.perSecondInterestRateSlopeLow();
    const perSecondInterestRateSlopeHigh = await comet.perSecondInterestRateSlopeHigh();
    const reserveRate = await comet.reserveRate();

    const actualUtilization = await comet.getUtilization();
    const expectedUtilization = calculateUtilization(totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex);

    expect(defactor(actualUtilization)).to.be.approximately(defactor(expectedUtilization), 0.00001);
    expect(await comet.getSupplyRate()).to.equal(
      calculateSupplyRate(
        actualUtilization,
        kink,
        perSecondInterestRateBase,
        perSecondInterestRateSlopeLow,
        perSecondInterestRateSlopeHigh,
        reserveRate
      )
    );
    expect(await comet.getBorrowRate()).to.equal(
      calculateBorrowRate(
        actualUtilization,
        kink,
        perSecondInterestRateBase,
        perSecondInterestRateSlopeLow,
        perSecondInterestRateSlopeHigh
      )
    );
  }
);

// TODO: Scenario for testing custom configuration constants using a utilization constraint.
scenario(
  'Comet#interestRate > when utilization is 50%',
{ utilization: 0.5, upgrade: true },
  async ({ comet, actors }, world) => {
    expect(defactor(await comet.getUtilization())).to.be.approximately(0.5, 0.00001);

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
