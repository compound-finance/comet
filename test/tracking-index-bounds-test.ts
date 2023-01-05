import { expect, exp, fastForward, makeProtocol, setTotalsBasic, toYears } from './helpers';
import { BigNumber } from 'ethers';

describe('total tracking index bounds', function () {
  describe('base scale of 6', function () {
    it('upper bound hit on tracking supply index', async () => {
      const baseMinForRewards = exp(10_000, 6); // 10k USDC
      const params = {
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(1, 15),
        baseTrackingBorrowSpeed: exp(1, 15),
        baseMinForRewards
      };
      const protocol = await makeProtocol(params);
      const { comet } = protocol;

      const baseScale = (await comet.baseScale()).toBigInt();
      // Formula: MAX_UINT64 / (baseTrackingSupplySpeed * baseScale / baseMinForRewards)
      const secondsUntilOverflow = Number(2n**64n * (baseMinForRewards / baseScale) / params.baseTrackingSupplySpeed);

      // Assert there are at least 5.85 years until tracking index can overflow
      const expectedYearsUntilOverflow = 5.85;
      expect(toYears(secondsUntilOverflow)).to.be.approximately(expectedYearsUntilOverflow, 0.01);

      await setTotalsBasic(comet, {
        totalSupplyBase: BigNumber.from(baseMinForRewards), // 10k USDC base units
      });

      await fastForward(secondsUntilOverflow-1);

      // First accrue is successful without overflow
      await comet.accrue();

      // Second accrue should overflow
      await expect(comet.accrue()).to.be.revertedWith('code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
    });

    it('upper bound hit on tracking borrow index', async () => {
      const baseMinForRewards = exp(10_000, 6); // 10k USDC
      const params = {
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(1, 15),
        baseTrackingBorrowSpeed: exp(1, 15),
        baseMinForRewards
      };
      const protocol = await makeProtocol(params);
      const { comet } = protocol;

      const baseScale = (await comet.baseScale()).toBigInt();
      // Formula: MAX_UINT64 / (baseTrackingBorrowSpeed * baseScale / baseMinForRewards)
      const secondsUntilOverflow = Number(2n**64n * (baseMinForRewards / baseScale) / params.baseTrackingBorrowSpeed);

      // Assert there are at least 5.85 years until tracking index can overflow
      const expectedYearsUntilOverflow = 5.85;
      expect(toYears(secondsUntilOverflow)).to.be.approximately(expectedYearsUntilOverflow, 0.01);

      await setTotalsBasic(comet, {
        totalBorrowBase: BigNumber.from(baseMinForRewards), // 10k USDC base units
      });

      await fastForward(secondsUntilOverflow-1);

      // First accrue is successful without overflow
      await comet.accrue();

      // Second accrue should overflow
      await expect(comet.accrue()).to.be.revertedWith('code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
    });

    it('lower bound hit on tracking supply index', async () => {
      const params = {
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(1, 15),
        baseTrackingBorrowSpeed: exp(1, 15),
      };
      const protocol = await makeProtocol(params);
      const { comet } = protocol;

      const t0 = await setTotalsBasic(comet, {
        totalSupplyBase: BigNumber.from(exp(1, 15)).mul(await comet.baseScale()), // 1e15 base units
      });

      await comet.accrue();
      const t1 = await comet.totalsBasic();

      // Tracking index should properly accrue
      expect(t1.trackingSupplyIndex).to.not.be.equal(t0.trackingSupplyIndex);

      const t2 = await setTotalsBasic(comet, {
        totalSupplyBase: BigNumber.from(exp(1, 15)).mul(await comet.baseScale()).mul(3), // 3e15 base units
      });

      await comet.accrue();
      const t3 = await comet.totalsBasic();

      // Lower bound has hit and tracking index no longer accrues
      expect(t3.trackingSupplyIndex).to.be.equal(t2.trackingSupplyIndex);
    });

    it('lower bound hit on tracking borrow index', async () => {
      const params = {
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(1, 15),
        baseTrackingBorrowSpeed: exp(1, 15),
      };
      const protocol = await makeProtocol(params);
      const { comet } = protocol;

      const t0 = await setTotalsBasic(comet, {
        totalBorrowBase: BigNumber.from(exp(1, 15)).mul(await comet.baseScale()), // 1e15 base units
      });

      await comet.accrue();
      const t1 = await comet.totalsBasic();

      // Tracking index should properly accrue
      expect(t1.trackingBorrowIndex).to.not.be.equal(t0.trackingBorrowIndex);

      const t2 = await setTotalsBasic(comet, {
        totalBorrowBase: BigNumber.from(exp(1, 15)).mul(await comet.baseScale()).mul(3), // 3e15 base units
      });

      await comet.accrue();
      const t3 = await comet.totalsBasic();

      // Lower bound has hit and tracking index no longer accrues
      expect(t3.trackingBorrowIndex).to.be.equal(t2.trackingBorrowIndex);
    });
  });

  describe('base scale of 18', function () {
    it('upper bound hit on tracking supply index', async () => {
      const baseMinForRewards = exp(100, 18); // 100 WETH
      const params = {
        base: 'WETH',
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(0.001, 15), // 86.4 units/day
        baseTrackingBorrowSpeed: exp(0.001, 15),
        baseMinForRewards
      };
      const protocol = await makeProtocol(params);
      const { comet } = protocol;

      const baseScale = (await comet.baseScale()).toBigInt();
      // Formula: MAX_UINT64 / (baseTrackingSupplySpeed * baseScale / baseMinForRewards)
      const secondsUntilOverflow = Number(2n**64n * (baseMinForRewards / baseScale) / params.baseTrackingSupplySpeed);

      // Assert there are at least 58.5 years until tracking index can overflow
      const expectedYearsUntilOverflow = 58.5;
      expect(toYears(secondsUntilOverflow)).to.be.approximately(expectedYearsUntilOverflow, 0.01);

      await setTotalsBasic(comet, {
        totalSupplyBase: BigNumber.from(baseMinForRewards), // 100 WETH base units
      });

      await fastForward(secondsUntilOverflow-1);

      // First accrue is successful without overflow
      await comet.accrue();

      // Second accrue should overflow
      await expect(comet.accrue()).to.be.revertedWith('code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
    });

    it('upper bound hit on tracking borrow index', async () => {
      const baseMinForRewards = exp(100, 18); // 100 WETH
      const params = {
        base: 'WETH',
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(0.001, 15), // 86.4 units/day
        baseTrackingBorrowSpeed: exp(0.001, 15),
        baseMinForRewards
      };
      const protocol = await makeProtocol(params);
      const { comet } = protocol;

      const baseScale = (await comet.baseScale()).toBigInt();
      // Formula: MAX_UINT64 / (baseTrackingBorrowSpeed * baseScale / baseMinForRewards)
      const secondsUntilOverflow = Number(2n**64n * (baseMinForRewards / baseScale) / params.baseTrackingBorrowSpeed);

      // Assert there are at least 58.5 years until tracking index can overflow
      const expectedYearsUntilOverflow = 58.5;
      expect(toYears(secondsUntilOverflow)).to.be.approximately(expectedYearsUntilOverflow, 0.01);

      await setTotalsBasic(comet, {
        totalBorrowBase: BigNumber.from(baseMinForRewards), // 10k USDC base units
      });

      await fastForward(secondsUntilOverflow-1);

      // First accrue is successful without overflow
      await comet.accrue();

      // Second accrue should overflow
      await expect(comet.accrue()).to.be.revertedWith('code 0x11 (Arithmetic operation underflowed or overflowed outside of an unchecked block)');
    });

    it('lower bound hit on tracking supply index', async () => {
      const params = {
        base: 'WETH',
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(0.001, 15), // 86.4 units/day
        baseTrackingBorrowSpeed: exp(0.001, 15),
      };
      const protocol = await makeProtocol(params);
      const { comet } = protocol;

      const t0 = await setTotalsBasic(comet, {
        totalSupplyBase: BigNumber.from(exp(1, 12)).mul(await comet.baseScale()), // 1e12 base units
      });

      await comet.accrue();
      const t1 = await comet.totalsBasic();

      // Tracking index should properly accrue
      expect(t1.trackingSupplyIndex).to.not.be.equal(t0.trackingSupplyIndex);

      const t2 = await setTotalsBasic(comet, {
        totalSupplyBase: BigNumber.from(exp(1, 13)).mul(await comet.baseScale()), // 1e13 base units
      });

      await comet.accrue();
      const t3 = await comet.totalsBasic();

      // Lower bound has hit and tracking index no longer accrues
      expect(t3.trackingSupplyIndex).to.be.equal(t2.trackingSupplyIndex);
    });

    it('lower bound hit on tracking borrow index', async () => {
      const params = {
        base: 'WETH',
        trackingIndexScale: exp(1, 15),
        baseTrackingSupplySpeed: exp(0.001, 15), // 86.4 units/day
        baseTrackingBorrowSpeed: exp(0.001, 15),
      };
      const protocol = await makeProtocol(params);
      const { comet } = protocol;

      const t0 = await setTotalsBasic(comet, {
        totalBorrowBase: BigNumber.from(exp(1, 12)).mul(await comet.baseScale()), // 1e12 base units
      });

      await comet.accrue();
      const t1 = await comet.totalsBasic();

      // Tracking index should properly accrue
      expect(t1.trackingBorrowIndex).to.not.be.equal(t0.trackingBorrowIndex);

      const t2 = await setTotalsBasic(comet, {
        totalBorrowBase: BigNumber.from(exp(1, 13)).mul(await comet.baseScale()), // 1e13 base units
      });

      await comet.accrue();
      const t3 = await comet.totalsBasic();

      // Lower bound has hit and tracking index no longer accrues
      expect(t3.trackingBorrowIndex).to.be.equal(t2.trackingBorrowIndex);
    });
  });
});


describe('user tracking index bounds', function () {
  // XXX test if small supply/borrow causes users to not accrue rewards
});