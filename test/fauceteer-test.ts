import { ethers, exp, expect, fastForward } from './helpers';
import {
  Fauceteer,
  Fauceteer__factory,
  FaucetToken,
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

describe.only('Fauceteer', function () {
  it('issues a small amount of requested token to requester', async () => {
    const [_minter, requester] = await ethers.getSigners();
    const { fauceteer, tokens: { USDC } } = await makeFauceteer();
    await USDC.allocateTo(fauceteer.address, exp(100, 6));

    expect(await USDC.balanceOf(requester.address)).to.eq(0);

    await fauceteer.connect(requester).drip(USDC.address);

    expect(await USDC.balanceOf(fauceteer.address)).to.eq(99990000n); // 99.99% of initial balance
    expect(await USDC.balanceOf(requester.address)).to.eq(10000n); // .01% of initial balance
  });

  it('throws an error if balance of asset is 0', async () => {
    const [_minter, requester] = await ethers.getSigners();
    const { fauceteer, tokens: { USDC } } = await makeFauceteer();

    expect(await USDC.balanceOf(requester.address)).to.eq(0);

    await expect(
      fauceteer.connect(requester).drip(USDC.address)
    ).to.be.revertedWith('BalanceTooLow()');
  });

  it.only('limits each address to one request per asset per day', async () => {
    const [_minter, requester] = await ethers.getSigners();
    const { fauceteer, tokens: { USDC } } = await makeFauceteer();
    await USDC.allocateTo(fauceteer.address, exp(100, 6));

    expect(await USDC.balanceOf(requester.address)).to.eq(0);

    await fauceteer.connect(requester).drip(USDC.address);
    expect(await USDC.balanceOf(requester.address)).to.eq(10000n);

    // immediate request fails
    await expect(
      fauceteer.connect(requester).drip(USDC.address)
    ).to.be.revertedWith('RequestedTooFrequently()');

    // wait a day and you can request more
    await fastForward(60 * 60 * 24);
    await fauceteer.connect(requester).drip(USDC.address);

    expect(await USDC.balanceOf(requester.address)).to.eq(19999n);
  });


  it.skip('issues multiple assets', async () => {

  });

  it.skip('throws an error if transfer fails', async () => {

  });
});