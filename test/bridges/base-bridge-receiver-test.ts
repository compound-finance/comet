import { ethers, event, expect, wait } from './../helpers';
import {
  BaseBridgeReceiver__factory,
  Timelock__factory
} from '../../build/types';

async function makeTimelock({ admin }: { admin: string }) {
  const TimelockFactory = (await ethers.getContractFactory('Timelock')) as Timelock__factory;
  const timelock = await TimelockFactory.deploy(
    admin,              // admin
    10 * 60,            // delay
    14 * 24 * 60 * 60,  // gracePeriod
    10 * 60,            // min delay
    30 * 24 * 60 * 60   // max delay
  );
  await timelock.deployed();
  return timelock;
}

async function makeBridgeReceiver({ initialize } = { initialize: true }) {
  const [_defaultSigner, govTimelockAdmin, ...signers] = await ethers.getSigners();

  const BaseBridgeReceiverFactory = (await ethers.getContractFactory('BaseBridgeReceiver')) as BaseBridgeReceiver__factory;
  const baseBridgeReceiver = await BaseBridgeReceiverFactory.deploy();
  await baseBridgeReceiver.deployed();

  const govTimelock = await makeTimelock({ admin: govTimelockAdmin.address });
  const localTimelock = await makeTimelock({ admin: baseBridgeReceiver.address });

  if (initialize) {
    await baseBridgeReceiver.initialize(
      govTimelock.address,   // govTimelock
      localTimelock.address  // localTimelock
    );
  }

  return {
    baseBridgeReceiver,
    govTimelock,
    localTimelock,
    signers
  };
}

// XXX remove .only
describe.only('BaseBridgeReceiver', function () {
  it('is initialized with empty storage values', async () => {
    const { baseBridgeReceiver } = await makeBridgeReceiver({initialize: false});

    expect(await baseBridgeReceiver.govTimelock()).to.eq(ethers.constants.AddressZero);
    expect(await baseBridgeReceiver.localTimelock()).to.eq(ethers.constants.AddressZero);
    expect(await baseBridgeReceiver.initialized()).to.eq(false);
  });

  it('initializing sets values', async () => {
    const {
      baseBridgeReceiver,
      govTimelock,
      localTimelock,
    } = await makeBridgeReceiver({ initialize: false });

    const tx = await wait(baseBridgeReceiver.initialize(govTimelock.address, localTimelock.address));

    expect(await baseBridgeReceiver.govTimelock()).to.eq(govTimelock.address);
    expect(await baseBridgeReceiver.localTimelock()).to.eq(localTimelock.address);
    expect(await baseBridgeReceiver.initialized()).to.eq(true);

    expect(event(tx, 0)).to.be.deep.equal({
      Initialized: {
        govTimelock: govTimelock.address,
        localTimelock: localTimelock.address
      }
    });
  });

  it('cannot be reinitialized', async () => {
    const {
      baseBridgeReceiver,
      govTimelock,
      localTimelock
    } = await makeBridgeReceiver({initialize: true});

    await expect(
      baseBridgeReceiver.initialize(govTimelock.address, localTimelock.address)
    ).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  it('acceptLocalTimelockAdmin reverts if not called by localTimelock', async () => {
    const { baseBridgeReceiver } = await makeBridgeReceiver();

    await expect(
      baseBridgeReceiver.acceptLocalTimelockAdmin()
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('setLocalTimelock > reverts for unuauthorized caller', async () => {
    const {
      baseBridgeReceiver,
      localTimelock
    } = await makeBridgeReceiver();

    await expect(
      baseBridgeReceiver.setLocalTimelock(localTimelock.address)
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('setLocalTimelock > sets new timelock', async () => {
    const {
      baseBridgeReceiver,
      govTimelock,
      signers
    } = await makeBridgeReceiver({ initialize: false });

    const [localTimelockSigner, newLocalTimelockSigner] = signers;

    await baseBridgeReceiver.initialize(
      govTimelock.address,
      localTimelockSigner.address
    );

    const tx = await wait(
      baseBridgeReceiver.connect(localTimelockSigner).setLocalTimelock(
        newLocalTimelockSigner.address
      )
    );

    expect(await baseBridgeReceiver.localTimelock()).to.eq(newLocalTimelockSigner.address);

    expect(event(tx, 0)).to.be.deep.equal({
      NewLocalTimelock: {
        newLocalTimelock: newLocalTimelockSigner.address,
        oldLocalTimelock: localTimelockSigner.address
      }
    });
  });

  it('setGovTimelock > reverts for unauthorized caller', async () => {
    const {
      baseBridgeReceiver,
      govTimelock
    } = await makeBridgeReceiver();

    await expect(
      baseBridgeReceiver.setGovTimelock(govTimelock.address)
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  // setGovTimelock > sets gov timelock

  // processMessage > reverts unauthorized

  // processMessage > reverts for bad data

  // processMessage > queues transactions

  // processMessage > stores a proposal

  // processMessage > reverts for repeated transactions

  // executeProposal > reverts if not queued

  // executeProposal > executes the transactions

  // state > reverts for invalid proposal id

  // state > returns executed

  // state > returns expired

  // state > returns queued

  // acceptLocalTimelockAdmin > calls acceptAdmin
});