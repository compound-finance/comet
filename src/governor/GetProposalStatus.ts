import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';

async function getProposalStatusInternal(
  deploymentManager: DeploymentManager,
  proposalId: number
): Promise<any> {
  const governorContract = await deploymentManager.getContractOrThrow('governor');
  const trace = deploymentManager.tracer();
  
  trace(`Getting status for proposal ${proposalId}, in contract ${governorContract.address}`);
  
  // Get proposal details
  const proposal = await governorContract.proposals(proposalId);
  const state = await governorContract.state(proposalId);
  
  trace(`Proposal ${proposalId} status retrieved successfully`);
  
  return { proposal, state };
}

export default async function getProposalStatus(hre: HardhatRuntimeEnvironment, proposalId: number) {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Checking status of proposal ${proposalId}...`);
  
  try {
    const result = await getProposalStatusInternal(deploymentManager, proposalId);
    
    console.log(`📊 Proposal ${proposalId} Status:`);
    console.log(`   State: ${result.state}`);
    console.log(`   Proposer: ${result.proposal.proposer}`);
    console.log(`   ETA: ${result.proposal.eta}`);
    console.log(`   Canceled: ${result.proposal.canceled}`);
    console.log(`   Executed: ${result.proposal.executed}`);
    
    return result;
  } catch (error) {
    trace(`❌ Failed to check proposal ${proposalId}: ${error}`);
    throw error;
  }
} 