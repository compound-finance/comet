import { Comet, ethers, expect, exp, makeProtocol, wait } from './helpers';

describe('accrue', function () {
  it('fails if baseMinForRewards = 0', async () => {
    await expect(
      makeProtocol({
        baseMinForRewards: 0,
      })
    ).to.be.revertedWith('baseMinForRewards should be > 0');
  });

  it('accrue initially succeeds and has the right parameters', async () => {
    const params = {
      baseMinForRewards: 12331,
      baseTrackingSupplySpeed: 668,
      baseTrackingBorrowSpeed: 777,
    };
    const { comet } = await makeProtocol(params);
    const a0 = await wait(comet.accrue());
    expect(await comet.baseMinForRewards()).to.be.equal(params.baseMinForRewards);
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(params.baseTrackingSupplySpeed);
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(params.baseTrackingBorrowSpeed);
  });

  it('accrues correctly with no time elapsed', async () => {
    const { comet } = await makeProtocol();

    const now = Math.floor(Date.now() / 1000);
    const f0 = wait(comet.setNow(now));

    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: exp(1, 6), // XXX decimals on index?
      baseBorrowIndex: exp(1, 6), // XXX decimals on index?
      totalSupplyBase: 1000n,
      totalBorrowBase: 1000n,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    const s0 = wait(comet.setTotals(totals));

    const t0 = await comet.totals()
    const a1 = await wait(comet.accrue());
    const t1 = await comet.totals();
    const a2 = await wait(comet.accrue());
    const t2 = await comet.totals();

    expect(t0.lastAccrualTime).to.be.equal(0);
    expect(t0.totalSupplyBase).to.be.equal(totals.totalSupplyBase);
    expect(t0.totalBorrowBase).to.be.equal(totals.totalBorrowBase);

    expect(t1.lastAccrualTime).to.be.equal(now);
    expect(t2.lastAccrualTime).to.be.equal(now);
    expect(t2.baseSupplyIndex).to.be.equal(t1.baseSupplyIndex);
    expect(t2.baseBorrowIndex).to.be.equal(t1.baseBorrowIndex);
    expect(t2.trackingSupplyIndex).to.be.equal(t1.trackingSupplyIndex);
    expect(t2.trackingBorrowIndex).to.be.equal(t1.trackingBorrowIndex);
    expect(t2.totalSupplyBase).to.be.equal(t1.totalSupplyBase);
    expect(t2.totalSupplyBase).to.be.equal(t1.totalSupplyBase);
  });

  it('accrues correctly with time elapsed and less than min rewards', async () => {
    // XXX
  });

  it('accrues correctly with time elapsed and more than min rewards', async () => {
    // XXX
  });

  it('reverts on overflows', async () => {
    // XXX
  });

  it('supports up to the maximum timestamp then breaks', async () => {
    // XXX
  });
});
