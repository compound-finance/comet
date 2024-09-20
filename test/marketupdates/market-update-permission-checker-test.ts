import {event, expect, wait} from './../helpers';
import {createRandomWallet, makeMarketAdmin} from './market-updates-helper';
import { ethers } from 'hardhat';

describe('MarketUpdatePermissionChecker', () => {
  it('only the owner can update the market admin', async () => {
    const {
      marketAdminPermissionCheckerContract,

      governorTimelockSigner,
      marketUpdateTimelockSigner,
      marketUpdateMultiSig,
    } = await makeMarketAdmin();

    expect(await marketAdminPermissionCheckerContract.connect(governorTimelockSigner.address).owner()).to.be.equal(governorTimelockSigner.address);
    const oldMarketAdmin = await marketAdminPermissionCheckerContract.marketAdmin();

    // Add a check to make sure its set to marketUpdateTimelockSigner initially
    expect(oldMarketAdmin).to.be.equal(marketUpdateTimelockSigner.address);

    const newMarketAdminWallet = ethers.Wallet.createRandom();

    const txn = await wait(
      marketAdminPermissionCheckerContract
        .connect(governorTimelockSigner)
        .setMarketAdmin(newMarketAdminWallet.address)
    );
    expect(event(txn, 0)).to.be.deep.equal({
      SetMarketAdmin: {
        oldAdmin: oldMarketAdmin,
        newAdmin: newMarketAdminWallet.address,
      },
    });
    const newMarketAdmin = await marketAdminPermissionCheckerContract.marketAdmin();
    expect(newMarketAdmin).to.be.equal(newMarketAdminWallet.address);
    expect(newMarketAdmin).to.be.not.equal(oldMarketAdmin);

    await expect(
      marketAdminPermissionCheckerContract
        .connect(marketUpdateMultiSig)
        .setMarketAdmin(newMarketAdminWallet.address)
    ).to.be.revertedWith('Ownable: caller is not the owner');

    await expect(
      marketAdminPermissionCheckerContract
        .connect(marketUpdateTimelockSigner)
        .setMarketAdmin(newMarketAdminWallet.address)
    ).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('only the owner can set the market admin pause guardian', async () => {
    const {
      marketAdminPermissionCheckerContract,
      governorTimelockSigner,
      marketUpdateMultiSig,
      marketUpdateTimelockSigner,
      marketAdminPauseGuardianSigner
    } = await makeMarketAdmin();

    const alice = ethers.Wallet.createRandom();

    const oldMarketAdminPauseGuardian = await marketAdminPermissionCheckerContract.marketAdminPauseGuardian();
    expect(oldMarketAdminPauseGuardian).to.be.equal(
      marketAdminPauseGuardianSigner.address
    );

    const txn = await wait(
      marketAdminPermissionCheckerContract
        .connect(governorTimelockSigner)
        .setMarketAdminPauseGuardian(alice.address)
    );
    expect(event(txn, 0)).to.be.deep.equal({
      SetMarketAdminPauseGuardian: {
        oldPauseGuardian: oldMarketAdminPauseGuardian,
        newPauseGuardian: alice.address,
      },
    });
    const newMarketAdminPauseGuardian = await marketAdminPermissionCheckerContract.marketAdminPauseGuardian();
    expect(newMarketAdminPauseGuardian).to.be.equal(alice.address);
    expect(newMarketAdminPauseGuardian).to.be.not.equal(
      oldMarketAdminPauseGuardian
    );
    await expect(
      marketAdminPermissionCheckerContract
        .connect(marketUpdateMultiSig)
        .setMarketAdminPauseGuardian(marketUpdateTimelockSigner.address)
    ).to.be.revertedWith('Ownable: caller is not the owner');

    await expect(
      marketAdminPermissionCheckerContract
        .connect(marketUpdateTimelockSigner)
        .setMarketAdminPauseGuardian(marketUpdateTimelockSigner.address)
    ).to.be.revertedWith('Ownable: caller is not the owner');

  });

  it('only the owner can pause the market admin', async () => {
    const {
      marketAdminPermissionCheckerContract,
      governorTimelockSigner,
    } = await makeMarketAdmin();

    const alice = await createRandomWallet();

    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.false;

    await marketAdminPermissionCheckerContract
      .connect(governorTimelockSigner)
      .setMarketAdminPauseGuardian(alice.address);

    expect(
      await marketAdminPermissionCheckerContract.marketAdminPauseGuardian()
    ).to.be.equal(alice.address);

    const txn = await wait(
      marketAdminPermissionCheckerContract.connect(alice).pauseMarketAdmin()
    );

    expect(event(txn, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        caller: alice.address,
        isMarketAdminPaused: true,
      },
    });
    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.true;
  });

  it('only the owner can unpause the market admin', async () => {
    const { marketAdminPermissionCheckerContract, governorTimelockSigner } = await makeMarketAdmin();

    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.false;

    const txnOfPause = await wait(
      marketAdminPermissionCheckerContract.connect(governorTimelockSigner).pauseMarketAdmin()
    );

    expect(event(txnOfPause, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        caller: governorTimelockSigner.address,
        isMarketAdminPaused: true,
      },
    });
    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.true;

    const txnOfUnpause = await wait(
      marketAdminPermissionCheckerContract.connect(governorTimelockSigner).unpauseMarketAdmin()
    );

    expect(event(txnOfUnpause, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        caller: governorTimelockSigner.address,
        isMarketAdminPaused: false,
      },
    });
    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.false;

  });

  it('should throw an error if the passed address is not market admin when checking permission', async () => {
    const { marketAdminPermissionCheckerContract } = await makeMarketAdmin();

    const alice = await createRandomWallet();

    await expect(
      marketAdminPermissionCheckerContract
        .checkUpdatePermission(alice.address)
    ).to.be.revertedWithCustomError(marketAdminPermissionCheckerContract, 'Unauthorized');
  });

  it('should throw an error if the passed address is governor(timelock) when checking permission', async () => {
    const { marketAdminPermissionCheckerContract, governorTimelockSigner } = await makeMarketAdmin();

    await expect(
      marketAdminPermissionCheckerContract
        .checkUpdatePermission(governorTimelockSigner.address)
    ).to.be.revertedWithCustomError(marketAdminPermissionCheckerContract, 'Unauthorized');
  });

  it('should throw and error if the passed address is market admin but market admin is paused', async () => {
    const { marketAdminPermissionCheckerContract, governorTimelockSigner, marketUpdateTimelockSigner } = await makeMarketAdmin();

    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.false;

    const txn = await wait(
      marketAdminPermissionCheckerContract.connect(governorTimelockSigner).pauseMarketAdmin()
    );

    expect(event(txn, 0)).to.be.deep.equal({
      MarketAdminPaused: {
        caller: governorTimelockSigner.address,
        isMarketAdminPaused: true,
      },
    });

    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.true;

    await expect(
      marketAdminPermissionCheckerContract
        .checkUpdatePermission(marketUpdateTimelockSigner.address)
    ).to.be.revertedWithCustomError(marketAdminPermissionCheckerContract, 'MarketAdminIsPaused');
  });

  it('should not throw an error if the passed address is market admin and market admin is not paused', async () => {
    const { marketAdminPermissionCheckerContract, marketUpdateTimelockSigner } = await makeMarketAdmin();

    expect(await marketAdminPermissionCheckerContract.marketAdminPaused()).to.be.false;

    await expect(
      marketAdminPermissionCheckerContract
        .checkUpdatePermission(marketUpdateTimelockSigner.address)
    ).to.be.not.reverted;
  });

});
