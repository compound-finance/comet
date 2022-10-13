import { ethers, exp, expect, fastForward } from './helpers';
import {
  Fauceteer,
  Fauceteer__factory,
  FaucetToken__factory
} from '../build/types';

async function makeFauceteer() {
  const FauceteerFactory = (await ethers.getContractFactory('Fauceteer')) as Fauceteer__factory;
  const fauceteer = await FauceteerFactory.deploy() as Fauceteer;

  const FaucetTokenFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;

  return {
    fauceteer,
    tokens: {
      COMP: await FaucetTokenFactory.deploy(1e6, 'COMP', 18, 'COMP'),
      USDC: await FaucetTokenFactory.deploy(1e6, 'USDC', 6, 'USDC')
    }
  };
}

describe('Fauceteer', function () {
  it('issues .01% of balance of requested asset to requester', async () => {
    const [_minter, requester] = await ethers.getSigners();
    const { fauceteer, tokens: { USDC, COMP } } = await makeFauceteer();
    await USDC.allocateTo(fauceteer.address, exp(100, 6));
    await COMP.allocateTo(fauceteer.address, exp(100, 18));

    expect(await USDC.balanceOf(requester.address)).to.eq(0);
    expect(await COMP.balanceOf(requester.address)).to.eq(0);

    await fauceteer.connect(requester).drip(USDC.address);
    await fauceteer.connect(requester).drip(COMP.address);

    // fauceter maintains 99.99 units of USDC
    expect(await USDC.balanceOf(fauceteer.address)).to.eq(99990000n);
    // requester gets .01 units (10000 / 1e6 == .01)
    expect(await USDC.balanceOf(requester.address)).to.eq(10000n);

    // fauceter maintains 99.99% of initial COMP balance
    expect(await COMP.balanceOf(fauceteer.address)).to.eq(99990000000000000000n);
    // requester gets .01 units (10000000000000000 / 1e18 == .01)
    expect(await COMP.balanceOf(requester.address)).to.eq(10000000000000000n);
  });

  it('throws an error if balance of asset is 0', async () => {
    const [_minter, requester] = await ethers.getSigners();
    const { fauceteer, tokens: { USDC } } = await makeFauceteer();

    expect(await USDC.balanceOf(requester.address)).to.eq(0);

    await expect(
      fauceteer.connect(requester).drip(USDC.address)
    ).to.be.revertedWith("custom error 'BalanceTooLow()'");
  });

  it('limits each address to one request per asset per day', async () => {
    const [_minter, r1, r2] = await ethers.getSigners();
    const { fauceteer, tokens: { USDC, COMP } } = await makeFauceteer();

    await USDC.allocateTo(fauceteer.address, exp(500, 6));
    await COMP.allocateTo(fauceteer.address, exp(500, 18));

    expect(await USDC.balanceOf(r1.address)).to.eq(0);
    expect(await COMP.balanceOf(r1.address)).to.eq(0);
    expect(await USDC.balanceOf(r2.address)).to.eq(0);
    expect(await COMP.balanceOf(r2.address)).to.eq(0);

    // first requester receives tokens
    await fauceteer.connect(r1).drip(USDC.address);
    expect(await USDC.balanceOf(r1.address)).to.eq(50000n);
    await fauceteer.connect(r1).drip(COMP.address);
    expect(await COMP.balanceOf(r1.address)).to.eq(50000000000000000n);

    // repeated request fails
    await expect(
      fauceteer.connect(r1).drip(USDC.address)
    ).to.be.revertedWith("custom error 'RequestedTooFrequently()'");
    await expect(
      fauceteer.connect(r1).drip(COMP.address)
    ).to.be.revertedWith("custom error 'RequestedTooFrequently()'");

    // does not prevent other requesters from receiving tokens
    await fauceteer.connect(r2).drip(USDC.address);
    await fauceteer.connect(r2).drip(COMP.address);

    // wait a day and you can request more
    await fastForward(60 * 60 * 24);
    await fauceteer.connect(r1).drip(USDC.address);
    await fauceteer.connect(r1).drip(COMP.address);
  });
});