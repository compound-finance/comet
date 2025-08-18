import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

async function executeCometProposal(
  deploymentManager: DeploymentManager,
  proposalId: number,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const governorContract = await deploymentManager.getContractOrThrow('governor');
  const trace = deploymentManager.tracer();
  
  trace(`Executing proposal ${proposalId} by admin ${admin.address}`);
  
  const tx = await governorContract.connect(admin).execute(proposalId);
  const receipt = await tx.wait();
  
  trace(`Proposal ${proposalId} executed! Transaction hash: ${receipt.transactionHash}`);
  
  return { proposalId, tx: receipt };
}

export default async function executeProposal(hre: HardhatRuntimeEnvironment, proposalId: number) {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Executing proposal ${proposalId}...`);
  
  try {
    const result = await executeCometProposal(deploymentManager, proposalId);
    
    trace(`✅ Proposal ${proposalId} executed successfully!`);
    trace(`   Transaction hash: ${result.tx.transactionHash}`);
    
    return result;
  } catch (error) {
    trace(`❌ Failed to execute proposal ${proposalId}: ${error}`);
    throw error;
  }
} 