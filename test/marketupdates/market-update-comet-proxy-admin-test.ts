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
      marketUpdateTimelock,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    await proxyAdmin
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    expect(await proxyAdmin.marketAdmin()).to.be.equal(
      marketUpdateTimelock.address
    );

    await expect(
      proxyAdmin
        .connect(marketUpdateTimelockSigner)
        .transferOwnership(alice.address)
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('only main-governor-timelock can set or update marketAdminPauseGuardian', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelock,
      marketUpdateMultiSig,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const oldMarketAdminPauseGuardian = await proxyAdmin.marketAdminPauseGuardian();
    expect(oldMarketAdminPauseGuardian).to.be.equal(
      ethers.constants.AddressZero
    );

    const txn = await wait(
      proxyAdmin
        .connect(governorTimelockSigner)
        .setMarketAdminPauseGuardian(alice.address)
    );
    expect(event(txn, 0)).to.be.deep.equal({
      SetMarketAdminPauseGuardian: {
        oldPauseGuardian: oldMarketAdminPauseGuardian,
        newPauseGuardian: alice.address,
      },
    });
    const newMarketAdminPauseGuardian = await proxyAdmin.marketAdminPauseGuardian();
    expect(newMarketAdminPauseGuardian).to.be.equal(alice.address);
    expect(newMarketAdminPauseGuardian).to.be.not.equal(
      oldMarketAdminPauseGuardian
    );
    await expect(
      proxyAdmin
        .connect(marketUpdateMultiSig)
        .setMarketAdminPauseGuardian(marketUpdateTimelock.address)
    ).to.be.revertedWithCustomError(proxyAdmin, 'Unauthorized');

    await expect(
      proxyAdmin
        .connect(marketUpdateTimelockSigner)
        .setMarketAdminPauseGuardian(marketUpdateTimelock.address)
    ).to.be.revertedWithCustomError(proxyAdmin, 'Unauthorized');
  });

  it('main-governor-timelock can pause and unpause market admin', async () => {
    const { governorTimelockSigner } = await makeMarketAdmin();
    const { proxyAdmin } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    expect(await proxyAdmin.marketAdminPaused()).to.be.false;

    const txnOfPause = await wait(
      proxyAdmin.connect(governorTimelockSigner).pauseMarketAdmin()
    );

    expect(event(txnOfPause, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        isMarketAdminPaused: true,
      },
    });
    expect(await proxyAdmin.marketAdminPaused()).to.be.true;

    const txnOfUnpause = await wait(
      proxyAdmin.connect(governorTimelockSigner).unpauseMarketAdmin()
    );

    expect(event(txnOfUnpause, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        isMarketAdminPaused: false,
      },
    });
    expect(await proxyAdmin.marketAdminPaused()).to.be.false;
  });

  it('marketAdminPauseGuardian can pause market admin', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelock,
      marketUpdateMultiSig,
      marketUpdateProposer,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    expect(await proxyAdmin.marketAdminPaused()).to.be.false;

    await proxyAdmin
      .connect(governorTimelockSigner)
      .setMarketAdminPauseGuardian(alice.address);

    expect(await proxyAdmin.marketAdminPauseGuardian()).to.be.equal(
      alice.address
    );

    const txn = await wait(proxyAdmin.connect(alice).pauseMarketAdmin());

    expect(event(txn, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        isMarketAdminPaused: true,
      },
    });
    expect(await proxyAdmin.marketAdminPaused()).to.be.true;

    await proxyAdmin
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    expect(await proxyAdmin.marketAdmin()).to.be.equal(
      marketUpdateTimelock.address
    );

    const proposalId = 1n;

    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .propose(
        [proxyAdmin.address],
        [0],
        ['deployAndUpgradeTo(address,address)'],
        [
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'address'],
            [configuratorProxy.address, cometProxy.address]
          ),
        ],
        'Upgrading comet proxy admin implementation'
      );

    await expect(
      marketUpdateProposer.connect(marketUpdateMultiSig).execute(proposalId)
    ).to.be.rejectedWith(
      'MarketUpdateTimelock::executeTransaction: Transaction execution reverted.'
    );
  });

  it('marketAdminPauseGuardian cannot unpause market admin', async () => {
    const { governorTimelockSigner } = await makeMarketAdmin();

    const {
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    expect(await proxyAdmin.marketAdminPaused()).to.be.false;

    await proxyAdmin
      .connect(governorTimelockSigner)
      .setMarketAdminPauseGuardian(alice.address);

    expect(await proxyAdmin.marketAdminPauseGuardian()).to.be.equal(
      alice.address
    );

    await expect(
      proxyAdmin.connect(alice).unpauseMarketAdmin()
    ).to.be.revertedWithCustomError(proxyAdmin, 'Unauthorized');
  });

  it('deployAndUpgradeTo can be called by main-governor-timelock or market-admin', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelock,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
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

    await proxyAdmin
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    expect(await proxyAdmin.marketAdmin()).to.be.equal(
      marketUpdateTimelock.address
    );

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
      marketUpdateTimelock,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
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

    await proxyAdmin
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    expect(await proxyAdmin.marketAdmin()).to.be.equal(
      marketUpdateTimelock.address
    );

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
    const { governorTimelockSigner } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    await expect(
      proxyAdmin
        .connect(alice)
        .deployAndUpgradeTo(configuratorProxy.address, cometProxy.address)
    ).to.be.revertedWith(
      'Unauthorized: caller is not owner or market update admin'
    );
  });

  it('no other address can call deployUpgradeToAndCall', async () => {
    const { governorTimelockSigner } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
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
    ).to.be.revertedWith(
      'Unauthorized: caller is not owner or market update admin'
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
      marketUpdateTimelock,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configuratorProxy,
      cometProxy,
      proxyAdmin,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    await proxyAdmin
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    expect(await proxyAdmin.marketAdmin()).to.be.equal(
      marketUpdateTimelock.address
    );

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
