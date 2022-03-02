import { ethers, exp, expect, makeConfigurator, wait } from './helpers';
import { CometFactory, CometFactory__factory, Comet__factory, Configurator, Timelock__factory } from '../build/types';

describe.only('configurator', function () {
  it('deploys Comet', async () => {
    const { configurator, configuratorProxy, proxyAdmin, proxyAdminAdmin, comet, cometProxy } = await makeConfigurator();

    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.be.equal(comet.address);
    expect(await proxyAdmin.getProxyImplementation(configuratorProxy.address)).to.be.equal(configurator.address);

    await wait(proxyAdminAdmin.deployAndUpgradeTo(proxyAdmin.address, configuratorProxy.address, cometProxy.address));

    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.not.be.equal(comet.address);
  });

  it.skip('sets entire Configuration and deploys Comet with new configuration', async () => {
  });

  it('sets governor and deploys Comet with new configuration', async () => {
    const { governor, configurator, configuratorProxy, proxyAdmin, proxyAdminAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(governor.address);

    await wait(configuratorAsProxy.setGovernor(alice.address));
    await wait(proxyAdminAdmin.deployAndUpgradeTo(proxyAdmin.address, configuratorProxy.address, cometProxy.address));

    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(alice.address);
  });

  it('upgrade impl via execute() with calldata', async () => {
    const { proxyAdmin, proxyAdminAdmin, comet, cometProxy } = await makeConfigurator();

    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.be.equal(comet.address);
    
    // Deploy new contract to set implementation as
    let newComet = await (await (await ethers.getContractFactory('CometFactory')) as CometFactory__factory).deploy()
    await newComet.deployed();

    const calldata = ethers.utils.defaultAbiCoder.encode(["address", "address"], [cometProxy.address, newComet.address]);
    await wait(proxyAdminAdmin.execute(proxyAdmin.address, 0, "upgrade(address,address)", calldata));

    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.be.equal(newComet.address);
  });

  it.skip('adds asset and deploys Comet with new configuration', async () => {
  });

  it('reverts if deploy is called from non-governor', async () => {
    const { configuratorProxy, proxyAdmin, proxyAdminAdmin, cometProxy, users: [alice] } = await makeConfigurator();

    await expect(proxyAdminAdmin.connect(alice).deployAndUpgradeTo(proxyAdmin.address, configuratorProxy.address, cometProxy.address)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('e2e governance using timelock', async () => {
    const { governor, configurator, configuratorProxy, proxyAdmin, proxyAdminAdmin, comet, cometProxy, users: [alice] } = await makeConfigurator();

    const TimelockFactory = (await ethers.getContractFactory(
      'Timelock'
    )) as Timelock__factory;

    const timelock = await TimelockFactory.deploy();
    await timelock.deployed();
    await proxyAdminAdmin.transferOwnership(timelock.address);

    // Deploy new contract to set implementation as
    let newComet = await (await (await ethers.getContractFactory('CometFactory')) as CometFactory__factory).deploy()
    await newComet.deployed();

    // Execute using nested calldata
    // Timelock -> ProxyAdminAdmin.execute(address,uint256,string,bytes) -> ProxyAdmin.upgrade(address,address)
    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.not.be.equal(newComet.address);
    let proxyAdminUpgradeCalldata = ethers.utils.defaultAbiCoder.encode(["address", "address"], [cometProxy.address, newComet.address]);
    let proxyAdminAdminExecuteCalldata = ethers.utils.defaultAbiCoder.encode(["address", "uint256", "string", "bytes"], [proxyAdmin.address, 0, "upgrade(address,address)", proxyAdminUpgradeCalldata]);
    await timelock.execute([proxyAdminAdmin.address], [0], ["execute(address,uint256,string,bytes)"], [proxyAdminAdminExecuteCalldata]);
    expect(await proxyAdmin.getProxyImplementation(cometProxy.address)).to.be.equal(newComet.address);

    // DeployAndUpgradeTo
    let calldata = ethers.utils.defaultAbiCoder.encode(["address", "address", "address"], [proxyAdmin.address, configuratorProxy.address, cometProxy.address]);
    await timelock.execute([proxyAdminAdmin.address], [0], ["deployAndUpgradeTo(address,address,address)"], [calldata]);

    // Multiple actions in one execute()
    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(governor.address);
    await configuratorAsProxy.transferAdmin(timelock.address); // set timelock as admin
    let setGovernorCalldata = ethers.utils.defaultAbiCoder.encode(["address"], [alice.address]);
    let deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(["address", "address", "address"], [proxyAdmin.address, configuratorProxy.address, cometProxy.address]);
    await timelock.execute([configuratorProxy.address, proxyAdminAdmin.address], [0, 0], ["setGovernor(address)", "deployAndUpgradeTo(address,address,address)"], [setGovernorCalldata, deployAndUpgradeToCalldata]);
    expect((await configuratorAsProxy.getConfiguration()).governor).to.be.equal(alice.address);
  });
});