import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { extractProposalIdFromLogs } from '../deploy/helpers';
import { utils } from 'ethers';

export default async function proposeGovernanceUpdateTask(
  hre: HardhatRuntimeEnvironment,
  newAdmins?: string[],
  newThreshold?: number,
  newTimelockDelay?: number
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

  console.log('📋 Creating governance update proposal...');
  
  // Determine what we're updating
  const updatingGovernance = newAdmins && newThreshold;
  const updatingTimelock = newTimelockDelay !== undefined;
  
  if (!updatingGovernance && !updatingTimelock) {
    throw new Error('At least one update (governance config or timelock delay) must be provided');
  }
  
  if (updatingGovernance) {
    console.log(`   New admins: ${newAdmins!.length} addresses`);
    console.log(`   New threshold: ${newThreshold}`);
  }
  if (updatingTimelock) {
    console.log(`   New timelock delay: ${newTimelockDelay} seconds`);
  }

  // Validate inputs only if updating governance
  if (updatingGovernance) {
    if (!newAdmins || newAdmins.length === 0) {
      throw new Error('At least one admin address is required');
    }
    
    if (!newThreshold || newThreshold <= 0) {
      throw new Error('Threshold must be greater than 0');
    }
    
    if (newThreshold > newAdmins.length) {
      throw new Error('Threshold cannot be greater than the number of admins');
    }
    
    // Validate addresses
    for (const admin of newAdmins) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(admin)) {
        throw new Error(`Invalid admin address: ${admin}`);
      }
    }
  }

  if (updatingTimelock && newTimelockDelay <= 0) {
    throw new Error('Timelock delay must be greater than 0');
  }

  // Prepare proposal data
  const targets: string[] = [];
  const values: number[] = [];
  const calldatas: string[] = [];

  // Action 1: Update governance configuration (if provided)
  if (updatingGovernance) {
    targets.push(governor.address);
    values.push(0);
    calldatas.push(
      governor.interface.encodeFunctionData('setGovernanceConfig', [newAdmins, newThreshold])
    );
  }

  // Action 2: Update timelock delay (if provided)
  if (updatingTimelock) {
    const delayBN = utils.parseUnits(newTimelockDelay.toString(), 0);
    targets.push(timelock.address);
    values.push(0);
    calldatas.push(
      timelock.interface.encodeFunctionData('setDelay', [delayBN])
    );
  }

  // Create description
  let description = '';
  if (updatingGovernance && updatingTimelock) {
    description = `Governance update: Set ${newAdmins.length} admins with threshold ${newThreshold} and update timelock delay to ${newTimelockDelay} seconds`;
  } else if (updatingGovernance) {
    description = `Governance update: Set ${newAdmins.length} admins with threshold ${newThreshold}`;
  } else if (updatingTimelock) {
    description = `Timelock delay update: Update timelock delay to ${newTimelockDelay} seconds`;
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
    
    console.log(`✅ Governance update proposal created successfully!`);
    console.log(`   Proposal ID: ${proposalId}`);
    console.log(`   Transaction hash: ${tx.hash}`);
    console.log(`   Block number: ${receipt.blockNumber}`);
    console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    
    let actionsDescription = '';
    if (updatingGovernance && updatingTimelock) {
      actionsDescription = 'governance config + timelock delay';
    } else if (updatingGovernance) {
      actionsDescription = 'governance config';
    } else if (updatingTimelock) {
      actionsDescription = 'timelock delay';
    }
    console.log(`   Actions: ${targets.length} (${actionsDescription})`);
  
    return {
      proposalId: proposalId.toString(),
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      newAdmins: updatingGovernance ? newAdmins : null,
      newThreshold: updatingGovernance ? newThreshold : null,
      newTimelockDelay: updatingTimelock ? newTimelockDelay : null,
      description,
      actions: targets.length,
      updatingGovernance,
      updatingTimelock
    };
  } catch (error) {
    console.error('❌ Failed to create governance update proposal:', error);
    throw error;
  }
}
