import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';

async function queueCometProposal(
  deploymentManager: DeploymentManager,
  proposalId: number,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const admin = adminSigner ?? await deploymentManager.getSigner();
  const governorContract = await deploymentManager.getContractOrThrow('governor');
  const trace = deploymentManager.tracer();
  
  trace(`Queueing proposal ${proposalId} by admin ${admin.address}`);
  
  const tx = await governorContract.connect(admin).queue(proposalId);
  const receipt = await tx.wait();
  
  trace(`Proposal ${proposalId} queued! Transaction hash: ${receipt.transactionHash}`);
  
  return { proposalId, tx: receipt };
}

export default async function queueProposal(hre: HardhatRuntimeEnvironment, proposalId: number) {
  if (proposalId === undefined || proposalId === null) {
    throw new Error('Proposal ID is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Queueing proposal ${proposalId}...`);
  
  try {
    const result = await queueCometProposal(deploymentManager, proposalId);
    
    trace(`✅ Proposal ${proposalId} queued successfully!`);
    trace(`   Transaction hash: ${result.tx.transactionHash}`);
    
    return result;
  } catch (error) {
    trace(`❌ Failed to queue proposal ${proposalId}: ${error}`);
    throw error;
  }
} 