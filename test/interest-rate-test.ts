import { Comet, ethers, expect, exp, makeProtocol, wait } from './helpers';

// Interest rate calculations can be checked with this Google Sheet: 
// https://docs.google.com/spreadsheets/d/1G3BWcFPEQYnH-IrHHye5oA0oFIP0Jyj7pybdpMuDOuI

describe('interest rates', function () {
  it('when below kink utilization with 0.1 reserve rate', async () => {
    const params = {
      kink: exp(8, 17), // 0.8
      interestRateBase: exp(5, 15), // 0.005
      interestRateSlopeLow: exp(1, 17), // 0.1
      interestRateSlopeHigh: exp(3, 18), // 3.0
      reserveRate: exp(1, 17) // 0.1
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
    await wait(comet.setTotals(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate();
    const borrowRate = await comet.getBorrowRate();

    // totalBorrowBase / totalSupplyBase
    // = 10 / 100 = 0.1
    expect(utilization).to.be.equal(exp(1, 17));
    // (interestRateBase + interestRateSlowLow * utilization) * utilization * (1 - reserveRate)
    // = (0.005 + 0.1 * 0.1) * 0.1 * 0.9 = 0.00135
    expect(supplyRate).to.be.equal(exp(135, 13));
    // interestRateBase + interestRateSlowLow * utilization
    // = 0.005 + 0.1 * 0.1 = 0.015
    expect(borrowRate).to.be.equal(exp(15, 15));
  });

  it('when above kink utilization with 0.1 reserve rate', async () => {
    const params = {
      kink: exp(8, 17), // 0.8
      interestRateBase: exp(5, 15), // 0.005
      interestRateSlopeLow: exp(1, 17), // 0.1
      interestRateSlopeHigh: exp(3, 18), // 3.0
      reserveRate: exp(1, 17) // 0.1
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
    await wait(comet.setTotals(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate();
    const borrowRate = await comet.getBorrowRate();

    // totalBorrowBase / totalSupplyBase
    // = 90 / 100 = 0.9
    expect(utilization).to.be.equal(exp(9, 17));
    // (interestRateBase + interestRateSlowLow * kink + interestRateHigh * (utilization - kink)) * utilization * (1 - reserveRate)
    // = (0.005 + 0.1 * 0.8 + 3 * 0.1) * 0.9 * 0.9 = 0.31185
    expect(supplyRate).to.be.equal(exp(31185, 13));
    // interestRateBase + interestRateSlowLow * kink + interestRateHigh * (utilization - kink)
    // = 0.005 + 0.1 * 0.8 + 3 * 0.1 = 0.385
    expect(borrowRate).to.be.equal(exp(385, 15));
  });

  it('with no reserve rate', async () => {
    const params = {
      kink: exp(8, 17), // 0.8
      interestRateBase: exp(5, 15), // 0.005
      interestRateSlopeLow: exp(1, 17), // 0.1
      interestRateSlopeHigh: exp(3, 18), // 3.0
      reserveRate: exp(1, 17) // 0.1
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
    await wait(comet.setTotals(totals));

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate();
    const borrowRate = await comet.getBorrowRate();

    // totalBorrowBase / totalSupplyBase
    // = 10 / 100 = 0.1
    expect(utilization).to.be.equal(exp(1, 17));
    // (interestRateBase + interestRateSlowLow * utilization) * utilization * (1 - reservRate)
    // = (0.005 + 0.1 * 0.1) * 0.1 * 0.9 = 0.00135
    expect(supplyRate).to.be.equal(exp(135, 13));
    // interestRateBase + interestRateSlowLow * utilization
    // = 0.005 + 0.1 * 0.1 = 0.015
    expect(borrowRate).to.be.equal(exp(15, 15));
  });
});
