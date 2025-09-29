import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ProposalService } from '../../services/ProposalService';
import { CometUpgradeAction } from '../../actions/CometUpgradeAction';

/**
 * Task for proposing Comet upgrades
 */
export default async function proposeCometUpgradeTask(
  hre: HardhatRuntimeEnvironment, 
  newImplementationAddress: string
): Promise<any> {
  if (!newImplementationAddress) {
    throw new Error('New implementation address is required');
  }
  
  const deploymentManager = (hre as any).deploymentManager;
  
  if (!deploymentManager) {
    throw new Error('DeploymentManager not found. Make sure to call createDeploymentManager first.');
  }
  
  console.log(`Proposing Comet upgrade to ${newImplementationAddress}...`);
  
  try {
    // Create the comet upgrade action
    const action = new CometUpgradeAction(deploymentManager, newImplementationAddress);
    const proposal = await action.build();
    const upgradeSummary = action.getUpgradeSummary();

    console.log(`   New implementation: ${upgradeSummary.newImplementation}`);
    console.log(`   Target: ${upgradeSummary.target}`);

    // Create the service and submit the proposal
    const service = new ProposalService(deploymentManager);
    const result = await service.createProposal(proposal);
    
    return {
      ...result,
      newImplementation: upgradeSummary.newImplementation,
      target: upgradeSummary.target
    };
  } catch (error) {
    console.error(`❌ Failed to propose Comet upgrade:`, error);
    throw error;
  }
}
