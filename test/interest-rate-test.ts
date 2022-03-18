import { BigNumber } from 'ethers';
import { Comet, ethers, expect, exp, makeProtocol, wait } from './helpers';

// Interest rate calculations can be checked with this Google Sheet:
// https://docs.google.com/spreadsheets/d/1G3BWcFPEQYnH-IrHHye5oA0oFIP0Jyj7pybdpMuDOuI

// The minimum required precision between the actual and expected annual rate for tests to pass.
const MINIMUM_PRECISION_WEI = 1e8; // 1e8 wei of precision

const SECONDS_PER_YEAR = 31_536_000;

function assertInterestRatesMatch(expectedRate, actualRate, precision = MINIMUM_PRECISION_WEI) {
  expect((actualRate.sub(expectedRate)).abs()).lte(precision);
}

describe('interest rates', function () {
  it('when below kink utilization with 0.1 reserve rate', async () => {
    const params = {
      kink: exp(0.8, 18), // 80%
      interestRateBase: exp(0.005, 18), // 0.5%
      interestRateSlopeLow: exp(0.1, 18), // 10%
      interestRateSlopeHigh: exp(3, 18), // 300%
      reserveRate: exp(0.1, 18) // 10%
    };
    const { comet } = await makeProtocol(params);
    const baseIndexScale = await comet.baseIndexScale();

    // 10% utilization
    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: baseIndexScale,
      baseBorrowIndex: baseIndexScale,
      totalSupplyBase: 100n,
      totalBorrowBase: 10n,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    await wait(comet.setTotalsBasic(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate();
    const borrowRate = await comet.getBorrowRate();

    // totalBorrowBase / totalSupplyBase
    // = 10 / 100 = 0.1
    expect(utilization).to.be.equal(exp(1, 17));
    // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
    // = (0.005 + 0.1 * 0.1) * 0.1 * 0.9 = 0.00135
    assertInterestRatesMatch(exp(135, 13), supplyRate.mul(SECONDS_PER_YEAR));
    // interestRateBase + interestRateSlopeLow * utilization
    // = 0.005 + 0.1 * 0.1 = 0.015
    assertInterestRatesMatch(exp(15, 15), borrowRate.mul(SECONDS_PER_YEAR));
  });

  it('when above kink utilization with 0.1 reserve rate', async () => {
    const params = {
      kink: exp(0.8, 18),
      interestRateBase: exp(0.005, 18),
      interestRateSlopeLow: exp(0.1, 18),
      interestRateSlopeHigh: exp(3, 18),
      reserveRate: exp(0.1, 18)
    };
    const { comet } = await makeProtocol(params);
    const baseIndexScale = await comet.baseIndexScale();

    // 90% utilization
    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: baseIndexScale,
      baseBorrowIndex: baseIndexScale,
      totalSupplyBase: 100n,
      totalBorrowBase: 90n,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    await wait(comet.setTotalsBasic(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate();
    const borrowRate = await comet.getBorrowRate();

    // totalBorrowBase / totalSupplyBase
    // = 90 / 100 = 0.9
    expect(utilization).to.be.equal(exp(9, 17));
    // (interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)) * utilization * (1 - reserveRate)
    // = (0.005 + 0.1 * 0.8 + 3 * 0.1) * 0.9 * 0.9 = 0.31185
    assertInterestRatesMatch(exp(31185, 13), supplyRate.mul(SECONDS_PER_YEAR));
    // interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)
    // = 0.005 + 0.1 * 0.8 + 3 * 0.1 = 0.385
    assertInterestRatesMatch(exp(385, 15), borrowRate.mul(SECONDS_PER_YEAR));
  });

  it('when above 100% utilization with 0.1 reserve rate', async () => {
    const params = {
      kink: exp(0.8, 18),
      interestRateBase: exp(0.01, 18),
      interestRateSlopeLow: exp(0.02, 18),
      interestRateSlopeHigh: exp(0.1, 18),
      reserveRate: exp(0.1, 18)
    };
    const { comet } = await makeProtocol(params);

    const baseIndexScale = await comet.baseIndexScale();

    // 110% utilization
    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: baseIndexScale,
      baseBorrowIndex: baseIndexScale,
      totalSupplyBase: 100n,
      totalBorrowBase: 110n,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    await wait(comet.setTotalsBasic(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate();
    const borrowRate = await comet.getBorrowRate();

    expect(utilization).to.be.equal(exp(1.1, 18));
    expect(Number(supplyRate)).to.be.lessThan(Number(borrowRate));
    // = (0.01 + 0.02 * 0.8 + 0.1 * (1.1 - 0.8)) * (1 - 0.1) = 0.0504
    assertInterestRatesMatch(exp(0.0504, 18), supplyRate.mul(SECONDS_PER_YEAR));
    // = (0.01 + 0.02 * 0.8 + 0.1 * (1.1 - 0.8)) = 0.056
    assertInterestRatesMatch(exp(0.056, 18), borrowRate.mul(SECONDS_PER_YEAR));
  });

  it('with no reserve rate', async () => {
    const params = {
      kink: exp(0.8, 18),
      interestRateBase: exp(0.005, 18),
      interestRateSlopeLow: exp(0.1, 18),
      interestRateSlopeHigh: exp(3, 18),
      reserveRate: 0
    };
    const { comet } = await makeProtocol(params);
    const baseIndexScale = await comet.baseIndexScale();

    // 10% utilization
    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: baseIndexScale,
      baseBorrowIndex: baseIndexScale,
      totalSupplyBase: 100n,
      totalBorrowBase: 10n,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    await wait(comet.setTotalsBasic(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate();
    const borrowRate = await comet.getBorrowRate();

    // totalBorrowBase / totalSupplyBase
    // = 10 / 100 = 0.1
    expect(utilization).to.be.equal(exp(1, 17));
    // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
    // = (0.005 + 0.1 * 0.1) * 0.1 = 0.0015
    assertInterestRatesMatch(exp(15, 14), supplyRate.mul(SECONDS_PER_YEAR));
    // interestRateBase + interestRateSlopeLow * utilization
    // = 0.005 + 0.1 * 0.1 = 0.015
    assertInterestRatesMatch(exp(15, 15), borrowRate.mul(SECONDS_PER_YEAR));
  });

  it('when 0 utilization', async () => {
    const params = {
      kink: exp(0.8, 18),
      interestRateBase: exp(0.005, 18),
      interestRateSlopeLow: exp(0.1, 18),
      interestRateSlopeHigh: exp(3, 18),
      reserveRate: exp(0.1, 18)
    };
    const { comet } = await makeProtocol(params);
    const baseIndexScale = await comet.baseIndexScale();

    // 0% utilization
    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: baseIndexScale,
      baseBorrowIndex: baseIndexScale,
      totalSupplyBase: 100n,
      totalBorrowBase: 0,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    await wait(comet.setTotalsBasic(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate();
    const borrowRate = await comet.getBorrowRate();

    // totalBorrowBase / totalSupplyBase
    // = 0 / 100 = 0
    expect(utilization).to.be.equal(0);
    // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
    // = (0.005 + 0.1 * 0) * 0 * 0.9 = 0
    assertInterestRatesMatch(0, supplyRate.mul(SECONDS_PER_YEAR));
    // interestRateBase + interestRateSlopeLow * utilization
    // = 0.005 + 0.1 * 0 = 0.005
    assertInterestRatesMatch(exp(5, 15), borrowRate.mul(SECONDS_PER_YEAR));
  });
});
