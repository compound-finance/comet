import { Comet, ethers, expect, exp, makeProtocol, wait } from './helpers';

const FACTOR = exp(1, 18);

describe('Comet', function () {
  it('Should properly initialize Comet protocol', async () => {
    const { comet, tokens } = await makeProtocol({
      assets: {
        USDC: {},
        ASSET1: {},
        ASSET2: {},
      },
      reward: 'ASSET1'
    });

    const cometNumAssets = await comet.numAssets();
    const cometMaxAssets = await comet.maxAssets();
    expect(cometMaxAssets).to.be.equal(cometNumAssets);
    expect(cometNumAssets).to.be.equal(2);

    const assetInfo00 = await comet.getAssetInfo(0);
    expect(assetInfo00.asset).to.be.equal(tokens['ASSET1'].address);
    expect(assetInfo00.borrowCollateralFactor).to.equal(FACTOR);
    expect(assetInfo00.liquidateCollateralFactor).to.equal(FACTOR);

    const assetInfo01 = await comet.getAssetInfo(1);
    expect(assetInfo01.asset).to.be.equal(tokens['ASSET2'].address);
    expect(assetInfo01.borrowCollateralFactor).to.equal(FACTOR);
    expect(assetInfo01.liquidateCollateralFactor).to.equal(FACTOR);
  });

  it('Should fail if too many assets are passed', async () => {
    await expect(makeProtocol({
      assets: {
        USDC: {},
        ASSET1: {},
        ASSET2: {},
        ASSET3: {},
      },
      reward: 'ASSET1',
    })).to.be.revertedWith('too many asset configs');
  });

  it('Should revert if index is greater that numAssets', async () => {
    const { comet } = await makeProtocol();
    await expect(comet.getAssetInfo(2)).to.be.revertedWith('asset info not found');
  });

  it('Should get valid assets', async () => {
    const { comet } = await makeProtocol({
      assets: {
        USDC: {},
        ASSET1: {},
        ASSET2: {},
      }
    });
    const assetInfo00 = await comet.getAssetInfo(0);
    const assetInfo01 = await comet.getAssetInfo(1);
    const assets = await comet.assets();
    expect(assets[0].asset).to.be.equal(assetInfo00.asset);
    expect(assets[0].borrowCollateralFactor).to.be.equal(assetInfo00.borrowCollateralFactor);
    expect(assets[0].liquidateCollateralFactor).to.be.equal(assetInfo00.liquidateCollateralFactor);

    expect(assets[1].asset).to.be.equal(assetInfo01.asset);
    expect(assets[1].borrowCollateralFactor).to.be.equal(assetInfo01.borrowCollateralFactor);
    expect(assets[1].liquidateCollateralFactor).to.be.equal(assetInfo01.liquidateCollateralFactor);
  });

  it('Should get valid asset addresses', async () => {
    const { comet } = await makeProtocol({
      assets: {
        USDC: {},
        ASSET1: {},
        ASSET2: {},
      }
    });
    const assetInfo00 = await comet.getAssetInfo(0);
    const assetInfo01 = await comet.getAssetInfo(1);
    const assets = await comet.assetAddresses();
    expect(assets[0]).to.be.equal(assetInfo00.asset);
    expect(assets[1]).to.be.equal(assetInfo01.asset);
  });
});
