import { expect, makeConfigurator, event, wait } from './../helpers';
import { makeMarketAdmin } from './market-updates-helper';
import { ethers } from 'hardhat';

describe('Configurator', function() {
  it('already initialized and is not able to initialize again with main-governor-timelock as admin', async () => {
    const {
      governorTimelockSigner,
      governorTimelock,
    } = await makeMarketAdmin();

    const { configurator, configuratorProxy } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    // check already initialized properly
    expect(await configuratorAsProxy.version()).to.be.equal(1);
    expect(await configuratorAsProxy.governor()).to.be.equal(
      governorTimelock.address
    );
    expect(await configuratorAsProxy.governor()).to.be.equal(
      governorTimelock.address
    );

    // check is not able to initialize again
    await expect(
      configuratorAsProxy.initialize(governorTimelock.address)
    ).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  it('only main-governor-timelock can set market admin', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelock,
      marketUpdateTimelockSigner,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    const { configurator, configuratorProxy } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    const oldMarketAdmin = await configuratorAsProxy.marketAdmin();

    // Add a check to make sure its set as address(0) initially. So here oldMarketAdmin should be (0)
    expect(oldMarketAdmin).to.be.equal(ethers.constants.AddressZero);
    const txn = await wait(
      configuratorAsProxy
        .connect(governorTimelockSigner)
        .setMarketAdmin(marketUpdateTimelock.address)
    );
    expect(event(txn, 0)).to.be.deep.equal({
      SetMarketAdmin: {
        oldAdmin: oldMarketAdmin,
        newAdmin: marketUpdateTimelock.address,
      },
    });
    const newMarketAdmin = await configuratorAsProxy.marketAdmin();
    expect(newMarketAdmin).to.be.equal(marketUpdateTimelock.address);
    expect(newMarketAdmin).to.be.not.equal(oldMarketAdmin);

    await expect(
      configuratorAsProxy
        .connect(marketUpdateMultiSig)
        .setMarketAdmin(marketUpdateTimelock.address)
    ).to.be.revertedWithCustomError(configuratorAsProxy, 'Unauthorized');

    await expect(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setMarketAdmin(marketUpdateTimelock.address)
    ).to.be.revertedWithCustomError(configuratorAsProxy, 'Unauthorized');
  });

  it('only main-governor-timelock can set or update marketAdminPauseGuardian', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelock,
      marketUpdateMultiSig,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    const oldMarketAdminPauseGuardian = await configuratorAsProxy.marketAdminPauseGuardian();
    expect(oldMarketAdminPauseGuardian).to.be.equal(
      ethers.constants.AddressZero
    );

    const txn = await wait(
      configuratorAsProxy
        .connect(governorTimelockSigner)
        .setMarketAdminPauseGuardian(alice.address)
    );
    expect(event(txn, 0)).to.be.deep.equal({
      SetMarketAdminPauseGuardian: {
        oldPauseGuardian: oldMarketAdminPauseGuardian,
        newPauseGuardian: alice.address,
      },
    });
    const newMarketAdminPauseGuardian = await configuratorAsProxy.marketAdminPauseGuardian();
    expect(newMarketAdminPauseGuardian).to.be.equal(alice.address);
    expect(newMarketAdminPauseGuardian).to.be.not.equal(
      oldMarketAdminPauseGuardian
    );
    await expect(
      configuratorAsProxy
        .connect(marketUpdateMultiSig)
        .setMarketAdminPauseGuardian(marketUpdateTimelock.address)
    ).to.be.revertedWithCustomError(configuratorAsProxy, 'Unauthorized');

    await expect(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setMarketAdminPauseGuardian(marketUpdateTimelock.address)
    ).to.be.revertedWithCustomError(configuratorAsProxy, 'Unauthorized');
  });

  it('main-governor-timelock can pause and unpause market admin', async () => {
    const { governorTimelockSigner } = await makeMarketAdmin();
    const { configurator, configuratorProxy } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    expect(await configuratorAsProxy.marketAdminPaused()).to.be.false;

    const txnOfPause = await wait(
      configuratorAsProxy.connect(governorTimelockSigner).pauseMarketAdmin()
    );

    expect(event(txnOfPause, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        isMarketAdminPaused: true,
      },
    });
    expect(await configuratorAsProxy.marketAdminPaused()).to.be.true;

    const txnOfUnpause = await wait(
      configuratorAsProxy.connect(governorTimelockSigner).unpauseMarketAdmin()
    );

    expect(event(txnOfUnpause, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        isMarketAdminPaused: false,
      },
    });
    expect(await configuratorAsProxy.marketAdminPaused()).to.be.false;
  });

  it('marketAdminPauseGuardian can pause market admin', async () => {
    const {
      governorTimelockSigner,
      marketUpdateMultiSig,
      marketUpdateProposer,
      marketUpdateTimelock,
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    expect(await configuratorAsProxy.marketAdminPaused()).to.be.false;

    await configuratorAsProxy
      .connect(governorTimelockSigner)
      .setMarketAdminPauseGuardian(alice.address);

    expect(await configuratorAsProxy.marketAdminPauseGuardian()).to.be.equal(
      alice.address
    );

    const txn = await wait(
      configuratorAsProxy.connect(alice).pauseMarketAdmin()
    );

    expect(event(txn, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        isMarketAdminPaused: true,
      },
    });
    expect(await configuratorAsProxy.marketAdminPaused()).to.be.true;

    await configuratorAsProxy
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    expect(await configuratorAsProxy.marketAdmin()).to.be.equal(
      marketUpdateTimelock.address
    );

    const proposalId = 1n;

    await marketUpdateProposer
      .connect(marketUpdateMultiSig)
      .propose(
        [configuratorProxy.address],
        [0],
        ['setSupplyKink(address,uint64)'],
        [
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'uint64'],
            [cometProxy.address, 100]
          ),
        ],
        'Setting supply kink to 100'
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
      configurator,
      configuratorProxy,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    expect(await configuratorAsProxy.marketAdminPaused()).to.be.false;

    await configuratorAsProxy
      .connect(governorTimelockSigner)
      .setMarketAdminPauseGuardian(alice.address);

    expect(await configuratorAsProxy.marketAdminPauseGuardian()).to.be.equal(
      alice.address
    );

    await expect(
      configuratorAsProxy.connect(alice).unpauseMarketAdmin()
    ).to.be.revertedWithCustomError(configuratorAsProxy, 'Unauthorized');
  });

  it('only main-governor-timelock or market admin can call market update functions', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelock,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    const oldSupplyKink = (
      await configuratorAsProxy.getConfiguration(cometProxy.address)
    ).supplyKink;
    const newSupplyKink = 100n;

    const txnOfGovernorTimelock = await wait(
      configuratorAsProxy
        .connect(governorTimelockSigner)
        .setSupplyKink(cometProxy.address, newSupplyKink)
    );

    expect(event(txnOfGovernorTimelock, 0)).to.be.deep.equal({
      SetSupplyKink: {
        cometProxy: cometProxy.address,
        oldKink: oldSupplyKink,
        newKink: newSupplyKink,
      },
    });
    expect(
      (await configuratorAsProxy.getConfiguration(cometProxy.address))
        .supplyKink
    ).to.be.equal(newSupplyKink);

    await configuratorAsProxy
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    expect(await configuratorAsProxy.marketAdmin()).to.be.equal(
      marketUpdateTimelock.address
    );

    const oldBorrowKink = (
      await configuratorAsProxy.getConfiguration(cometProxy.address)
    ).borrowKink;

    const newBorrowKink = 100n;

    const txnOfMarketAdmin = await wait(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setBorrowKink(cometProxy.address, newBorrowKink)
    );

    expect(event(txnOfMarketAdmin, 0)).to.be.deep.equal({
      SetBorrowKink: {
        cometProxy: cometProxy.address,
        oldKink: oldBorrowKink,
        newKink: newBorrowKink,
      },
    });
    expect(
      (await configuratorAsProxy.getConfiguration(cometProxy.address))
        .borrowKink
    ).to.be.equal(newBorrowKink);
  });

  it('market admin cannot call NON market update functions', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelock,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    await configuratorAsProxy
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    await expect(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setPauseGuardian(cometProxy.address, alice.address)
    ).to.be.revertedWithCustomError(configuratorAsProxy, 'Unauthorized');
  });

  it('market admin cannot call market update functions when marketAdminPaused', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelock,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    await configuratorAsProxy
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    expect(await configuratorAsProxy.marketAdmin()).to.be.equal(
      marketUpdateTimelock.address
    );

    await configuratorAsProxy
      .connect(governorTimelockSigner)
      .pauseMarketAdmin();
    expect(await configuratorAsProxy.marketAdminPaused()).to.be.true;

    const newBorrowKink = 100n;
    await expect(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setBorrowKink(cometProxy.address, newBorrowKink)
    ).to.be.revertedWith('Market admin is paused');
  });

  it('main-governor-timelock can call market update functions when marketAdminPause', async () => {
    const { governorTimelockSigner } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    await configuratorAsProxy
      .connect(governorTimelockSigner)
      .pauseMarketAdmin();
    expect(await configuratorAsProxy.marketAdminPaused()).to.be.true;

    const oldSupplyKink = (
      await configuratorAsProxy.getConfiguration(cometProxy.address)
    ).supplyKink;
    const newSupplyKink = 100n;

    const txnOfGovernorTimelock = await wait(
      configuratorAsProxy
        .connect(governorTimelockSigner)
        .setSupplyKink(cometProxy.address, newSupplyKink)
    );

    expect(event(txnOfGovernorTimelock, 0)).to.be.deep.equal({
      SetSupplyKink: {
        cometProxy: cometProxy.address,
        oldKink: oldSupplyKink,
        newKink: newSupplyKink,
      },
    });
    expect(
      (await configuratorAsProxy.getConfiguration(cometProxy.address))
        .supplyKink
    ).to.be.equal(newSupplyKink);
  });

  it('governor cannot be updated by market admin', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelock,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);
    await configuratorAsProxy
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelock.address);

    await expect(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setGovernor(cometProxy.address, alice.address)
    ).to.be.revertedWithCustomError(configuratorAsProxy, 'Unauthorized');
  });
});
