import { ethers, exp, expect, makeConfigurator, wait } from './helpers';
import { CometFactory, Comet__factory } from '../build/types';

describe('configurator', function () {
  it('deploys Comet', async () => {
    const { governor, configurator, proxyAdmin, comet } = await makeConfigurator();

    expect(await proxyAdmin.getProxyImplementation(configurator.address)).to.be.equal(comet.address);

    await wait(proxyAdmin.connect(governor).deployAndUpgrade(configurator.address));

    expect(await proxyAdmin.getProxyImplementation(configurator.address)).to.not.be.equal(comet.address);
  });

  it.skip('sets entire Configuration and deploys Comet with new configuration', async () => {
  });

  it('sets governor and deploys Comet with new configuration', async () => {
    const { governor, configurator, proxyAdmin, users: [alice] } = await makeConfigurator();

    expect(await configurator.governorParam()).to.be.equal(governor.address);

    await wait(proxyAdmin.connect(governor).setGovernor(configurator.address, alice.address));
    await wait(proxyAdmin.connect(governor).deployAndUpgrade(configurator.address));

    expect(await configurator.governorParam()).to.be.equal(alice.address);
  });

  it.skip('adds asset and deploys Comet with new configuration', async () => {
  });

  it('packs asset configs correctly', async () => {
    const { governor, configurator, proxyAdmin, comet, tokens, users: [alice] } = await makeConfigurator({
      assets: {
        USDC: { decimals: 6 },
        COMP: {
          initial: 1e7,
          decimals: 18,
          initialPrice: 1,
          borrowCF: exp(0.9, 18),
          liquidateCF: exp(0.95, 18),
          liquidationFactor: exp(0.95, 18),
          supplyCap: exp(1_000_000, 18),
        },
      },
    });

    await wait(proxyAdmin.connect(governor).deployAndUpgrade(configurator.address));

    // Verify Comet address has changed
    const newCometAddress = await proxyAdmin.getProxyImplementation(configurator.address);
    expect(newCometAddress).to.not.be.equal(comet.address);

    const CometFactory = (await ethers.getContractFactory('Comet')) as Comet__factory;
    const newComet = CometFactory.attach(newCometAddress);

    // Verify assets are correctly set
    const cometNumAssets = await newComet.numAssets();
    expect(cometNumAssets).to.be.equal(1);
    const assetInfo00 = await comet.getAssetInfo(0);
    expect(assetInfo00.asset).to.be.equal(tokens['COMP'].address);
    expect(assetInfo00.scale).to.equal(exp(1, 18));
    expect(assetInfo00.borrowCollateralFactor).to.equal(exp(0.9, 18));
    expect(assetInfo00.liquidateCollateralFactor).to.equal(exp(0.95, 18));
    expect(assetInfo00.supplyCap).to.equal(exp(1_000_000, 18));
  });

  it('reverts if deploy is called from non-governor', async () => {
    const { configurator, proxyAdmin, users: [alice] } = await makeConfigurator();

    await expect(proxyAdmin.connect(alice).deployAndUpgrade(configurator.address)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('reverts if deploy is called directly in Configurator instead of from ProxyAdmin', async () => {
    const { configurator, users: [alice] } = await makeConfigurator();

    await expect(configurator.connect(alice).deployAndUpgrade()).to.be.revertedWith(`function selector was not recognized and there's no fallback function`);
  });
});
