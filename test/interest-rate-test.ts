import { expect, exp, makeProtocol, wait } from './helpers';

// Interest rate calculations can be checked with this Google Sheet:
// https://docs.google.com/spreadsheets/d/1G3BWcFPEQYnH-IrHHye5oA0oFIP0Jyj7pybdpMuDOuI

// The minimum required precision between the actual and expected annual rate for tests to pass.
const MINIMUM_PRECISION_WEI = 1e8; // 1e8 wei of precision

const SECONDS_PER_YEAR = 31_536_000;

function assertInterestRatesMatch(expectedRate, actualRate, precision = MINIMUM_PRECISION_WEI) {
  expect((actualRate.sub(expectedRate)).abs()).lte(precision);
}

const interestRateParams = {
  supplyKink: exp(0.8, 18),
  supplyInterestRateBase: exp(0, 18),
  supplyInterestRateSlopeLow: exp(0.04, 18),
  supplyInterestRateSlopeHigh: exp(0.4, 18),
  borrowKink: exp(0.8, 18),
  borrowInterestRateBase: exp(0.01, 18),
  borrowInterestRateSlopeLow: exp(0.05, 18),
  borrowInterestRateSlopeHigh: exp(0.3, 18),
};

describe('interest rates', function () {
  it('when below kink utilization', async () => {
    const { comet } = await makeProtocol(interestRateParams);

    // 10% utilization
    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: 2e15,
      baseBorrowIndex: 4e15,
      totalSupplyBase: 500n,
      totalBorrowBase: 25n,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    await wait(comet.setTotalsBasic(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate(utilization);
    const borrowRate = await comet.getBorrowRate(utilization);

    // totalBorrowBase / totalSupplyBase
    // = 10 / 100 = 0.1
    expect(utilization).to.be.equal(exp(0.1, 18));
    // interestRateBase + interestRateSlopeLow * utilization
    // = 0 + 0.04 * 0.1 = 0.004
    assertInterestRatesMatch(exp(.004, 18), supplyRate.mul(SECONDS_PER_YEAR));
    // interestRateBase + interestRateSlopeLow * utilization
    // = 0.01 + 0.05 * 0.1 = 0.015
    assertInterestRatesMatch(exp(0.015, 18), borrowRate.mul(SECONDS_PER_YEAR));
  });

  it('when above kink utilization', async () => {
    const { comet } = await makeProtocol(interestRateParams);

    // 90% utilization
    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: 2e15,
      baseBorrowIndex: 3e15,
      totalSupplyBase: 50n,
      totalBorrowBase: 30n,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    await wait(comet.setTotalsBasic(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate(utilization);
    const borrowRate = await comet.getBorrowRate(utilization);

    // totalBorrowBase / totalSupplyBase
    // = 90 / 100 = 0.9
    expect(utilization).to.be.equal(exp(0.9, 18));
    // interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)
    // = 0 + 0.04 * 0.8 + 0.4 * 0.1 = 0.072
    assertInterestRatesMatch(exp(0.072, 18), supplyRate.mul(SECONDS_PER_YEAR));
    // interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)
    // = 0.01 + 0.05 * 0.8 + 0.3 * 0.1 = 0.08
    assertInterestRatesMatch(exp(0.08, 18), borrowRate.mul(SECONDS_PER_YEAR));
  });

  it('when 0 utilization', async () => {
    const { comet } = await makeProtocol(interestRateParams);

    // 0% utilization
    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: 2e15,
      baseBorrowIndex: 3e15,
      totalSupplyBase: 50n,
      totalBorrowBase: 0,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    await wait(comet.setTotalsBasic(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate(utilization);
    const borrowRate = await comet.getBorrowRate(utilization);

    // totalBorrowBase / totalSupplyBase
    // = 0 / 100 = 0
    expect(utilization).to.be.equal(0);
    // interestRateBase + interestRateSlopeLow * utilization
    // = 0 + 0.04 * 0 = 0
    assertInterestRatesMatch(0, supplyRate.mul(SECONDS_PER_YEAR));
    // interestRateBase + interestRateSlopeLow * utilization
    // = 0.01 + 0.05 * 0 = 0.01
    assertInterestRatesMatch(exp(0.01, 18), borrowRate.mul(SECONDS_PER_YEAR));
  });
});
