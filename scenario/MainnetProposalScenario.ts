import { scenario } from './context/CometContext';
import { expect } from 'chai';
import { exp } from '../test/helpers';

scenario.only(
  'Comet#mainnetProposal > check states after executing proposal',
  {},
  async ({ comet, assets }, context, world) => {
    if (world.deploymentManager.network !== 'mainnet') return;

    const { USDC, COMP, WETH, WBTC, LINK, UNI } = assets;

    expect((await comet.getAssetInfoByAddress(COMP.address)).supplyCap).to.be.equal(exp(150_000, 18));
    expect((await comet.getAssetInfoByAddress(WBTC.address)).supplyCap).to.be.equal(exp(2_000, 8));
    expect((await comet.getAssetInfoByAddress(WETH.address)).supplyCap).to.be.equal(exp(25_000, 18));
    expect((await comet.getAssetInfoByAddress(UNI.address)).supplyCap).to.be.equal(exp(1_000_000, 18));
    expect((await comet.getAssetInfoByAddress(LINK.address)).supplyCap).to.be.equal(exp(1_000_000, 18));
    expect(await USDC.balanceOf(comet.address)).to.be.equal(exp(500_000, 6));
  }
);
