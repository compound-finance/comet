import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { exp } from '../test/helpers';
import { BigNumber } from 'ethers';

// XXX requires balances
scenario(
  'Comet#transfer > collateral asset, enough balance',
  {
    upgrade: true,
    balances: {
      // albert: { COMP: exp(101, 18) },
    }
  },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;
    // XXX
    //await albert.transfer(betty, COMP, exp(100, 18));
  });

scenario(
  'Comet#transfer > partial withdraw / borrow base to partial repay / supply',
  {
    upgrade: true,
    balances: {
      // albert: { USDC: exp(50, 6) },
      // betty: { USDC: exp(-50, 6) }
    }
   },
  async ({ comet, actors }) => {
    const { albert, betty } = actors;
    // XXX
    //await albert.transfer(betty, USDC, exp(100, 6));
  });

scenario(
  'Comet#transferFrom > withdraw to repay',
  {
    upgrade: true,
    balances: {
      // albert: { USDC: exp(100, 6) },
      // betty: { USDC: exp(-100, 6) },
    }
  },
  async ({ comet, actors }) => {
    const { albert, betty, charles } = actors;
    // XXX
    //await albert.allow(charles, true);
    //await charles.transferFrom(albert, better, USDC, exp(100, 6));
  });