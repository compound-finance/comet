import { expect } from '../helpers';
import { ethers } from 'hardhat';
import makeLiquidatableProtocol, { forkMainnet, resetHardhatNetwork } from './makeLiquidatableProtocol';
import { DAI } from './addresses';

describe('Liquidator', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  // it('Should init liquidator', async function () {
  //   expect(await liquidator.swapRouter()).to.equal(swapRouter);
  // });

  it('Should execute DAI flash swap', async () => {
    const { comet, liquidator, users: [owner, underwater] } = await makeLiquidatableProtocol();

    // console.log(`BEFORE mockUSDC.balanceOf(owner.address): ${await mockUSDC.balanceOf(owner.address)}`);

    const tx = await liquidator.connect(owner).initFlash({
      // XXX add accounts
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    // console.log(`AFTER mockUSDC.balanceOf(owner.address): ${await mockUSDC.balanceOf(owner.address)}`);

    // XXX test the liquidating user's balance before and after

    expect(tx.hash).to.be.not.null;
  });
});