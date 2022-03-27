import { ethers, expect, makeProtocol } from './helpers';

describe.only('CometRewards', () => {
  it('does not overflow when calculating trackingSupplyIndex', async () => {
    const {
      comet,
      tokens: { USDC },
      users: [alice],
    } = await makeProtocol({
      baseMinForRewards: 1 // lowest threshold for earning rewards
    });

    // allocate and approve transfers
    await USDC.allocateTo(alice.address, 2e6);
    await USDC.connect(alice).approve(comet.address, 2e6);

    // supply once
    await comet.connect(alice).supply(USDC.address, 1e6);

    const oneYear = 60 * 60 * 24 * 365;
    await ethers.provider.send('evm_increaseTime', [oneYear]);

    await expect(comet.accrue()).to.not.be.reverted;

    // should work on repeat accrues
    for (let i = 0; i < 100; i++) {
      await expect(comet.accrue()).to.not.be.reverted;
    }
  });
});