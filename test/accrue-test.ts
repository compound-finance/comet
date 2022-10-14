import { ethers, expect, exp, fastForward, getBlock, makeProtocol, wait, setTotalsBasic } from './helpers';

function projectBaseIndex(index, rate, time, factorScale = exp(1, 18)) {
  return index.add(index.mul(rate.mul(time)).div(factorScale));
}

function projectTrackingIndex(index, speed, time, base, baseScale = exp(1, 6)) {
  return index.add(speed.mul(time).mul(baseScale).div(base));
}

describe('accrue', function () {
  it('fails if baseMinForRewards = 0', async () => {
    await expect(
      makeProtocol({
        baseMinForRewards: 0,
      })
    ).to.be.revertedWith("custom error 'BadMinimum()'");
  });

  it('accrue initially succeeds and has the right parameters', async () => {
    await ethers.provider.send('hardhat_reset', []); // ensure clean start...

    const start = (await getBlock()).timestamp + 100;

    const params = {
      baseMinForRewards: 12331,
      baseTrackingSupplySpeed: 668,
      baseTrackingBorrowSpeed: 777,
      start
    };
    const { comet } = await makeProtocol(params);

    const t0 = await comet.totalsBasic();
    expect(t0.trackingSupplyIndex).to.be.equal(0);
    expect(t0.trackingBorrowIndex).to.be.equal(0);
    expect(t0.baseSupplyIndex).to.be.equal(exp(1, 15));
    expect(t0.baseBorrowIndex).to.be.equal(exp(1, 15));
    expect(t0.totalSupplyBase).to.be.equal(0);
    expect(t0.totalBorrowBase).to.be.equal(0);

    expect(t0.lastAccrualTime).to.equal(start);

    const _a0 = await wait(comet.accrue());
    expect(await comet.baseMinForRewards()).to.be.equal(params.baseMinForRewards);
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(params.baseTrackingSupplySpeed);
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(params.baseTrackingBorrowSpeed);
  });

  it('accrues correctly with no time elapsed', async () => {
    const { comet } = await makeProtocol();

    const now = Math.floor(Date.now() / 1000);
    const _f0 = await wait(comet.setNow(now)); // this freezes the timestamp for the entire test

    const totals = {
      trackingSupplyIndex: 0,
      trackingBorrowIndex: 0,
      baseSupplyIndex: 2e15,
      baseBorrowIndex: 3e15,
      totalSupplyBase: 1000n,
      totalBorrowBase: 1000n,
      lastAccrualTime: 0,
      pauseFlags: 0,
    };
    const _s0 = await wait(comet.setTotalsBasic(totals));

    const t0 = await comet.totalsBasic();
    const _a1 = await wait(comet.accrue());
    const t1 = await comet.totalsBasic();
    const _a2 = await wait(comet.accrue());
    const t2 = await comet.totalsBasic();

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
    await ethers.provider.send('hardhat_reset', []); // ensure clean start...

    const start = (await getBlock()).timestamp + 100;
    const params = {
      baseMinForRewards: 12000n,
      trackingIndexScale: exp(1, 15),
      start,
    };
    const { comet } = await makeProtocol(params);

    const t1 = await setTotalsBasic(comet, {
      totalSupplyBase: 11000n,
      totalBorrowBase: 11000n,
    });

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate(utilization);
    const borrowRate = await comet.getBorrowRate(utilization);

    await ethers.provider.send('evm_setAutomine', [false]);
    const _a1 = await comet.accrue();
    await ethers.provider.send('evm_mine', [start + 1000]);
    await ethers.provider.send('evm_setAutomine', [true]);

    const t2 = await comet.totalsBasic();

    const timeElapsed = t2.lastAccrualTime - t1.lastAccrualTime;
    expect(timeElapsed).to.be.equal(1000);

    expect(t2.baseSupplyIndex).to.be.equal(projectBaseIndex(t1.baseSupplyIndex, supplyRate, timeElapsed));
    expect(t2.baseBorrowIndex).to.be.equal(projectBaseIndex(t1.baseBorrowIndex, borrowRate, timeElapsed));
    expect(t2.trackingSupplyIndex).to.be.equal(t1.trackingSupplyIndex);
    expect(t2.trackingBorrowIndex).to.be.equal(t1.trackingBorrowIndex);
  });

  it('accrues correctly with time elapsed and more than min rewards', async () => {
    await ethers.provider.send('hardhat_reset', []); // ensure clean start...

    const start = (await getBlock()).timestamp + 100;
    const params = {
      baseMinForRewards: exp(12000, 6),
      trackingIndexScale: exp(1, 15),
      start,
    };
    const { comet } = await makeProtocol(params);

    const t0 = await comet.totalsBasic();
    const t1 = await setTotalsBasic(comet, {
      totalSupplyBase: exp(14000, 6),
      totalBorrowBase: exp(13000, 6),
    });

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate(utilization);
    const borrowRate = await comet.getBorrowRate(utilization);

    await ethers.provider.send('evm_setAutomine', [false]);
    const _a1 = await comet.accrue();
    await ethers.provider.send('evm_mine', [start + 1000]);
    await ethers.provider.send('evm_setAutomine', [true]);

    const t2 = await comet.totalsBasic();

    const supplySpeed = await comet.baseTrackingSupplySpeed();
    expect(supplySpeed).to.be.equal(params.trackingIndexScale);

    const borrowSpeed = await comet.baseTrackingBorrowSpeed();
    expect(borrowSpeed).to.be.equal(params.trackingIndexScale);

    const timeElapsed = t2.lastAccrualTime - t0.lastAccrualTime;
    expect(timeElapsed).to.be.equal(1000);

    expect(t2.baseSupplyIndex).to.be.equal(projectBaseIndex(t1.baseSupplyIndex, supplyRate, timeElapsed));
    expect(t2.baseBorrowIndex).to.be.equal(projectBaseIndex(t1.baseBorrowIndex, borrowRate, timeElapsed));
    expect(t2.trackingSupplyIndex).to.be.equal(projectTrackingIndex(t1.trackingSupplyIndex, supplySpeed, timeElapsed, t1.totalSupplyBase));
    expect(t2.trackingBorrowIndex).to.be.equal(projectTrackingIndex(t1.trackingBorrowIndex, borrowSpeed, timeElapsed, t1.totalBorrowBase));
  });

  it('overflows if baseMinRewards is set too low and accrues no interest', async () => {
    const params = {
      baseMinForRewards: 12000,
      trackingIndexScale: exp(1, 15),
    };
    const { comet } = await makeProtocol(params);

    const t0 = await comet.totalsBasic();
    const t1 = Object.assign({}, t0, {
      totalSupplyBase: 14000,
      totalBorrowBase: 13000,
    });
    await fastForward(998);
    const _s0 = await wait(comet.setTotalsBasic(t1));
    await fastForward(2);
    await expect(wait(comet.accrue())).to.be.revertedWith("custom error 'InvalidUInt64()'");
    const t2 = await comet.totalsBasic();

    const utilization = await comet.getUtilization();
    const supplyRate = await comet.getSupplyRate(utilization);
    const borrowRate = await comet.getBorrowRate(utilization);
    const timeElapsed = t2.lastAccrualTime - t0.lastAccrualTime;
    expect(timeElapsed).to.be.equal(0);

    expect(t2.baseSupplyIndex).to.be.equal(projectBaseIndex(t1.baseSupplyIndex, supplyRate, timeElapsed));
    expect(t2.baseBorrowIndex).to.be.equal(projectBaseIndex(t1.baseBorrowIndex, borrowRate, timeElapsed));
    expect(t2.trackingSupplyIndex).to.be.equal(t1.trackingSupplyIndex);
    expect(t2.trackingBorrowIndex).to.be.equal(t1.trackingBorrowIndex);
  });

  it('reverts on overflows', async () => {
    const { comet } = await makeProtocol();

    const t0 = await comet.totalsBasic();
    const t1 = Object.assign({}, t0, {
      baseSupplyIndex: 2n ** 64n - 1n,
      totalSupplyBase: 14000,
      totalBorrowBase: 13000, // needs to have positive utilization for supply rate to be > 0
    });
    await fastForward(998);
    const _s0 = await wait(comet.setTotalsBasic(t1));
    await fastForward(2);
    await expect(wait(comet.accrue())).to.be.revertedWith('code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');

    const t2 = Object.assign({}, t0, {
      baseBorrowIndex: 2n ** 64n - 1n,
    });
    await fastForward(998);
    const _s1 = await wait(comet.setTotalsBasic(t2));
    await fastForward(2);
    await expect(wait(comet.accrue())).to.be.revertedWith('code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
  });

  it('supports up to the maximum timestamp then breaks', async () => {
    const { comet } = await makeProtocol();

    await fastForward(100);
    const _a0 = await wait(comet.accrue());

    await fastForward(2 ** 40);
    await expect(wait(comet.accrue())).to.be.revertedWith("custom error 'TimestampTooLarge()'");
    await ethers.provider.send('hardhat_reset', []); // dont break downstream tests...
  });
});

describe('accrueAccount', function () {
  it('has no effect when called on an address with no protocol activity', async () => {
    const { comet, users: [unusedAccount] } = await makeProtocol();

    const userBasic0 = await comet.userBasic(unusedAccount.address);
    await comet.accrueAccount(unusedAccount.address);
    const userBasic1 = await comet.userBasic(unusedAccount.address);

    expect(userBasic0).to.deep.equal(userBasic1);
    expect(userBasic1.principal).to.eq(0);
    expect(userBasic1.baseTrackingIndex).to.eq(0);
    expect(userBasic1.baseTrackingAccrued).to.eq(0);
    expect(userBasic1.assetsIn).to.eq(0);
  });
});