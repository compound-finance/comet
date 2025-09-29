import { DeploymentManager } from '../../../plugins/deployment_manager';
import { Proposal } from '../models';
import { GovernanceUpdate } from '../models/GovernanceConfig';
import { utils } from 'ethers';

/**
 * Action for creating governance update proposals
 */
export class GovernanceUpdateAction {
  constructor(
    private deploymentManager: DeploymentManager,
    private update: GovernanceUpdate
  ) {}

  /**
   * Build the proposal data for governance update
   */
  async build(): Promise<Proposal> {
    const { admins, threshold, timelockDelay } = this.update;
    
    // Validate that at least one update is provided
    if (!admins && !threshold && !timelockDelay) {
      throw new Error('At least one update (governance config or timelock delay) must be provided');
    }

    const updatingGovernance = !!(admins && threshold);
    const updatingTimelock = timelockDelay !== undefined;

    // Validate governance config if provided
    if (updatingGovernance) {
      this.validateGovernanceConfig(admins!, threshold!);
    }

    // Validate timelock delay if provided
    if (updatingTimelock && timelockDelay! <= 0) {
      throw new Error('Timelock delay must be greater than 0');
    }

    const targets: string[] = [];
    const values: number[] = [];
    const calldatas: string[] = [];

    // Action 1: Update governance configuration (if provided)
    if (updatingGovernance) {
      const governor = await this.deploymentManager.getContractOrThrow('governor');
      targets.push(governor.address);
      values.push(0);
      calldatas.push(
        governor.interface.encodeFunctionData('setGovernanceConfig', [admins, threshold])
      );
    }

    // Action 2: Update timelock delay (if provided)
    if (updatingTimelock) {
      const timelock = await this.deploymentManager.getContractOrThrow('timelock');
      const delayBN = utils.parseUnits(timelockDelay!.toString(), 0);
      targets.push(timelock.address);
      values.push(0);
      calldatas.push(
        timelock.interface.encodeFunctionData('setDelay', [delayBN])
      );
    }

    // Create description
    const description = this.buildDescription(updatingGovernance, updatingTimelock);

    return {
      targets,
      values,
      calldatas,
      description
    };
  }

  /**
   * Validate governance configuration
   */
  private validateGovernanceConfig(admins: string[], threshold: number): void {
    if (admins.length === 0) {
      throw new Error('At least one admin address is required');
    }
    
    if (threshold <= 0) {
      throw new Error('Threshold must be greater than 0');
    }
    
    if (threshold > admins.length) {
      throw new Error('Threshold cannot be greater than the number of admins');
    }
    
    // Validate addresses
    for (const admin of admins) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(admin)) {
        throw new Error(`Invalid admin address: ${admin}`);
      }
    }
  }

  /**
   * Build the proposal description
   */
  private buildDescription(updatingGovernance: boolean, updatingTimelock: boolean): string {
    const { admins, threshold, timelockDelay } = this.update;
    
    if (updatingGovernance && updatingTimelock) {
      return `Governance update: Set ${admins!.length} admins with threshold ${threshold} and update timelock delay to ${timelockDelay} seconds`;
    } else if (updatingGovernance) {
      return `Governance update: Set ${admins!.length} admins with threshold ${threshold}`;
    } else if (updatingTimelock) {
      return `Timelock delay update: Update timelock delay to ${timelockDelay} seconds`;
    }
    
    return 'Governance update proposal';
  }

  /**
   * Get summary of what will be updated
   */
  getUpdateSummary(): { updatingGovernance: boolean, updatingTimelock: boolean, actions: number } {
    const { admins, threshold, timelockDelay } = this.update;
    const updatingGovernance = !!(admins && threshold);
    const updatingTimelock = timelockDelay !== undefined;
    
    let actions = 0;
    if (updatingGovernance) actions++;
    if (updatingTimelock) actions++;
    
    return {
      updatingGovernance,
      updatingTimelock,
      actions
    };
  }
}
