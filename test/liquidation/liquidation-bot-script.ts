import hre, { ethers } from 'hardhat';
import { event, expect, exp, setTotalsBasic } from '../helpers';
import { liquidateUnderwaterBorrowers } from "../../scripts/run-liquidation-bot";
import { HttpNetworkConfig } from 'hardhat/types/config';
import makeLiquidatableProtocol from './makeLiquidatableProtocol';

describe.only('Liquidation Bot', function () {
  before(async () => {
    const mainnetConfig = hre.config.networks.mainnet as HttpNetworkConfig;
    // fork from mainnet to make use of real Uniswap pools
    await ethers.provider.send(
      "hardhat_reset",
      [
        {
          forking: {
            jsonRpcUrl: mainnetConfig.url,
          },
        },
      ],
    );
  });

  after(async () => {
    // reset to blank hardhat network
    await ethers.provider.send('hardhat_reset', []);
  });

  it('sets up the teste', async function () {
    const { comet, liquidator } = await makeLiquidatableProtocol();
    expect(true).to.be.true;
  });
});