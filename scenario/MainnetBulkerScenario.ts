import { utils } from 'ethers';
import { expect } from 'chai';
import { scenario } from './context/CometContext';
import CometAsset from './context/CometAsset';
import { ERC20 } from '../build/types';
import { exp } from '../test/helpers';
import { isBulkerSupported, matchesDeployment } from './utils';

scenario.only(
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
    // XXX pretty weak exepectation
    expect(await comet.collateralBalanceOf(albert.address, wstETH.address)).to.be.within(
      0,
      toSupplyStEth
    );
  }
);