import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { Contract } from 'ethers';

const STREAM_CONTROLLER = '0x3DF2AAEdE81D2F6b261F79047517713B8E844E04';

const RECEIVER = '0xc10785fB7b1adD4fD521A27d0d55c5561EEf0940';

const totalAmount = exp(127_426, 18);
const upfrontAmount = totalAmount / 3n;
const streamAmount  = totalAmount - upfrontAmount;
const streamDuration = 60 * 60 * 24 * 30 * 9; // 9 months
const amountPerSec = streamAmount / BigInt(streamDuration);

let balanceBefore: bigint;

export default migration('1742901113_create_sablier_stream', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();
    const {
      timelock,
      governor,
      comptrollerV2,
      COMP
    } = await deploymentManager.getContracts();

    balanceBefore = (await COMP.balanceOf(RECEIVER)).toBigInt();

    const streamController = new Contract(
      STREAM_CONTROLLER,
      [
        'function createAndDeposit(address,address,uint128,address,bool,uint128) external',
        'function nextStreamId() external view returns (uint256)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const mainnetActions = [
      // 1. Withdraw the upfront amount from Comptroller to receiver
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [RECEIVER, upfrontAmount],
      },
      // 2. Withdraw the stream amount from Comptroller to timelock
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [timelock.address, streamAmount],
      },
      // 3. Approve the stream amount from Timelock to stream controller
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args: [STREAM_CONTROLLER, streamAmount],
      },
      // 4. Create a stream
      {
        contract: streamController,
        signature: 'createAndDeposit(address,address,uint128,address,bool,uint128)',
        args: [timelock.address, RECEIVER, amountPerSec, COMP.address, false, streamAmount],
      },
    ];
    const description = 'DESCRIPTION';
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
    trace(`Stream id: ${(await streamController.nextStreamId()).toBigInt() - 1n}`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { COMP } = await deploymentManager.getContracts();

    // impersonate receiver
    await deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [RECEIVER],
    });
    await deploymentManager.hre.network.provider.send('hardhat_setBalance', [
      RECEIVER,
      '0x56BC75E2D63100000',
    ]);
    const signer = await deploymentManager.hre.ethers.provider.getSigner(RECEIVER);

    const streamController = new Contract(
      STREAM_CONTROLLER,
      [
        'function withdraw(uint256 streamId,address to,uint128 amount) external',
        'function nextStreamId() external view returns (uint256)',
        'function getStream(uint256 streamId) external view returns (uint128 balance,uint128 ratePerSecond,address sender,uint40 snapshotTime,bool isStream,bool isTransferable,bool isVoided,address token,uint8 tokenDecimals,uint256 snapshotDebtScaled)',
      ],
      deploymentManager.hre.ethers.provider
    );

    // advance time
    await deploymentManager.hre.ethers.provider.send('evm_increaseTime', [streamDuration]);
    await deploymentManager.hre.ethers.provider.send('evm_mine', []);

    const tx = await streamController.connect(signer).withdraw((await streamController.nextStreamId()).toBigInt() - 1n, RECEIVER, streamAmount);
    await tx.wait();
    // skip duration time
    expect((await COMP.balanceOf(RECEIVER)).sub(balanceBefore)).to.equal(upfrontAmount + streamAmount);
  },
});
