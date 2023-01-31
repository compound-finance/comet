import { scenario } from './context/CometContext';
import { exp } from '../test/helpers';
import { expect } from 'chai';

// note: meant for sanity checking v2 proposals, can normally be set to skip
//  enable to check specific v2 actions with addresses hard-coded by network
//  addresses to check and markets will need to be updated between runs

scenario.skip(
  'Compound v2 > allows a user to repay, borrow, repay cETH',
  {},
  async (_, context, world) => {
    const dm = context.world.deploymentManager;

    const whale = await world.impersonateAddress('0xeb312f4921aebbe99facacfe92f22b942cbd7599');
    const cETH = await dm.existing('cETH', '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5');

    const borrowBefore = await cETH.callStatic.borrowBalanceCurrent(whale.address);
    await cETH.connect(whale).repayBorrow({value: exp(2, 18)});
    await cETH.connect(whale).borrow(exp(1, 18));
    await cETH.connect(whale).repayBorrow({value: exp(1, 18)});
    const borrowAfter = await cETH.callStatic.borrowBalanceCurrent(whale.address);
    expect(borrowAfter.toBigInt() - borrowBefore.toBigInt()).to.be.lt(exp(1.6e-6, 18));
  }
);

scenario.skip(
  'Compound v2 > allows a user to mint & redeem cDAI',
  {},
  async (_, context, world) => {
    const dm = context.world.deploymentManager;

    const whale = await world.impersonateAddress('0xc61cb8183b7692c8feb6a9431b0b23537a6402b0');
    const DAI = await dm.existing('DAI', '0x6b175474e89094c44da98b954eedeac495271d0f');
    const cDAI = await dm.existing('cDAI', '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643');

    await DAI.connect(whale).approve(cDAI.address, exp(1000, 18));
    await cDAI.connect(whale).mint(exp(1000, 18));
    await cDAI.connect(whale).redeemUnderlying(exp(1000, 18)); // XXX: broken by DSR proposal?
  }
);

scenario.skip(
  'Compound v2 > allows a user to mint & redeem cUSDC',
  {},
  async (_, context, world) => {
    const dm = context.world.deploymentManager;

    const whale = await world.impersonateAddress('0xb99cc7e10fe0acc68c50c7829f473d81e23249cc');
    const USDC = await dm.existing('USDC', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    const cUSDC = await dm.existing('cUSDC', '0x39AA39c021dfbaE8faC545936693aC917d5E7563');

    await USDC.connect(whale).approve(cUSDC.address, exp(20_000, 18));
    await cUSDC.connect(whale).mint(exp(20_000, 18));
    await cUSDC.connect(whale).redeemUnderlying(exp(20_000, 18));
  }
);

scenario.skip(
  'Compound v2 > allows a user to repay, borrow, repay cWBTC2',
  {},
  async (_, context, world) => {
    const dm = context.world.deploymentManager;

    const borrower = await world.impersonateAddress('0x795148ed4d088cb0ff4757b832adfc6f3b354cf9');
    const whale = await world.impersonateAddress('0x1cb17a66dc606a52785f69f08f4256526abd4943');
    const WBTC = await dm.existing('WBTC', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
    const cWBTC2 = await dm.existing('cWBTC2', '0xccF4429DB6322D5C611ee964527D42E5d685DD6a');

    const borrowBefore = await cWBTC2.callStatic.borrowBalanceCurrent(borrower.address);
    await WBTC.connect(whale).approve(cWBTC2.address, exp(1, 8));
    await cWBTC2.connect(whale).repayBorrowBehalf(borrower.address, exp(0.1, 8));
    await cWBTC2.connect(borrower).borrow(exp(0.2, 8));
    await cWBTC2.connect(borrower).repayBorrow(exp(0.2, 8));
    const borrowAfter = await cWBTC2.callStatic.borrowBalanceCurrent(borrower.address);
    expect(borrowAfter.toBigInt() - borrowBefore.toBigInt()).to.be.lt(exp(1.6e-6, 18));
  }
);
