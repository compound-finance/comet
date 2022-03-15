import { CometProperties, scenario } from './context/CometContext';
import { expect } from 'chai';
import { exp, wait } from '../test/helpers';

scenario.only(
  'has reasonable gas for 5 collateral assets',
  { remote_token: { mainnet: ['WBTC'] }, utilization: 0.5, defaultBaseAmount: 5000 },
  async ({ comet, assets, actors }, world, context) => {
    let tokenAmounts = {
      'WBTC': 1
    };
    let primary = context.primaryActor();
    for (let [token, amount] of Object.entries(tokenAmounts)) {
      let asset = assets[token]!;
      await context.sourceTokens(world, amount, asset, primary);
      await asset.approve(primary, comet);
      await comet.connect(primary.signer).supply(asset.address, exp(amount, await asset.decimals()));
      console.log("gas", token, asset, await primary.getCollateralBalance(asset));
    }

    await comet.connect(primary.signer).withdraw(await comet.baseToken(), exp(10, 6));
    let tx = await wait(comet.connect(primary.signer).withdraw(await comet.baseToken(), exp(1500, 6)));
    console.log({tx})
  }
);
