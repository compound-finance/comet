import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { annualize, defactor, exp } from '../test/helpers';
import { BigNumber } from 'ethers';
import { FuzzType } from './constraints/Fuzzing';

function calculateInterestRate(
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
  {},
  async ({ comet }) => {
    let { totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex } = await comet.totalsBasic();
    const supplyKink = await comet.supplyKink();
    const supplyPerSecondInterestRateBase = await comet.supplyPerSecondInterestRateBase();
    const supplyPerSecondInterestRateSlopeLow = await comet.supplyPerSecondInterestRateSlopeLow();
    const supplyPerSecondInterestRateSlopeHigh = await comet.supplyPerSecondInterestRateSlopeHigh();
    const borrowKink = await comet.borrowKink();
    const borrowPerSecondInterestRateBase = await comet.borrowPerSecondInterestRateBase();
    const borrowPerSecondInterestRateSlopeLow = await comet.borrowPerSecondInterestRateSlopeLow();
    const borrowPerSecondInterestRateSlopeHigh = await comet.borrowPerSecondInterestRateSlopeHigh();

    const actualUtilization = await comet.getUtilization();
    const expectedUtilization = calculateUtilization(totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex);

    expect(defactor(actualUtilization)).to.be.approximately(defactor(expectedUtilization), 0.00001);
    expect(await comet.getSupplyRate(actualUtilization)).to.equal(
      calculateInterestRate(
        actualUtilization,
        supplyKink,
        supplyPerSecondInterestRateBase,
        supplyPerSecondInterestRateSlopeLow,
        supplyPerSecondInterestRateSlopeHigh
      )
    );
    expect(await comet.getBorrowRate(actualUtilization)).to.equal(
      calculateInterestRate(
        actualUtilization,
        borrowKink,
        borrowPerSecondInterestRateBase,
        borrowPerSecondInterestRateSlopeLow,
        borrowPerSecondInterestRateSlopeHigh
      )
    );
  }
);

scenario(
  'Comet#interestRate > below kink rates using hypothetical configuration constants',
  {
    upgrade: {
      supplyKink: exp(0.8, 18),
      supplyPerYearInterestRateBase: exp(0, 18),
      supplyPerYearInterestRateSlopeLow: exp(0.04, 18),
      supplyPerYearInterestRateSlopeHigh: exp(0.4, 18),
      borrowKink: exp(0.8, 18),
      borrowPerYearInterestRateBase: exp(0.01, 18),
      borrowPerYearInterestRateSlopeLow: exp(0.05, 18),
      borrowPerYearInterestRateSlopeHigh: exp(0.3, 18),
    },
    utilization: 0.5,
  },
  async ({ comet }) => {
    const utilization = await comet.getUtilization();
    expect(defactor(utilization)).to.be.approximately(0.5, 0.00001);
    expect(annualize(await comet.getSupplyRate(utilization))).to.be.approximately(0.02, 0.001);
    expect(annualize(await comet.getBorrowRate(utilization))).to.be.approximately(0.035, 0.001);
  }
);

scenario(
  'Comet#interestRate > above kink rates using hypothetical configuration constants',
  {
    upgrade: {
      supplyKink: exp(0.8, 18),
      supplyPerYearInterestRateBase: exp(0, 18),
      supplyPerYearInterestRateSlopeLow: exp(0.04, 18),
      supplyPerYearInterestRateSlopeHigh: exp(0.4, 18),
      borrowKink: exp(0.8, 18),
      borrowPerYearInterestRateBase: exp(0.01, 18),
      borrowPerYearInterestRateSlopeLow: exp(0.05, 18),
      borrowPerYearInterestRateSlopeHigh: exp(0.3, 18),
    },
    utilization: 0.85,
  },
  async ({ comet }) => {
    const utilization = await comet.getUtilization();
    expect(defactor(utilization)).to.be.approximately(0.85, 0.00001);
    expect(annualize(await comet.getSupplyRate(utilization))).to.be.approximately(0.052, 0.001);
    expect(annualize(await comet.getBorrowRate(utilization))).to.be.approximately(0.065, 0.001);
  }
);

scenario(
  'Comet#interestRate > rates using fuzzed configuration constants',
  {
    upgrade: {
      // TODO: Read types directly from Solidity?
      supplyPerYearInterestRateBase: { type: FuzzType.UINT64 },
      borrowPerYearInterestRateBase: { type: FuzzType.UINT64, max: (1e18).toString() /* 100% */ },
    }
  },
  async ({ comet }) => {
    let { totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex } = await comet.totalsBasic();
    const supplyKink = await comet.supplyKink();
    const supplyPerSecondInterestRateBase = await comet.supplyPerSecondInterestRateBase();
    const supplyPerSecondInterestRateSlopeLow = await comet.supplyPerSecondInterestRateSlopeLow();
    const supplyPerSecondInterestRateSlopeHigh = await comet.supplyPerSecondInterestRateSlopeHigh();
    const borrowKink = await comet.borrowKink();
    const borrowPerSecondInterestRateBase = await comet.borrowPerSecondInterestRateBase();
    const borrowPerSecondInterestRateSlopeLow = await comet.borrowPerSecondInterestRateSlopeLow();
    const borrowPerSecondInterestRateSlopeHigh = await comet.borrowPerSecondInterestRateSlopeHigh();


    const actualUtilization = await comet.getUtilization();
    const expectedUtilization = calculateUtilization(totalSupplyBase, totalBorrowBase, baseSupplyIndex, baseBorrowIndex);

    expect(defactor(actualUtilization)).to.be.approximately(defactor(expectedUtilization), 0.00001);
    expect(await comet.getSupplyRate(actualUtilization)).to.equal(
      calculateInterestRate(
        actualUtilization,
        supplyKink,
        supplyPerSecondInterestRateBase,
        supplyPerSecondInterestRateSlopeLow,
        supplyPerSecondInterestRateSlopeHigh
      )
    );
    expect(await comet.getBorrowRate(actualUtilization)).to.equal(
      calculateInterestRate(
        actualUtilization,
        borrowKink,
        borrowPerSecondInterestRateBase,
        borrowPerSecondInterestRateSlopeLow,
        borrowPerSecondInterestRateSlopeHigh
      )
    );
  }
);

// TODO: Scenario for testing custom configuration constants using a utilization constraint.
// XXX this test seems too fickle
scenario.skip(
  'Comet#interestRate > when utilization is 50%',
  { utilization: 0.5 },
  async ({ comet }, context) => {
    const utilization = await comet.getUtilization();
    expect(defactor(utilization)).to.be.approximately(0.5, 0.00001);

    // Note: this is dependent on the `deployments/fuji/configuration.json` variables
    // TODO: Consider if there's a better way to test the live curve.
    if (context.world.base.network === 'fuji') {
      // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
      // utilization = 50%
      // ( 1% + 2% * 50% ) * 50% * (100% - 10%)
      // ( 1% + 1% ) * 50% * 90% -> 1% * 90% = 0.9%
      expect(annualize(await comet.getSupplyRate(utilization))).to.be.approximately(0.009, 0.001);

      // interestRateBase + interestRateSlopeLow * utilization
      // utilization = 50%
      // ( 1% + 2% * 50% )
      expect(annualize(await comet.getBorrowRate(utilization))).to.be.approximately(0.02, 0.001);
    }
  }
);
