import { ethers, exp, expect } from './helpers';
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
      USDC: await FaucetTokenFactory.deploy(1e6, 'USDC', 18, 'USDC')
    }
  };
}

describe.only('Fauceteer', function () {
  it('issues a small amount of requested token to requester', async () => {
    const [_minter, requester] = await ethers.getSigners();
    const { fauceteer, tokens: { USDC } } = await makeFauceteer();
    // expect(true).to.be.true;
    await USDC.allocateTo(fauceteer.address, exp(100, 18));

    expect(await USDC.balanceOf(requester.address)).to.eq(0);

    await fauceteer.connect(requester).drip(USDC.address);

    expect(await USDC.balanceOf(fauceteer.address)).to.eq(99990000000000000000n); // 99.99% of initial balance
    expect(await USDC.balanceOf(requester.address)).to.eq(10000000000000000n); // .01% of initial balance
  });

  it.skip('throws an error if transfer fails', async () => {

  });


  it.skip('throws an error if it has none of asset', async () => {

  });
});