import { expect, makeConfigurator, event, wait } from './../helpers';
import { makeMarketAdmin } from './market-updates-helper';
import { ethers } from 'hardhat';

describe('CometProxyAdmin', function() {
  it('only main-governor-timelock can transferOwnership of CometProxyAdmin as it is the owner', async () => {
    const { governorTimelockSigner } = await makeMarketAdmin();

    const {
      proxyAdmin,
      users: [alice, bob],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const oldOwner = await proxyAdmin.owner();
    const txn = await wait(
      proxyAdmin
        .connect(governorTimelockSigner)
        .transferOwnership(alice.address)
    );

    expect(event(txn, 0)).to.be.deep.equal({
      OwnershipTransferred: {
        previousOwner: oldOwner,
        newOwner: alice.address,
      },
    });
    expect(await proxyAdmin.owner()).to.be.equal(alice.address);

    await expect(
      proxyAdmin.connect(bob).transferOwnership(alice.address)
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('market admin cannot transferOwnership of CometProxyAdmin', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelockSigner,
      marketAdminPermissionCheckerContract
    } = await makeMarketAdmin();

    const {
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract
    });

    expect(await proxyAdmin.marketAdminPermissionChecker()).to.be.equal(marketAdminPermissionCheckerContract.address);
    expect(await marketAdminPermissionCheckerContract.marketAdmin()).to.be.equal(marketUpdateTimelockSigner.address);


    await expect(
      proxyAdmin
        .connect(marketUpdateTimelockSigner)
        .transferOwnership(alice.address)
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });



  it('deployAndUpgradeTo can be called by main-governor-timelock or market-admin', async () => {
    const {
      governorTimelockSigner,
      marketAdminPermissionCheckerContract,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract
    });

    const abi = [
      'event CometDeployed(address indexed cometProxy, address indexed newComet)',
      'event Upgraded(address indexed implementation)',
    ];

    // Initialize the contract interface
    const iface = new ethers.utils.Interface(abi);

    const txnForGovernorTimelock = (await wait(
      proxyAdmin
        .connect(governorTimelockSigner)
        .deployAndUpgradeTo(configuratorProxy.address, cometProxy.address)
    )) as any;

    const eventsForGovernorTimelock = [];

    txnForGovernorTimelock.receipt.events.forEach((event) => {
      try {
        const decodedEvent = iface.parseLog(event);
        eventsForGovernorTimelock.push(decodedEvent);
      } catch (error) {
        console.log('Failed to decode event:', error);
      }
    });

    // verify the event names
    expect(eventsForGovernorTimelock[0].name).to.be.equal('CometDeployed');
    expect(eventsForGovernorTimelock[1].name).to.be.equal('Upgraded');

    expect(await proxyAdmin.marketAdminPermissionChecker()).to.be.equal(marketAdminPermissionCheckerContract.address);
    expect(await marketAdminPermissionCheckerContract.marketAdmin()).to.be.equal(marketUpdateTimelockSigner.address);


    const txnForMarketAdmin = (await wait(
      proxyAdmin
        .connect(marketUpdateTimelockSigner)
        .deployAndUpgradeTo(configuratorProxy.address, cometProxy.address)
    )) as any;

    const eventsForMarketAdmin = [];

    txnForMarketAdmin.receipt.events.forEach((event) => {
      try {
        const decodedEvent = iface.parseLog(event);
        eventsForMarketAdmin.push(decodedEvent);
      } catch (error) {
        console.log('Failed to decode event:', error);
      }
    });

    // verify the event names
    expect(eventsForMarketAdmin[0].name).to.be.equal('CometDeployed');
    expect(eventsForMarketAdmin[1].name).to.be.equal('Upgraded');
  });

  it('deployUpgradeToAndCall can be called by main-governor-timelock or market-admin', async () => {
    const {
      governorTimelockSigner,
      marketAdminPermissionCheckerContract,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract,
    });

    const functionAbi = new ethers.utils.Interface(['function getReserves()']);
    const calldata = functionAbi.encodeFunctionData('getReserves', []);

    const abiToCheck = [
      'event CometDeployed(address indexed cometProxy, address indexed newComet)',
      'event Upgraded(address indexed implementation)',
    ];

    // Initialize the contract interface
    const iface = new ethers.utils.Interface(abiToCheck);

    const txnForGovernorTimelock = (await wait(
      proxyAdmin
        .connect(governorTimelockSigner)
        .deployUpgradeToAndCall(
          configuratorProxy.address,
          cometProxy.address,
          calldata
        )
    )) as any;

    const eventsForGovernorTimelock = [];

    txnForGovernorTimelock.receipt.events.forEach((event) => {
      try {
        const decodedEvent = iface.parseLog(event);
        eventsForGovernorTimelock.push(decodedEvent);
      } catch (error) {
        console.log('Failed to decode event:', error);
      }
    });

    // verify the event names
    expect(eventsForGovernorTimelock[0].name).to.be.equal('CometDeployed');
    expect(eventsForGovernorTimelock[1].name).to.be.equal('Upgraded');

    expect(await proxyAdmin.marketAdminPermissionChecker()).to.be.equal(marketAdminPermissionCheckerContract.address);
    expect(await marketAdminPermissionCheckerContract.marketAdmin()).to.be.equal(marketUpdateTimelockSigner.address);


    const txnForMarketAdmin = (await wait(
      proxyAdmin
        .connect(marketUpdateTimelockSigner)
        .deployUpgradeToAndCall(
          configuratorProxy.address,
          cometProxy.address,
          calldata
        )
    )) as any;

    const eventsForMarketAdmin = [];

    txnForMarketAdmin.receipt.events.forEach((event) => {
      try {
        const decodedEvent = iface.parseLog(event);
        eventsForMarketAdmin.push(decodedEvent);
      } catch (error) {
        console.log('Failed to decode event:', error);
      }
    });

    // verify the event names
    expect(eventsForMarketAdmin[0].name).to.be.equal('CometDeployed');
    expect(eventsForMarketAdmin[1].name).to.be.equal('Upgraded');
  });

  it('no other address can call deployAndUpgradeTo', async () => {
    const { governorTimelockSigner, marketAdminPermissionCheckerContract } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract
    });

    await expect(
      proxyAdmin
        .connect(alice)
        .deployAndUpgradeTo(configuratorProxy.address, cometProxy.address)
    ).to.be.revertedWithCustomError(
      marketAdminPermissionCheckerContract, 'Unauthorized'
    );
  });

  it('no other address can call deployUpgradeToAndCall', async () => {
    const { governorTimelockSigner, marketAdminPermissionCheckerContract } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract
    });

    const callData = '0x';

    await expect(
      proxyAdmin
        .connect(alice)
        .deployUpgradeToAndCall(
          configuratorProxy.address,
          cometProxy.address,
          callData
        )
    ).to.be.revertedWithCustomError(
      marketAdminPermissionCheckerContract,
      'Unauthorized'
    );
  });

  it('a new comet implementation gets deployed when main-governor-timelock calls deployAndUpgradeTo', async () => {
    const { governorTimelockSigner } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const oldCometImplementation = await proxyAdmin.getProxyImplementation(
      cometProxy.address
    );

    await proxyAdmin
      .connect(governorTimelockSigner)
      .deployAndUpgradeTo(configuratorProxy.address, cometProxy.address);

    const newCometImplementation = await proxyAdmin.getProxyImplementation(
      cometProxy.address
    );
    expect(newCometImplementation).to.be.not.equal(oldCometImplementation);
  });

  it('a new comet implementation gets deployed when market admin calls deployAndUpgradeTo', async () => {
    const {
      governorTimelockSigner,
      marketAdminPermissionCheckerContract,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract
    });

    expect(await proxyAdmin.marketAdminPermissionChecker()).to.be.equal(marketAdminPermissionCheckerContract.address);
    expect(await marketAdminPermissionCheckerContract.marketAdmin()).to.be.equal(marketUpdateTimelockSigner.address);


    const oldCometImplementation = await proxyAdmin.getProxyImplementation(
      cometProxy.address
    );

    await proxyAdmin
      .connect(marketUpdateTimelockSigner)
      .deployAndUpgradeTo(configuratorProxy.address, cometProxy.address);

    const newCometImplementation = await proxyAdmin.getProxyImplementation(
      cometProxy.address
    );
    expect(newCometImplementation).to.be.not.equal(oldCometImplementation);
  });
});
