import { ethers, expect, makeProtocol } from './helpers';

describe('getNow', function () {
  it('reverts if timestamp overflows', async () => {
    const { comet } = await makeProtocol();
    await ethers.provider.send('evm_mine', [2**40]);
    await expect(comet.getNow()).to.be.revertedWith('timestamp exceeds size (40 bits)');
    await ethers.provider.send('hardhat_reset', []); // dont break downstream tests...
  });
});
