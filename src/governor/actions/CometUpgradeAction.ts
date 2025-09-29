import { DeploymentManager } from '../../../plugins/deployment_manager';
import { Proposal } from '../models';
import { getCometUpgradeProposal } from '../../deploy/NetworkExtension';

/**
 * Action for creating Comet upgrade proposals
 */
export class CometUpgradeAction {
  constructor(
    private deploymentManager: DeploymentManager,
    private newImplementationAddress: string
  ) {}

  /**
   * Build the proposal data for Comet upgrade
   */
  async build(): Promise<Proposal> {
    if (!this.newImplementationAddress) {
      throw new Error('New implementation address is required');
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(this.newImplementationAddress)) {
      throw new Error(`Invalid implementation address: ${this.newImplementationAddress}`);
    }

    // Use the NetworkExtension function to create the proposal
    return await getCometUpgradeProposal(this.deploymentManager, this.newImplementationAddress);
  }

  /**
   * Get upgrade summary
   */
  getUpgradeSummary(): { newImplementation: string, target: string } {
    return {
      newImplementation: this.newImplementationAddress,
      target: 'cometAdmin' // The upgrade is called through cometAdmin
    };
  }
}
