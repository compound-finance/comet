import { expect, exp } from '../helpers';
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
    const { comet, liquidator, users: [owner, underwater], assets: { dai, usdc } } = await makeLiquidatableProtocol();
    // underwater user approves Comet
    await dai.connect(underwater).approve(comet.address, 120000000000000000000n);
    // underwater user supplies DAI to Comet
    await comet.connect(underwater).supply(dai.address, 120000000000000000000n); //
    // artificially put in an underwater borrow position
    await comet.setBasePrincipal(underwater.address, -(exp(200, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(dai.address),
      poolFee: 500,
      reversedPair: false,
    });

    expect(tx.hash).to.be.not.null;
    const afterUSDCBalance = await usdc.balanceOf(owner.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
  });

  it('Should execute WETH flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, weth } } = await makeLiquidatableProtocol();
    await weth.connect(underwater).approve(comet.address, 120000000000000000000n);
    await comet.connect(underwater).supply(weth.address, 120000000000000000000n); //
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
  });

  it('Should execute WBTC flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, wbtc } } = await makeLiquidatableProtocol();
    await wbtc.connect(underwater).approve(comet.address, 200000000n);
    await comet.connect(underwater).supply(wbtc.address, 200000000n);
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
  });

  it('Should execute UNI flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, uni } } = await makeLiquidatableProtocol();
    await uni.connect(underwater).approve(comet.address, exp(120, 18));
    await comet.connect(underwater).supply(uni.address, exp(120, 18)); //
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
  });

  it('Should execute COMP flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, comp } } = await makeLiquidatableProtocol();
    await comp.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(comp.address, exp(12, 18)); //
    await comet.setBasePrincipal(underwater.address, -(exp(40000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
  });

  it('Should execute LINK flash swap with profit', async () => {
    const { comet, liquidator, users: [owner, underwater], assets: { usdc, link } } = await makeLiquidatableProtocol();
    await link.connect(underwater).approve(comet.address, exp(12, 18));
    await comet.connect(underwater).supply(link.address, exp(12, 18)); //
    await comet.setBasePrincipal(underwater.address, -(exp(4000, 6)));

    const beforeUSDCBalance = await usdc.balanceOf(owner.address);
    const tx = await liquidator.connect(owner).initFlash({
      accounts: [underwater.address],
      pairToken: ethers.utils.getAddress(DAI),
      poolFee: 500,
      reversedPair: false,
    });

    const afterUSDCBalance = await usdc.balanceOf(owner.address);
    const profit = afterUSDCBalance - beforeUSDCBalance;
    expect(tx.hash).to.be.not.null;
    expect(profit).to.be.greaterThan(0);
  });

  it('Successful execution should increase base token balance of liquidating user', async () => {
    const {
      comet,
      liquidator,
      users: [owner, underwater],
      assets: { dai, usdc }
    } = await makeLiquidatableProtocol();

    // underwater user approves Comet
    await dai.connect(underwater).approve(comet.address, 120000000000000000000n);
    // underwater user supplies DAI to Comet
    await comet.connect(underwater).supply(dai.address, 120000000000000000000n); //
    // artificially put in an underwater borrow position
    await comet.setBasePrincipal(underwater.address, -(exp(200, 6)));

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