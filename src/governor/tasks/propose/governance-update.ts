import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { GovernanceService } from '../../services/GovernanceService';
import { GovernanceUpdateAction } from '../../actions/GovernanceUpdateAction';
import { GovernanceUpdate } from '../../models/GovernanceConfig';

/**
 * Task for proposing governance updates (admins/threshold and/or timelock delay)
 */
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

  // Validate that at least one update is provided
  if (!newAdmins && !newThreshold && !newTimelockDelay) {
    throw new Error('At least one update must be provided (admins/threshold or timelockDelay)');
  }

  // Validate that if admins are provided, threshold is also provided
  if (newAdmins && newThreshold === undefined) {
    throw new Error('Threshold must be provided when admins are specified');
  }

  // Validate that if threshold is provided, admins are also provided
  if (newThreshold !== undefined && !newAdmins) {
    throw new Error('Admins must be provided when threshold is specified');
  }

  console.log(`Proposing governance update:`);
  if (newAdmins && newThreshold !== undefined) {
    console.log(`  New admins: ${newAdmins.join(', ')}`);
    console.log(`  New threshold: ${newThreshold}`);
  }
  if (newTimelockDelay !== undefined) {
    console.log(`  New timelock delay: ${newTimelockDelay} seconds`);
  }

  try {
    // Create the governance update action
    const update: GovernanceUpdate = {
      admins: newAdmins,
      threshold: newThreshold,
      timelockDelay: newTimelockDelay
    };

    const action = new GovernanceUpdateAction(deploymentManager, update);
    const proposal = await action.build();

    // Create the service and submit the proposal
    const service = new GovernanceService(deploymentManager);
    const result = await service.createProposal(proposal);

    const summary = action.getUpdateSummary();
    console.log(`   Actions: ${summary.actions} (${summary.updatingGovernance ? 'governance config' : ''}${summary.updatingGovernance && summary.updatingTimelock ? ' + ' : ''}${summary.updatingTimelock ? 'timelock delay' : ''})`);

    return {
      ...result,
      newAdmins: summary.updatingGovernance ? newAdmins : null,
      newThreshold: summary.updatingGovernance ? newThreshold : null,
      newTimelockDelay: summary.updatingTimelock ? newTimelockDelay : null,
      updatingGovernance: summary.updatingGovernance,
      updatingTimelock: summary.updatingTimelock
    };
  } catch (error) {
    console.error(`❌ Failed to propose governance update:`, error);
    throw error;
  }
}
