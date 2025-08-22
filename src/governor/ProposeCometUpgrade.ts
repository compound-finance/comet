import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { proposeCometUpgrade } from '../deploy/NetworkExtension';

async function proposeCometUpgradeAction(
  deploymentManager: DeploymentManager,
  newImplementationAddress: string,
  adminSigner?: SignerWithAddress
): Promise<any> {
  const admin = adminSigner ?? await deploymentManager.getSigner();

  const result = await proposeCometUpgrade(deploymentManager, newImplementationAddress, admin);
  
  return result;
}

export default async function proposeCometUpgradeTask(
  hre: HardhatRuntimeEnvironment, 
  newImplementationAddress: string
) {
  if (!newImplementationAddress) {
    throw new Error('New implementation address is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  const trace = deploymentManager.tracer();
  
  trace(`Proposing Comet upgrade to ${newImplementationAddress}...`);
  
  try {
    const result = await proposeCometUpgradeAction(deploymentManager, newImplementationAddress);
    
    console.log(`✅ Comet upgrade proposal submitted successfully!`);
    console.log(`   Proposal ID: ${await result.proposalId}`);
    console.log(`   New implementation: ${result.newImplementation}`);
    console.log(`   Transaction hash: ${result.tx.transactionHash}`);
    console.log(`   Description: ${result.description}`);
    
    return result;
  } catch (error) {
    trace(`❌ Failed to propose Comet upgrade: ${error}`);
    throw error;
  }
} 