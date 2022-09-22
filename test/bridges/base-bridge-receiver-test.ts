import { ethers, event, expect, wait } from './../helpers';
import {
  BaseBridgeReceiver__factory,
  Timelock__factory
} from '../../build/types';

async function makeBridgeReceiver({ initialize } = { initialize: true }) {
  const [_defaultSigner, govTimelockSigner] = await ethers.getSigners();

  const BaseBridgeReceiverFactory = (await ethers.getContractFactory('BaseBridgeReceiver')) as BaseBridgeReceiver__factory;
  const baseBridgeReceiver = await BaseBridgeReceiverFactory.deploy();
  await baseBridgeReceiver.deployed();

  const TimelockFactory = (await ethers.getContractFactory('Timelock')) as Timelock__factory;
  const timelock = await TimelockFactory.deploy(
    baseBridgeReceiver.address, // admin
    10 * 60,                    // delay
    14 * 24 * 60 * 60,          // gracePeriod
    10 * 60,                    // min delay
    30 * 24 * 60 * 60           // max delay
  );
  await timelock.deployed();

  if (initialize) {
    await baseBridgeReceiver.initialize(
      govTimelockSigner.address, // govTimelock
      timelock.address           // localTimelock
    );
  }

  return {
    baseBridgeReceiver,
    timelock,
    govTimelockSigner
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
      timelock,
      govTimelockSigner
    } = await makeBridgeReceiver({ initialize: false });

    const tx = await wait(baseBridgeReceiver.initialize(govTimelockSigner.address, timelock.address));

    expect(await baseBridgeReceiver.govTimelock()).to.eq(govTimelockSigner.address);
    expect(await baseBridgeReceiver.localTimelock()).to.eq(timelock.address);
    expect(await baseBridgeReceiver.initialized()).to.eq(true);

    expect(event(tx, 0)).to.be.deep.equal({
      Initialized: {
        govTimelock: govTimelockSigner.address,
        localTimelock: timelock.address
      }
    });
  });

  it('cannot be reinitialized', async () => {
    const {
      baseBridgeReceiver,
      timelock,
      govTimelockSigner
    } = await makeBridgeReceiver({initialize: true});

    await expect(
      baseBridgeReceiver.initialize(govTimelockSigner.address, timelock.address)
    ).to.be.revertedWith("custom error 'AlreadyInitialized()'");
  });

  it('acceptLocalTimelockAdmin reverts if not called by localTimelock', async () => {
    const { baseBridgeReceiver } = await makeBridgeReceiver();

    await expect(
      baseBridgeReceiver.acceptLocalTimelockAdmin()
    ).to.be.revertedWith("custom error 'Unauthorized()'");
  });

  // setLocalTimelock > sets new timelock

  // setLocalTimelock > reverts for unuauthorized

  // setGovTimelock > sets gov timelock

  // setGovTimelock > reverts for unauthorized

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
});