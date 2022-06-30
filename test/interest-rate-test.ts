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

// === Tests for old kink model with fixed reserve rate (v2 model) ===
// describe('interest rates', function () {
//   it('when below kink utilization with 0.1 reserve rate', async () => {
//     const params = {
//       kink: exp(8, 17), // 0.8
//       perYearInterestRateBase: exp(5, 15), // 0.005
//       perYearInterestRateSlopeLow: exp(1, 17), // 0.1
//       perYearInterestRateSlopeHigh: exp(3, 18), // 3.0
//       reserveRate: exp(1, 17) // 0.1
//     };
//     const { comet } = await makeProtocol(params);

//     // 10% utilization
//     const totals = {
//       trackingSupplyIndex: 0,
//       trackingBorrowIndex: 0,
//       baseSupplyIndex: 2e15,
//       baseBorrowIndex: 4e15,
//       totalSupplyBase: 500n,
//       totalBorrowBase: 25n,
//       lastAccrualTime: 0,
//       pauseFlags: 0,
//     };
//     await wait(comet.setTotalsBasic(totals));

//     const utilization = await comet.getUtilization();
//     const supplyRate = await comet.getSupplyRate(utilization);
//     const borrowRate = await comet.getBorrowRate(utilization);

//     // totalBorrowBase / totalSupplyBase
//     // = 10 / 100 = 0.1
//     expect(utilization).to.be.equal(exp(1, 17));
//     // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
//     // = (0.005 + 0.1 * 0.1) * 0.1 * 0.9 = 0.00135
//     assertInterestRatesMatch(exp(135, 13), supplyRate.mul(SECONDS_PER_YEAR));
//     // interestRateBase + interestRateSlopeLow * utilization
//     // = 0.005 + 0.1 * 0.1 = 0.015
//     assertInterestRatesMatch(exp(15, 15), borrowRate.mul(SECONDS_PER_YEAR));
//   });

//   it('when above kink utilization with 0.1 reserve rate', async () => {
//     const params = {
//       kink: exp(8, 17), // 0.8
//       perYearInterestRateBase: exp(5, 15), // 0.005
//       perYearInterestRateSlopeLow: exp(1, 17), // 0.1
//       perYearInterestRateSlopeHigh: exp(3, 18), // 3.0
//       reserveRate: exp(1, 17) // 0.1
//     };
//     const { comet } = await makeProtocol(params);

//     // 90% utilization
//     const totals = {
//       trackingSupplyIndex: 0,
//       trackingBorrowIndex: 0,
//       baseSupplyIndex: 2e15,
//       baseBorrowIndex: 3e15,
//       totalSupplyBase: 50n,
//       totalBorrowBase: 30n,
//       lastAccrualTime: 0,
//       pauseFlags: 0,
//     };
//     await wait(comet.setTotalsBasic(totals));

//     const utilization = await comet.getUtilization();
//     const supplyRate = await comet.getSupplyRate(utilization);
//     const borrowRate = await comet.getBorrowRate(utilization);

//     // totalBorrowBase / totalSupplyBase
//     // = 90 / 100 = 0.9
//     expect(utilization).to.be.equal(exp(9, 17));
//     // (interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)) * utilization * (1 - reserveRate)
//     // = (0.005 + 0.1 * 0.8 + 3 * 0.1) * 0.9 * 0.9 = 0.31185
//     assertInterestRatesMatch(exp(31185, 13), supplyRate.mul(SECONDS_PER_YEAR));
//     // interestRateBase + interestRateSlopeLow * kink + interestRateSlopeHigh * (utilization - kink)
//     // = 0.005 + 0.1 * 0.8 + 3 * 0.1 = 0.385
//     assertInterestRatesMatch(exp(385, 15), borrowRate.mul(SECONDS_PER_YEAR));
//   });

//   it('with no reserve rate', async () => {
//     const params = {
//       kink: exp(8, 17), // 0.8
//       perYearInterestRateBase: exp(5, 15), // 0.005
//       perYearInterestRateSlopeLow: exp(1, 17), // 0.1
//       perYearInterestRateSlopeHigh: exp(3, 18), // 3.0
//       reserveRate: 0
//     };
//     const { comet } = await makeProtocol(params);

//     // 10% utilization
//     const totals = {
//       trackingSupplyIndex: 0,
//       trackingBorrowIndex: 0,
//       baseSupplyIndex: 4e15,
//       baseBorrowIndex: 2e15,
//       totalSupplyBase: 25n,
//       totalBorrowBase: 5n,
//       lastAccrualTime: 0,
//       pauseFlags: 0,
//     };
//     await wait(comet.setTotalsBasic(totals));

//     const utilization = await comet.getUtilization();
//     const supplyRate = await comet.getSupplyRate(utilization);
//     const borrowRate = await comet.getBorrowRate(utilization);

//     // totalBorrowBase / totalSupplyBase
//     // = 10 / 100 = 0.1
//     expect(utilization).to.be.equal(exp(1, 17));
//     // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
//     // = (0.005 + 0.1 * 0.1) * 0.1 = 0.0015
//     assertInterestRatesMatch(exp(15, 14), supplyRate.mul(SECONDS_PER_YEAR));
//     // interestRateBase + interestRateSlopeLow * utilization
//     // = 0.005 + 0.1 * 0.1 = 0.015
//     assertInterestRatesMatch(exp(15, 15), borrowRate.mul(SECONDS_PER_YEAR));
//   });

//   it('when 0 utilization', async () => {
//     const params = {
//       kink: exp(8, 17), // 0.8
//       perYearInterestRateBase: exp(5, 15), // 0.005
//       perYearInterestRateSlopeLow: exp(1, 17), // 0.1
//       perYearInterestRateSlopeHigh: exp(3, 18), // 3.0
//       reserveRate: exp(1, 17) // 0.1
//     };
//     const { comet } = await makeProtocol(params);

//     // 0% utilization
//     const totals = {
//       trackingSupplyIndex: 0,
//       trackingBorrowIndex: 0,
//       baseSupplyIndex: 2e15,
//       baseBorrowIndex: 3e15,
//       totalSupplyBase: 50n,
//       totalBorrowBase: 0,
//       lastAccrualTime: 0,
//       pauseFlags: 0,
//     };
//     await wait(comet.setTotalsBasic(totals));

//     const utilization = await comet.getUtilization();
//     const supplyRate = await comet.getSupplyRate(utilization);
//     const borrowRate = await comet.getBorrowRate(utilization);

//     // totalBorrowBase / totalSupplyBase
//     // = 0 / 100 = 0
//     expect(utilization).to.be.equal(0);
//     // (interestRateBase + interestRateSlopeLow * utilization) * utilization * (1 - reserveRate)
//     // = (0.005 + 0.1 * 0) * 0 * 0.9 = 0
//     assertInterestRatesMatch(0, supplyRate.mul(SECONDS_PER_YEAR));
//     // interestRateBase + interestRateSlopeLow * utilization
//     // = 0.005 + 0.1 * 0 = 0.005
//     assertInterestRatesMatch(exp(5, 15), borrowRate.mul(SECONDS_PER_YEAR));
//   });
// });
