import { ethers, exp, expect, wait } from './../helpers';
import { utils } from 'ethers';
import {
  SweepableBridgeReceiverHarness__factory,
  FaucetToken__factory,
  NonStandardFaucetToken__factory,
} from '../../build/types';
import { encodeBridgeReceiverCalldata, makeTimelock } from './base-bridge-receiver-test';

async function makeSweepableBridgeReceiver({ initialize } = { initialize: true }) {
  const [_defaultSigner, govTimelockAdmin, ...signers] = await ethers.getSigners();

  const SweepableBridgeReceiverFactory = (await ethers.getContractFactory('SweepableBridgeReceiverHarness')) as SweepableBridgeReceiverHarness__factory;
  const sweepableBridgeReceiver = await SweepableBridgeReceiverFactory.deploy();
  await sweepableBridgeReceiver.deployed();

  const govTimelock = await makeTimelock({ admin: govTimelockAdmin.address });
  const localTimelock = await makeTimelock({ admin: sweepableBridgeReceiver.address });

  if (initialize) {
    await sweepableBridgeReceiver.initialize(
      govTimelock.address,   // govTimelock
      localTimelock.address  // localTimelock
    );
  }

  return {
    sweepableBridgeReceiver,
    govTimelock,
    localTimelock,
    signers
  };
}

async function makeFaucetToken(initialAmount: number, name: string, decimals: number, symbol: string) {
  const FaucetFactory = (await ethers.getContractFactory('FaucetToken')) as FaucetToken__factory;
  const token = await FaucetFactory.deploy(initialAmount, name, decimals, symbol);
  await token.deployed();

  return token;
}

async function proposeAndExecute(sweepableBridgeReceiver, govTimelock, { targets, values, signatures, calldatas }) {
  // enqueue proposal to sweep tokens
  const calldata = encodeBridgeReceiverCalldata({
    targets,
    values,
    signatures,
    calldatas
  });
  await sweepableBridgeReceiver.processMessageExternal(govTimelock.address, calldata);

  // execute proposal to sweep tokens
  const { eta } = await sweepableBridgeReceiver.proposals(1);
  await ethers.provider.send('evm_setNextBlockTimestamp', [eta.toNumber()]);
  await wait(sweepableBridgeReceiver.executeProposal(1));
}

