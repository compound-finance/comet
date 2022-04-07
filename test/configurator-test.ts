import { ethers, exp, expect, makeConfigurator, wait } from './helpers';
import { CometFactory, CometFactory__factory, Comet__factory, Configurator, SimpleTimelock__factory } from '../build/types';

describe('configurator', function () {
  it('deploys Comet', async () => {
    const { configurator, configuratorProxy, proxyAdmin, comet, cometProxy } = await makeConfigurator();

    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.be.equal(comet.address);
    expect(await proxyAdmin.getProxyImplementation(configuratorProxy.address)).to.be.equal(configurator.address);

    await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.not.be.equal(comet.address);
  });

  it('sets governor and deploys Comet with new configuration', async () => {
    const { governor, configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(governor.address);

    await wait(configuratorAsProxy.setGovernor(alice.address));
    await wait(proxyAdmin.deployAndUpgradeTo(configuratorProxy.address, cometProxy.address));

    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(alice.address);
  });

  it.skip('adds asset and deploys Comet with new configuration', async () => {
    // XXX
  });

  it('reverts if deploy is called from non-governor', async () => {
    const { configuratorProxy, proxyAdmin, cometProxy, users: [alice] } = await makeConfigurator();

    await expect(proxyAdmin.connect(alice).deployAndUpgradeTo(configuratorProxy.address, cometProxy.address)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('e2e governance actions from timelock', async () => {
    const { governor, configurator, configuratorProxy, proxyAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

    const TimelockFactory = (await ethers.getContractFactory(
      'SimpleTimelock'
    )) as SimpleTimelock__factory;

    const timelock = await TimelockFactory.deploy(governor.address);
    await timelock.deployed();
    await proxyAdmin.transferOwnership(timelock.address);

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    await configuratorAsProxy.transferAdmin(timelock.address); // set timelock as admin of Configurator

    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(governor.address);

    // 1. SetGovernor
    // 2. DeployAndUpgradeTo
    let setGovernorCalldata = ethers.utils.defaultAbiCoder.encode(["address"], [alice.address]);
    let deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(["address", "address"], [configuratorProxy.address, cometProxy.address]);
    await timelock.executeTransactions([configuratorProxy.address, proxyAdmin.address], [0, 0], ["setGovernor(address)", "deployAndUpgradeTo(address,address)"], [setGovernorCalldata, deployAndUpgradeToCalldata]);
    
    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(alice.address);
  });

  it('reverts if initialized more than once', async () => {
    const { governor, configurator, configuratorProxy, cometFactory } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    let configuration = await configuratorAsProxy.getConfiguration();
    await expect(configuratorAsProxy.initialize(governor.address, cometFactory.address, configuration)).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });
});