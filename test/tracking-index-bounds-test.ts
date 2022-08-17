import { expect, exp, fastForward, makeProtocol, setTotalsBasic, toYears, wait } from './helpers';
import { BigNumber } from 'ethers';

describe('total tracking index bounds', function () {
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

  it('upper bound hit on borrow supply index', async () => {
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


describe('user tracking index bounds', async () => {
  // XXX test if small supply/borrow causes users to not accrue rewards

  it('small supply causes user to not accrue rewards', async () => {
    const {
      comet, tokens, users: [alice]
    } = await makeProtocol({
      base: 'USDC',
      trackingIndexScale: 1e15,
      baseTrackingSupplySpeed: 1e8, // supplySpeed=0.0000001 (1e-7) Comp/s
    });
    const { USDC } = tokens;

    // allocate and approve transfers
    await USDC.allocateTo(alice.address, 1e6);
    await USDC.connect(alice).approve(comet.address, 1e6);

    // supply
    await comet.connect(alice).supply(USDC.address, 1e6);

    const userBasic1 = await comet.userBasic(alice.address);
    expect(userBasic1.principal).to.eq(1_000_000);
    expect(userBasic1.baseTrackingAccrued).to.eq(0);

    // allow 20 years to pass
    await fastForward(20 * 31536000);

    await comet.accrue();

    const userBasic2 = await comet.userBasic(alice.address);
    expect(userBasic2.baseTrackingAccrued).to.eq(0);
  });

  it('small borrow causes user to not accrue rewards', async () => {
    const {
      comet, tokens, users: [bob]
    } = await makeProtocol({
      base: 'USDC',
      trackingIndexScale: 1e15,
      baseTrackingSupplySpeed: 1e8, // supplySpeed=0.0000001 (1e-7) Comp/s
    });
    const { USDC } = tokens;

    await USDC.allocateTo(comet.address, 1e6);
    await setTotalsBasic(comet, {
      totalSupplyBase: 100e6,
    });

    await comet.setBasePrincipal(bob.address, 1e6);
    const cometAsB = comet.connect(bob);

    await wait(cometAsB.withdraw(USDC.address, 1e6));

    // allow 20 years to pass
    await fastForward(20 * 31536000);

    await comet.accrue();

    const userBasic = await comet.userBasic(bob.address);
    expect(userBasic.baseTrackingAccrued).to.eq(0);
  });

});