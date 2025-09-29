import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { TimelockService } from '../services/TimelockService';

/**
 * Task for queueing proposals
 */
export default async function queueProposalTask(
  hre: HardhatRuntimeEnvironment, 
  proposalId: number
): Promise<any> {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  
  if (!deploymentManager) {
    throw new Error('DeploymentManager not found. Make sure to call createDeploymentManager first.');
  }
  
  console.log(`Queueing proposal ${proposalId}...`);
  
  try {
    const service = new TimelockService(deploymentManager);
    const result = await service.queueProposal(proposalId);
    
    console.log(`✅ Proposal ${proposalId} queued successfully!`);
    console.log(`   Transaction hash: ${result.transactionHash}`);
    console.log(`   ETA: ${result.eta}`);
    console.log(`   Execution time: ${result.executionTime.toLocaleString()}`);
    
    // Show timing information
    const timing = await service.getProposalTiming(proposalId);
    console.log(`\n⏰ Execution Timing Information:`);
    console.log(`   Time until execution: ${Math.floor(timing.timeUntilExecution / 3600)} hours ${Math.floor((timing.timeUntilExecution % 3600) / 60)} minutes`);
    console.log(`   Execution time: ${timing.executionTime.toLocaleString()}`);
    
    return result;
  } catch (error) {
    console.error(`❌ Failed to queue proposal ${proposalId}:`, error);
    throw error;
  }
}
