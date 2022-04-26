import { ethers, expect } from './helpers';
import {
  Fauceteer,
  Fauceteer__factory
} from '../build/types';

async function makeFauceteer() {
  const FauceteerFactory = (await ethers.getContractFactory('Fauceteer')) as Fauceteer__factory;
  const fauceteer = FauceteerFactory.deploy();
  return fauceteer;
}

describe.only('Fauceteer', function () {
  // DELETE
  it('runs a test', async () => {
    const fauceteer = await makeFauceteer();
    expect(true).to.be.true;
  });
});