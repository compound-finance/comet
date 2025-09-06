import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { extractProposalIdFromLogs } from '../deploy/helpers';
import { utils } from 'ethers';

export default async function proposeTimelockDelayAndGovernanceUpdateTask(
  hre: HardhatRuntimeEnvironment,
  newAdmins: string[],
  newThreshold: number,
  newTimelockDelay?: number | null
): Promise<any> {
  const deploymentManager = (hre as any).deploymentManager;
  
  if (!deploymentManager) {
    throw new Error('DeploymentManager not found. Make sure to call createDeploymentManager first.');
  }

  // Get the governor and timelock contracts
  const governor = await deploymentManager.contract('governor');
  const timelock = await deploymentManager.contract('timelock');
  
  if (!governor) {
    throw new Error('Governor contract not found in deployment');
  }

  if (!timelock) {
    throw new Error('Timelock contract not found in deployment');
  }

  console.log('📋 Creating timelock delay and governance update proposal...');
  console.log(`   New admins: ${newAdmins.length} addresses`);
  console.log(`   New threshold: ${newThreshold}`);
  if (newTimelockDelay) {
    console.log(`   New timelock delay: ${newTimelockDelay} seconds`);
  }

  // Prepare proposal data
  const targets: string[] = [];
  const values: number[] = [];
  const calldatas: string[] = [];

  // Action 1: Update governance configuration
  targets.push(governor.address);
  values.push(0);
  calldatas.push(
    governor.interface.encodeFunctionData('setGovernanceConfig', [newAdmins, newThreshold])
  );

  // Action 2: Update timelock delay (if provided)
  if (newTimelockDelay) {
    const delayBN = utils.parseUnits(newTimelockDelay.toString(), 0);
    targets.push(timelock.address);
    values.push(0);
    calldatas.push(
      timelock.interface.encodeFunctionData('setDelay', [delayBN])
    );
  }

  // Create description
  let description = `Update governance configuration: Set ${newAdmins.length} admins with threshold ${newThreshold}`;
  if (newTimelockDelay) {
    description += ` and update timelock delay to ${newTimelockDelay} seconds`;
  }

  try {
    // Propose the combined changes
    const tx = await governor.propose(targets, values, calldatas, description);
    const receipt = await tx.wait();

    // Extract proposal ID from the ProposalCreated event
    const proposalId = extractProposalIdFromLogs(governor, receipt);
    
    if (!proposalId) {
      throw new Error('Proposal ID not found in transaction receipt');
    }
    
    console.log(`✅ Timelock delay and governance update proposal created successfully!`);
    console.log(`   Proposal ID: ${proposalId}`);
    console.log(`   Transaction hash: ${tx.hash}`);
    console.log(`   Block number: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`   Actions: ${targets.length} (governance config${newTimelockDelay ? ' + timelock delay' : ''})`);
  
    return {
      proposalId: proposalId.toString(),
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      newAdmins,
      newThreshold,
      newTimelockDelay,
      description,
      actions: targets.length
    };
  } catch (error) {
    console.error('❌ Failed to create timelock delay and governance update proposal:', error);
    throw error;
  }
}
