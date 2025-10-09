import { expect, makeConfigurator, event, wait } from './../helpers';
import { makeMarketAdmin } from './market-updates-helper';

describe('Configurator', function() {
  it('already initialized and is not able to initialize again with main-governor-timelock as admin', async () => {
    const {
      governorTimelockSigner,
    } = await makeMarketAdmin();

    const { configurator, configuratorProxy } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    // check already initialized properly
    expect(await configuratorAsProxy.version()).to.be.equal(1);
    expect(await configuratorAsProxy.governor()).to.be.equal(
      governorTimelockSigner.address
    );
    expect(await configuratorAsProxy.governor()).to.be.equal(
      governorTimelockSigner.address
    );

    // check is not able to initialize again
    await expect(
      configuratorAsProxy.initialize(governorTimelockSigner.address)
    ).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });




  it('only main-governor-timelock or market admin can call market update functions', async () => {
    const {
      governorTimelockSigner,
      marketUpdateTimelockSigner,
      marketAdminPermissionCheckerContract
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract: marketAdminPermissionCheckerContract
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

    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelockSigner.address);

    expect(await marketAdminPermissionCheckerContract.marketAdmin()).to.be.equal(
      marketUpdateTimelockSigner.address
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
      marketUpdateTimelockSigner,
      marketAdminPermissionCheckerContract
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
      users: [alice],
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract: marketAdminPermissionCheckerContract
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);

    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelockSigner.address);

    await expect(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setPauseGuardian(cometProxy.address, alice.address)
    ).to.be.revertedWithCustomError(configuratorAsProxy, 'Unauthorized');
  });

  it('market admin cannot call market update functions when marketAdminPaused', async () => {
    const {
      marketAdminPermissionCheckerContract,

      governorTimelockSigner,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract: marketAdminPermissionCheckerContract
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);


    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelockSigner.address);

    expect(await marketAdminPermissionCheckerContract.marketAdmin()).to.be.equal(
      marketUpdateTimelockSigner.address
    );

    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .pauseMarketAdmin();
    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.true;

    const newBorrowKink = 100n;
    await expect(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setBorrowKink(cometProxy.address, newBorrowKink)
    ).to.be.revertedWithCustomError(marketAdminPermissionCheckerContract,'MarketAdminIsPaused');
  });

  it('main-governor-timelock can call market update functions when marketAdminPaused', async () => {
    const { marketAdminPermissionCheckerContract, governorTimelockSigner } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);


    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .pauseMarketAdmin();
    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.true;

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
      marketAdminPermissionCheckerContract,

      governorTimelockSigner,
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

    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelockSigner.address);

    await expect(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setGovernor(cometProxy.address, alice.address)
    ).to.be.revertedWithCustomError(configuratorAsProxy, 'Unauthorized');
  });

  it('market admin can call market update functions when marketAdminPaused is changed to unpaused', async () => {
    const {
      marketAdminPermissionCheckerContract,

      governorTimelockSigner,
      marketUpdateTimelockSigner,
    } = await makeMarketAdmin();

    const {
      configurator,
      configuratorProxy,
      cometProxy,
    } = await makeConfigurator({
      governor: governorTimelockSigner,
      marketAdminPermissionCheckerContract: marketAdminPermissionCheckerContract
    });

    const configuratorAsProxy = configurator.attach(configuratorProxy.address);


    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .setMarketAdmin(marketUpdateTimelockSigner.address);

    expect(await marketAdminPermissionCheckerContract.marketAdmin()).to.be.equal(
      marketUpdateTimelockSigner.address
    );

    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .pauseMarketAdmin();
    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.true;

    const newBorrowKink = 100n;
    await expect(
      configuratorAsProxy
        .connect(marketUpdateTimelockSigner)
        .setBorrowKink(cometProxy.address, newBorrowKink)
    ).to.be.revertedWithCustomError(marketAdminPermissionCheckerContract,'MarketAdminIsPaused');

    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .unpauseMarketAdmin();
    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.false;

    const oldBorrowKink = (
      await configuratorAsProxy.getConfiguration(cometProxy.address)
    ).borrowKink;

    expect(oldBorrowKink).to.be.not.equal(newBorrowKink);

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


  });
});
