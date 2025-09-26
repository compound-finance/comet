import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { createProposalManager } from '../governor/helpers/proposalManager';

/**
 * Proposes a combined Comet upgrade and reward configuration through governance
 * This function creates a single proposal with both actions
 */
export async function proposeCometUpgrade(
  deploymentManager: DeploymentManager,
  newImplementationAddress: string,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const trace = deploymentManager.tracer();
  
  // Get required contracts
  const cometAdmin = await deploymentManager.getContractOrThrow('cometAdmin');
  const comet = await deploymentManager.getContractOrThrow('comet');
  const rewards = await deploymentManager.getContractOrThrow('rewards');
  const COMP = await deploymentManager.getContractOrThrow('COMP');

  const rewardTokenAddress = COMP.address;
  
  // Create proposal manager
  const proposalManager = createProposalManager(deploymentManager.network);
  if (!deploymentManager.config.batchdeploy) {
    await proposalManager.clearProposalStack();
  }
  
  // Action 1: upgrade the Comet proxy to the new implementation
  await proposalManager.addAction({
    contract: cometAdmin,
    signature: 'upgrade',
    args: [comet.address, newImplementationAddress]
  });
  
  // Action 2: initialize storage in the Comet contract (only if not already initialized)
  const totalsBasic = await comet.totalsBasic();
  const isStorageInitialized = totalsBasic.lastAccrualTime !== 0n;
  
  if (!isStorageInitialized) {
    await proposalManager.addAction({
      contract: comet,
      signature: 'initializeStorage',
      args: []
    });
  }
  
  // Action 3: set reward configuration for the Comet instance (only if not already set)
  const currentRewardConfig = await rewards.rewardConfig(comet.address);
  const isRewardSet = currentRewardConfig.token !== '0x0000000000000000000000000000000000000000';
  
  if (!isRewardSet) {
    await proposalManager.addAction({
      contract: rewards,
      signature: 'setRewardConfig',
      args: [comet.address, rewardTokenAddress]
    });
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
  
  // Set proposal description
  await proposalManager.setDescription(description);

  const proposalData = await proposalManager.toProposalData();
  
  if (!deploymentManager.config.batchdeploy) {
    // Execute the proposal
    trace('Starting proposal execution');
    const result = await proposalManager.executeProposal(deploymentManager, adminSigner);
    console.log(`📋 Proposal ID: ${result.proposalId}`);
    console.log(`🔗 Transaction Hash: ${result.transactionHash}`);
    console.log(`📝 Description: ${result.description}`);
    console.log(`🎯 Actions: ${result.targets.length} targets`);
  } else {
    trace('Executing proposal is disabled');
  }

  return proposalData;
} 