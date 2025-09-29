import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ExecutionService } from '../services/ExecutionService';
import { ExecutionType } from '../models/ExecutionResult';

/**
 * Task for executing proposals
 */
export default async function executeProposalTask(
  hre: HardhatRuntimeEnvironment, 
  proposalId: number, 
  executionType: ExecutionType
): Promise<any> {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  
  if (!deploymentManager) {
    throw new Error('DeploymentManager not found. Make sure to call createDeploymentManager first.');
  }
  
  console.log(`Executing proposal ${proposalId} with execution type: ${executionType}...`);
  
  try {
    const service = new ExecutionService(deploymentManager);
    const result = await service.executeProposal(proposalId, executionType);
    
    console.log(`✅ Proposal ${proposalId} executed successfully!`);
    console.log(`   Transaction hash: ${result.transactionHash}`);
    
    return result;
  } catch (error) {
    console.error(`❌ Failed to execute proposal ${proposalId}:`, error);
    throw error;
  }
}
