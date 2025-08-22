import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { extractProposalIdFromLogs } from './helpers';

/**
 * Proposes a combined Comet upgrade and reward configuration through governance
 * This function creates a single proposal with both actions
 */
export async function proposeCometUpgrade(
  deploymentManager: DeploymentManager,
  newImplementationAddress: string,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const trace = deploymentManager.tracer();
  
  // Get required contracts
  const governor = await deploymentManager.getContractOrThrow('governor');
  const cometAdmin = await deploymentManager.getContractOrThrow('cometAdmin');
  const comet = await deploymentManager.getContractOrThrow('comet');
  const rewards = await deploymentManager.getContractOrThrow('rewards');
  const COMP = await deploymentManager.getContractOrThrow('COMP');
  
  // Prepare proposal data
  const targets: string[] = [];
  const values: number[] = [];
  const calldatas: string[] = [];

  const rewardTokenAddress = COMP.address;
  
  // Action 1: upgrade the Comet proxy to the new implementation
  targets.push(cometAdmin.address);
  values.push(0);
  calldatas.push(
    cometAdmin.interface.encodeFunctionData('upgrade', [
      comet.address,
      newImplementationAddress
    ])
  );
  
  // Action 2: initialize storage in the Comet contract (only if not already initialized)
  const totalsBasic = await comet.totalsBasic();
  const isStorageInitialized = totalsBasic.lastAccrualTime !== 0n;
  
  if (!isStorageInitialized) {
    targets.push(comet.address);
    values.push(0);
    calldatas.push(
      comet.interface.encodeFunctionData('initializeStorage', [])
    );
  }
  
  // Action 3: set reward configuration for the Comet instance (only if not already set)
  const currentRewardConfig = await rewards.rewardConfig(comet.address);
  const isRewardSet = currentRewardConfig.token !== '0x0000000000000000000000000000000000000000';
  
  if (!isRewardSet) {
    targets.push(rewards.address);
    values.push(0);
    calldatas.push(
      rewards.interface.encodeFunctionData('setRewardConfig', [
        comet.address,
        rewardTokenAddress
      ])
    );
  }
  
  const description = `Upgrade Comet implementation to ${newImplementationAddress}${!isStorageInitialized ? ', initialize storage' : ''}${!isRewardSet ? `, and set reward token to ${rewardTokenAddress}` : ''}`;
  
  trace(`Creating combined upgrade and reward config proposal:`);
  trace(`1. upgrade(${comet.address}, ${newImplementationAddress})`);
  if (!isStorageInitialized) {
    trace(`2. initializeStorage()`);
  } else {
    trace(`2. Skipping initializeStorage - already initialized`);
  }
  if (!isRewardSet) {
    trace(`3. setRewardConfig(${comet.address}, ${rewardTokenAddress})`);
  } else {
    trace(`3. Skipping setRewardConfig - already configured with token: ${currentRewardConfig.token}`);
  }
  
  // Submit proposal to governor
  trace(`Submitting combined proposal to governor`);
  
  const tx = await governor.connect(admin).propose(
    targets,
    values,
    calldatas,
    description
  );
  
  const receipt = await tx.wait();
  trace(`Combined proposal submitted! Transaction hash: ${receipt.transactionHash}`);
  
  // Extract proposal ID from ProposalCreated event
  const proposalId = extractProposalIdFromLogs(governor, receipt);
  if (proposalId !== null) {
    trace(`Proposal ID: ${proposalId}`);
  } else {
    trace(`Warning: Could not find ProposalCreated event in logs`);
  }

  
  return {
    targets,
    values,
    calldatas,
    description,
    governor: governor.address,
    cometAdmin: cometAdmin.address,
    comet: comet.address,
    rewards: rewards.address,
    newImplementation: newImplementationAddress,
    rewardToken: rewardTokenAddress,
    proposalId,
    tx: receipt
  };
} 