import { event, expect, exp, wait } from '../helpers';
import { ethers } from 'hardhat';
import makeLiquidatableProtocol, { forkMainnet, resetHardhatNetwork } from './makeLiquidatableProtocol';
import { DAI } from './addresses';
import { SWAP_ROUTER } from './addresses';

describe('Liquidator', function () {
  before(forkMainnet);
  after(resetHardhatNetwork);

  it('Should init liquidator', async function () {
    const { comet, liquidator } = await makeLiquidatableProtocol();
    expect(await liquidator.swapRouter()).to.equal(SWAP_ROUTER);
    expect(await liquidator.comet()).to.equal(comet.address);
  });

  it('Should execute DAI flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { dai, usdc } } = await makeLiquidatableProtocol();
    // underwater user approves Comet
    await dai.connect(underwater).approve(comet.address, exp(120, 18));
    // underwater user supplies DAI to Comet
    await comet.connect(underwater).supply(dai.address, exp(120, 18));
    // artificially put in an underwater borrow position
    await comet.setBasePrincipal(underwater.address, -(exp(200, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(dai.address),
      poolFee: 100,
    }));


    expect(tx.hash).to.be.not.null;
    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute WETH flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, weth } } = await makeLiquidatableProtocol();
    await weth.connect(underwater).approve(comet.address, exp(120, 18));
    await comet.connect(underwater).supply(weth.address, exp(120, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute WBTC flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, wbtc } } = await makeLiquidatableProtocol();
    await wbtc.connect(underwater).approve(comet.address, exp(2, 8));
    await comet.connect(underwater).supply(wbtc.address, exp(2, 8));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute UNI flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, uni } } = await makeLiquidatableProtocol();
    await uni.connect(underwater).approve(comet.address, exp(120, 18));
    await comet.connect(underwater).supply(uni.address, exp(120, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100,
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute COMP flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, comp } } = await makeLiquidatableProtocol();
    await comp.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(comp.address, exp(12, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100,
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

  it('Should execute LINK flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater, recipient], assets: { usdc, link } } = await makeLiquidatableProtocol();
    await link.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(link.address, exp(12, 18));
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(recipient.address);
    const tx = await wait(liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 100
    }));

    const afterUSDCBalance = await usdc.balanceOf(recipient.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
    expect(event(tx, 2)).to.deep.equal({
      Absorb: {
        initiator: owner.address,
        accounts: [ underwater.address ]
      }
    });
  });

});