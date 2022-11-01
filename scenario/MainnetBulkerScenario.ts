import { utils } from 'ethers';
import { expect } from 'chai';
import { scenario } from './context/CometContext';
import CometAsset from './context/CometAsset';
import {
  ERC20,
  IWstETH
} from '../build/types';
import { exp } from '../test/helpers';
import { expectApproximately, isBulkerSupported, matchesDeployment } from './utils';

scenario(
  'MainnetBulker > wraps stETH before supplying',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) && matchesDeployment(ctx, [{deployment: 'weth'}]),
    tokenBalances: {
      albert: { $asset1: '== 0' },
    },
  },
  async ({ comet, actors, assets, bulker }, context) => {
    const { albert } = actors;
    const { wstETH } = assets;

    const toSupplyStEth = exp(.1, 18);

    const stETH = await context.world.deploymentManager.contract('stETH') as ERC20;
    const stETHAsset = new CometAsset(stETH);
    // source some stETH for albert
    await context.sourceTokens(toSupplyStEth, stETHAsset, albert);

    expect(await stETH.balanceOf(albert.address)).to.be.approximately(toSupplyStEth, 1);

    // approve bulker as albert
    await stETHAsset.approve(albert, bulker.address, toSupplyStEth);

    const supplyStEthCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint'],
      [comet.address, albert.address, toSupplyStEth]
    );
    const calldata = [supplyStEthCalldata];
    const actions = [await bulker.ACTION_SUPPLY_STETH()];

    const txn = await albert.invoke({ actions, calldata });

    expect(await wstETH.balanceOf(albert.address)).to.be.equal(0n);
    // XXX pretty weak expectation
    expect(await comet.collateralBalanceOf(albert.address, wstETH.address)).to.be.within(
      0,
      toSupplyStEth
    );
  }
);

scenario(
  'MainnetBulker > wraps wstETH before withdrawing',
  {
    filter: async (ctx) => await isBulkerSupported(ctx) && matchesDeployment(ctx, [{deployment: 'weth'}]),
    tokenBalances: {
      albert: { $asset1: 2 },
      $comet: { $asset1: 5 },
    },
  },
  async ({ comet, actors, assets, bulker }, context) => {
    const { albert } = actors;

    const stETH = await context.world.deploymentManager.contract('stETH') as ERC20;
    const wstETH = await context.world.deploymentManager.contract('wstETH') as IWstETH;

    const toWithdrawStEth = exp(1, 18);

    // approvals/allowances
    await albert.allow(bulker.address, true);
    await wstETH.connect(albert.signer).approve(comet.address, toWithdrawStEth);

    // supply wstETH
    await albert.supplyAsset({asset: wstETH.address, amount: toWithdrawStEth });

    const withdrawStEthCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'uint'],
      [comet.address, albert.address, toWithdrawStEth]
    );
    const calldata = [withdrawStEthCalldata];
    const actions = [await bulker.ACTION_WITHDRAW_STETH()];

    const txn = await albert.invoke({ actions, calldata });

    expectApproximately(
      await stETH.balanceOf(albert.address),
      await wstETH.getStETHByWstETH(toWithdrawStEth),
      1n
    );
    expect(await comet.collateralBalanceOf(albert.address, wstETH.address)).to.equal(0);
  }
);