import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { Contract } from 'ethers';
import { expectApproximately } from '../../../../scenario/utils';

const STREAM_CONTROLLER = '0x3E67cc2C7fFf86d9870dB9D02c43e789B52FB296';
const VAULT = '0x8624f61Cc6e5A86790e173712AfDd480fa8b73Ba';
const WOOF = '0x05ED81814BE2D9731c8906133236FFE9C62B013E';

const upfrontAmount = exp(300_000, 6);
const streamAmount  = exp(300_000, 6);
const streamDuration = 60 * 60 * 24 * 30 * 6; // 6 months
const amountPerSec = streamAmount * exp(1,14) / BigInt(streamDuration);

let balanceBefore: bigint;


export default migration('1732804028_pay_woof', {
  async prepare() {
    return {};
  },
  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();
    const {
      governor,
      USDC,
      timelock,
      comet
    } = await deploymentManager.getContracts();

    balanceBefore = (await USDC.balanceOf(WOOF)).toBigInt();

    const streamController = new Contract(
      STREAM_CONTROLLER,
      [
        'function createStream(address token, address to, uint216 amountPerSec, uint256 duration) external',
        'function depositAndCreate(uint amountToDeposit, address to, uint216 amountPerSec) external',
      ],
      deploymentManager.hre.ethers.provider
    );
    
    const vault = new Contract(
      VAULT,
      [
        'function deposit(tuple(address asset,uint256 value)[] calldata) external',
        'function execute(tuple(address target, uint256 value, bytes data)) external',
      ],
      deploymentManager.hre.ethers.provider
    );

    const cometWithdrawCalldata = (
      await comet.populateTransaction.withdrawTo(timelock.address, USDC.address, upfrontAmount + streamAmount)
    ).data;
    const executeCometWithdrawCalldata = await calldata(vault.populateTransaction.execute({
      target: comet.address,
      value: 0,
      data: cometWithdrawCalldata
    }));

    const approveCalldata = (await USDC.populateTransaction.approve(STREAM_CONTROLLER, streamAmount)).data;
    const executeApproveCalldata = await calldata(vault.populateTransaction.execute({
      target: USDC.address,
      value: 0,
      data: approveCalldata
    }));

    const depositAndCreateStreamCalldata = (
      await streamController.populateTransaction.depositAndCreate(streamAmount, WOOF, amountPerSec)
    ).data;
    const executeDepositAndCreateStreamCalldata = await calldata(vault.populateTransaction.execute({
      target: STREAM_CONTROLLER,
      value: 0,
      data: depositAndCreateStreamCalldata
    }));

    const mainnetActions = [
      // 1. Withdraw the upfront and stream amount from Comet
      {
        target: VAULT,
        signature: 'execute((address,uint256,bytes))',
        calldata: executeCometWithdrawCalldata,
      },
      // 2. Approve to the vault
      {
        contract: USDC,
        signature: 'transfer(address,uint256)',
        args: [VAULT, streamAmount],
      },
      {
        target: VAULT,
        signature: 'execute((address,uint256,bytes))',
        calldata: executeApproveCalldata,
      },
      // 3. Deposit and create the stream
      {
        target: VAULT,
        signature: 'execute((address,uint256,bytes))',
        calldata: executeDepositAndCreateStreamCalldata,
      },
      // 4. Transfer the upfront amount to the WOOF treasury
      {
        contract: USDC,
        signature: 'transfer(address,uint256)',
        args: [WOOF, upfrontAmount],
      },
    ];
    const description = '';
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );
    const event = txn.events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },
  async verify(deploymentManager: DeploymentManager) {
    const { USDC } = await deploymentManager.getContracts();

    expect((await USDC.balanceOf(WOOF)).sub(balanceBefore)).to.equal(upfrontAmount);
    const stream = new Contract(
      STREAM_CONTROLLER,
      [
        'function withdraw(address from, address to, uint216 amountPerSec) external',
      ],
      deploymentManager.hre.ethers.provider
    );

    // impersonate woof and try claiming
    await deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [WOOF]
    });
    const signer2 = await deploymentManager.hre.ethers.provider.getSigner(WOOF);
    await deploymentManager.hre.network.provider.send('hardhat_setBalance', [
      WOOF,
      deploymentManager.hre.ethers.utils.hexStripZeros(deploymentManager.hre.ethers.utils.parseEther('100').toHexString()),
    ]);
    await deploymentManager.hre.network.provider.send('evm_increaseTime', [streamDuration]);
    await deploymentManager.hre.network.provider.send('evm_mine'); // ensure block is mined

    const _balanceBefore = await USDC.balanceOf(WOOF);
    await (await stream.connect(signer2).withdraw(VAULT, WOOF, amountPerSec)).wait();
    const _balanceAfter = await USDC.balanceOf(WOOF);
    expectApproximately(
      _balanceAfter.sub(_balanceBefore).toBigInt(),
      streamAmount,
      1n
    );
  },
});