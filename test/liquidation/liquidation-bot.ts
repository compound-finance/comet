import { expect } from '../helpers';
import { ethers } from 'hardhat';
import makeLiquidatableProtocol, { forkMainnet, resetHardhatNetwork } from './makeLiquidatableProtocol';
import { DAI } from './addresses';
import { SWAP_ROUTER } from './addresses';

describe('Liquidator', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  it('Should init liquidator', async function () {
    const { liquidator } = await makeLiquidatableProtocol();
    expect(await liquidator.swapRouter()).to.equal(SWAP_ROUTER);
  });

  it('Should execute DAI flash swap', async () => {
    const { liquidator, users: [owner, underwater] } = await makeLiquidatableProtocol();

    const tx = await liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    expect(tx.hash).to.be.not.null;
  });

  it('Successful execution should increase base token balance of liquidating user', async () => {
    const {
      liquidator,
      users: [owner, underwater],
      assets: { usdc }
    } = await makeLiquidatableProtocol();

    const baseBalanceBefore = await usdc.balanceOf(owner.address);

    await liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    const baseBalanceAfter = await usdc.balanceOf(owner.address);

    expect(baseBalanceAfter.toNumber()).to.be.greaterThan(baseBalanceBefore.toNumber());
  });
});