describe('SweepableBridgeReceiver', async() => {
  it('sweeps standard ERC20 token', async () => {
    const { sweepableBridgeReceiver, localTimelock, govTimelock, signers } = await makeSweepableBridgeReceiver();
    const [alice] = signers;

    const USDC = await makeFaucetToken(1e6, 'USDC', 6, 'USDC');

    // Alice "accidentally" sends 10 USDC to the SweepableBridgeReceiver
    const transferAmount = exp(10, 6);
    await USDC.allocateTo(alice.address, transferAmount);
    await USDC.connect(alice).transfer(sweepableBridgeReceiver.address, transferAmount);

    const oldBridgeReceiverBalance = await USDC.balanceOf(sweepableBridgeReceiver.address);
    const oldTimelockBalance = await USDC.balanceOf(localTimelock.address);

    await proposeAndExecute(
      sweepableBridgeReceiver,
      govTimelock,
      {
        targets: [sweepableBridgeReceiver.address],
        values: [0],
        signatures: ['sweepToken(address,address)'],
        calldatas: [
          utils.defaultAbiCoder.encode(['address', 'address'], [localTimelock.address, USDC.address]),
        ]
      }
    );

    const newBridgeReceiverBalance = await USDC.balanceOf(sweepableBridgeReceiver.address);
    const newTimelockBalance = await USDC.balanceOf(localTimelock.address);

    expect(newBridgeReceiverBalance.sub(oldBridgeReceiverBalance)).to.be.equal(-transferAmount);
    expect(newTimelockBalance.sub(oldTimelockBalance)).to.be.equal(transferAmount);
  });

  it('sweeps non-standard ERC20 token', async () => {
    const { sweepableBridgeReceiver, localTimelock, govTimelock, signers } = await makeSweepableBridgeReceiver();
    const [alice] = signers;

    // Deploy non-standard token
    const NonStandardFaucetFactory = (await ethers.getContractFactory('NonStandardFaucetToken')) as NonStandardFaucetToken__factory;
    const nonStandardToken = await NonStandardFaucetFactory.deploy(1000e6, 'Tether', 6, 'USDT');
    await nonStandardToken.deployed();

    // Alice "accidentally" sends 10 non-standard tokens to the Bulker
    const transferAmount = exp(10, 6);
    await nonStandardToken.allocateTo(alice.address, transferAmount);
    await nonStandardToken.connect(alice).transfer(sweepableBridgeReceiver.address, transferAmount);

    const oldBridgeReceiverBalance = await nonStandardToken.balanceOf(sweepableBridgeReceiver.address);
    const oldTimelockBalance = await nonStandardToken.balanceOf(localTimelock.address);

    await proposeAndExecute(
      sweepableBridgeReceiver,
      govTimelock,
      {
        targets: [sweepableBridgeReceiver.address],
        values: [0],
        signatures: ['sweepToken(address,address)'],
        calldatas: [
          utils.defaultAbiCoder.encode(['address', 'address'], [localTimelock.address, nonStandardToken.address]),
        ]
      }
    );

    const newBridgeReceiverBalance = await nonStandardToken.balanceOf(sweepableBridgeReceiver.address);
    const newTimelockBalance = await nonStandardToken.balanceOf(localTimelock.address);

    expect(newBridgeReceiverBalance.sub(oldBridgeReceiverBalance)).to.be.equal(-transferAmount);
    expect(newTimelockBalance.sub(oldTimelockBalance)).to.be.equal(transferAmount);
  });

  it('sweeps native token', async () => {
    const { sweepableBridgeReceiver, localTimelock, govTimelock, signers } = await makeSweepableBridgeReceiver();
    const [alice] = signers;

    // Alice "accidentally" sends 1 ETH to the sweepableBridgeReceiver
    const transferAmount = exp(1, 18);
    await alice.sendTransaction({ to: sweepableBridgeReceiver.address, value: transferAmount });

    const oldBridgeReceiverBalance = await ethers.provider.getBalance(sweepableBridgeReceiver.address);
    const oldTimelockBalance = await ethers.provider.getBalance(localTimelock.address);

    await proposeAndExecute(
      sweepableBridgeReceiver,
      govTimelock,
      {
        targets: [sweepableBridgeReceiver.address],
        values: [0],
        signatures: ['sweepNativeToken(address)'],
        calldatas: [
          utils.defaultAbiCoder.encode(['address'], [localTimelock.address]),
        ]
      }
    );

    const newBridgeReceiverBalance = await ethers.provider.getBalance(sweepableBridgeReceiver.address);
    const newTimelockBalance = await ethers.provider.getBalance(localTimelock.address);

    expect(newBridgeReceiverBalance.sub(oldBridgeReceiverBalance)).to.be.equal(-transferAmount);
    expect(newTimelockBalance.sub(oldTimelockBalance)).to.be.equal(transferAmount);
  });

  it('reverts if sweepToken is called by address other than local timelock', async () => {
    const { sweepableBridgeReceiver, signers } = await makeSweepableBridgeReceiver();
    const [alice] = signers;

    const USDC = await makeFaucetToken(1e6, 'USDC', 6, 'USDC');

    // Alice sweeps tokens
    await expect(sweepableBridgeReceiver.connect(alice).sweepToken(alice.address, USDC.address))
      .to.be.revertedWith("custom error 'Unauthorized()'");
  });

  it('reverts if sweepNativeToken is called by non-admin', async () => {
    const { sweepableBridgeReceiver, signers } = await makeSweepableBridgeReceiver();
    const [alice] = signers;

    // Alice sweeps ETH
    await expect(sweepableBridgeReceiver.connect(alice).sweepNativeToken(alice.address))
      .to.be.revertedWith("custom error 'Unauthorized()'");
  });
});