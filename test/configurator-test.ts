import { ethers, expect, makeConfigurator, wait } from './helpers';

describe('configurator', function () {
  it('sets configuration params correctly', async () => {
  });

  it.only('deploys Comet', async () => {
    const { governor, configurator, proxyAdmin, comet } = await makeConfigurator();

    expect(await proxyAdmin.getProxyImplementation(configurator.address)).to.be.equal(comet.address);
    
    await wait(proxyAdmin.connect(governor).deployAndUpgrade(configurator.address));

    expect(await proxyAdmin.getProxyImplementation(configurator.address)).to.not.be.equal(comet.address);
  });

  it('deploys Comet with new configuration', async () => {
  });

  it('reverts if deploy is called from non-governor', async () => {
  });

  it('packs asset configs correctly', async () => {
  });
});
