import { CometProperties, scenario } from './context/CometContext';
import { expect } from 'chai';
import { exp, wait } from '../test/helpers';
import { opCodesForTransaction } from "../test/trace";

scenario.only(
  'has reasonable gas for 5 collateral assets',
  { remote_token: { mainnet: ['WBTC', 'WETH', 'UNI'] }, utilization: 0.5, defaultBaseAmount: 5000, upgrade: true },
  async ({ comet, assets, actors }, world, context) => {
    let tokenAmounts = {
      'WBTC': exp(.07, 8),
      'WETH': exp(0.01, 18),
      'UNI': exp(100, 18),
    };
    const minterAddress = "0xdd940fc821853799eaf27e9eb0a420ed3bcdc3ef";
    const minter = await world.impersonateAddress(minterAddress);

    let primary = context.primaryActor();
    for (let [token, amount] of Object.entries(tokenAmounts)) {
      let asset = assets[token]!;
      // await context.sourceTokens(world, amount, asset, primary);
      await asset.approve(primary, comet); //
      await asset.token.connect(minter).transfer(
        primary.address,
        amount
      );
      await comet.connect(primary.signer).supply(asset.address, amount);
      // console.log("gas", token, asset, await primary.getCollateralBalance(asset));
    }

    // await comet.connect(primary.signer).withdraw(await comet.baseToken(), exp(10, 6));
    let tx = await wait(comet.connect(primary.signer).withdraw(await comet.baseToken(), exp(1500, 6)));
    console.log({tx})

    const { totalGasCost, orderedOpcodeCounts, opcodeGasTotal } = await opCodesForTransaction(
      world.hre.network.provider,
      tx
    );
    console.log(`totalGasCost: ${totalGasCost}`);
    console.log(`opcodeGasTotal: ${opcodeGasTotal}`);
    console.log(orderedOpcodeCounts);

  }
);
