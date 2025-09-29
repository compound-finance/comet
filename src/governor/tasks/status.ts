import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ProposalService } from '../services/ProposalService';

/**
 * Task for getting proposal status
 */
export default async function getProposalStatusTask(
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
  
  console.log(`Checking status of proposal ${proposalId}...`);
  
  try {
    const service = new ProposalService(deploymentManager);
    const result = await service.getProposalStatus(proposalId);
    
    console.log(`📊 Proposal ${proposalId} Status:`);
    console.log(`   State: ${result.state}`);
    console.log(`   Proposer: ${result.proposal.proposer}`);
    console.log(`   ETA: ${result.proposal.eta}`);
    console.log(`   Canceled: ${result.proposal.canceled}`);
    console.log(`   Executed: ${result.proposal.executed}`);
    
    return result;
  } catch (error) {
    console.error(`❌ Failed to check proposal ${proposalId}:`, error);
    throw error;
  }
}
