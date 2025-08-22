import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

async function approveCometProposal(
  deploymentManager: DeploymentManager,
  proposalId: number,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const governorContract = await deploymentManager.getContractOrThrow('governor');
  const trace = deploymentManager.tracer();
  
  trace(`Approving proposal ${proposalId} by admin ${admin.address}`);
  
  const tx = await governorContract.connect(admin).castVote(proposalId, 1);
  const receipt = await tx.wait();
  
  trace(`Proposal ${proposalId} approved! Transaction hash: ${receipt.transactionHash}`);
  
  // Get proposal state to check if it can be queued
  const proposalState = await governorContract.state(proposalId);
  
  trace(`Proposal ${proposalId} state: ${proposalState}`);
  
  return { proposalId, state: proposalState, tx: receipt };
}

export default async function approveProposal(hre: HardhatRuntimeEnvironment, proposalId: number) {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Approving proposal ${proposalId}...`);
  
  try {
    const result = await approveCometProposal(deploymentManager, proposalId);
    
    console.log(`✅ Proposal ${proposalId} approved successfully!`);
    console.log(`   Proposal state: ${result.state}`);
    console.log(`   Transaction hash: ${result.tx.transactionHash}`);
    
    return result;
  } catch (error) {
    trace(`❌ Failed to approve proposal ${proposalId}: ${error}`);
    throw error;
  }
} 