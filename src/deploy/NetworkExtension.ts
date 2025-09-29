import { Proposal } from '../governor/models';
import { DeploymentManager } from '../../plugins/deployment_manager';

/**
 * Creates a Comet upgrade proposal with optional storage initialization and reward configuration
 * This function only creates the proposal data
 */
export async function getCometUpgradeProposal(
  deploymentManager: DeploymentManager,
  newImplementationAddress: string
): Promise<Proposal> {
  const trace = deploymentManager.tracer();
  
  // Get required contracts
  const cometAdmin = await deploymentManager.getContractOrThrow('cometAdmin');
  const comet = await deploymentManager.getContractOrThrow('comet');
  const rewards = await deploymentManager.getContractOrThrow('rewards');
  const COMP = await deploymentManager.getContractOrThrow('COMP');

  const rewardTokenAddress = COMP.address;
  
  // Build proposal arrays
  const targets = [];
  const values = [];
  const calldatas = [];
  
  // Action 1: upgrade the Comet proxy to the new implementation
  targets.push(cometAdmin.address);
  values.push(0);
  calldatas.push(cometAdmin.interface.encodeFunctionData('upgrade', [comet.address, newImplementationAddress]));
  
  // Action 2: initialize storage in the Comet contract (only if not already initialized)
  const totalsBasic = await comet.totalsBasic();
  const isStorageInitialized = totalsBasic.lastAccrualTime !== 0n;
  
  if (!isStorageInitialized) {
    targets.push(comet.address);
    values.push(0);
    calldatas.push(comet.interface.encodeFunctionData('initializeStorage', []));
  }
  
  // Action 3: set reward configuration for the Comet instance (only if not already set)
  const currentRewardConfig = await rewards.rewardConfig(comet.address);
  const isRewardSet = currentRewardConfig.token !== '0x0000000000000000000000000000000000000000';
  
  if (!isRewardSet) {
    targets.push(rewards.address);
    values.push(0);
    calldatas.push(rewards.interface.encodeFunctionData('setRewardConfig', [comet.address, rewardTokenAddress]));
  }
  
  const description = `Upgrade Comet implementation to ${newImplementationAddress}${!isStorageInitialized ? ', initialize storage' : ''}${!isRewardSet ? `, and set reward token to ${rewardTokenAddress}` : ''}`;
  
  trace(`Creating Comet upgrade proposal:`);
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

  return {
    targets,
    values,
    calldatas,
    description
  };
}
