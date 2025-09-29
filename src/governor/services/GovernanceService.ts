import { ProposalService } from './ProposalService';
import { Proposal } from '../models';
import { GovernanceConfig, GovernanceUpdate, ValidationResult } from '../models/GovernanceConfig';
import { utils } from 'ethers';

/**
 * Service for governance-related operations
 */
export class GovernanceService extends ProposalService {
  
  /**
   * Validate governance configuration
   */
  validateGovernanceConfig(config: Partial<GovernanceConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (config.admins) {
      if (config.admins.length === 0) {
        errors.push('At least one admin address is required');
      }

      // Validate addresses
      for (const admin of config.admins) {
        if (!/^0x[a-fA-F0-9]{40}$/.test(admin)) {
          errors.push(`Invalid admin address: ${admin}`);
        }
      }
    }

    if (config.threshold !== undefined) {
      if (config.threshold <= 0) {
        errors.push('Threshold must be greater than 0');
      }

      if (config.admins && config.threshold > config.admins.length) {
        errors.push('Threshold cannot be greater than the number of admins');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Create a governance configuration update proposal
   */
  async createGovernanceConfigProposal(config: GovernanceConfig): Promise<any> {
    const validation = this.validateGovernanceConfig(config);
    
    if (!validation.isValid) {
      throw new Error(`Invalid governance configuration: ${validation.errors.join(', ')}`);
    }

    const governor = await this.getGovernor();

    const proposal: Proposal = {
      targets: [governor.address],
      values: [0],
      calldatas: [
        governor.interface.encodeFunctionData('setGovernanceConfig', [config.admins, config.threshold])
      ],
      description: `Update governance configuration: Set ${config.admins.length} admins with threshold ${config.threshold}`
    };

    return await this.createProposal(proposal);
  }

  /**
   * Create a combined governance and timelock update proposal
   */
  async createGovernanceUpdateProposal(update: GovernanceUpdate): Promise<any> {
    const { admins, threshold, timelockDelay } = update;
    
    // Validate that at least one update is provided
    if (!admins && !threshold && !timelockDelay) {
      throw new Error('At least one update (governance config or timelock delay) must be provided');
    }

    const updatingGovernance = admins && threshold;
    const updatingTimelock = timelockDelay !== undefined;

    // Validate governance config if provided
    if (updatingGovernance) {
      const validation = this.validateGovernanceConfig({ admins, threshold });
      if (!validation.isValid) {
        throw new Error(`Invalid governance configuration: ${validation.errors.join(', ')}`);
      }
    }

    // Validate timelock delay if provided
    if (updatingTimelock && timelockDelay <= 0) {
      throw new Error('Timelock delay must be greater than 0');
    }

    console.log('📋 Creating governance update proposal...');
    
    if (updatingGovernance) {
      console.log(`   New admins: ${admins!.length} addresses`);
      console.log(`   New threshold: ${threshold}`);
    }
    if (updatingTimelock) {
      console.log(`   New timelock delay: ${timelockDelay} seconds`);
    }

    const targets: string[] = [];
    const values: number[] = [];
    const calldatas: string[] = [];

    // Action 1: Update governance configuration (if provided)
    if (updatingGovernance) {
      const governor = await this.getGovernor();
      targets.push(governor.address);
      values.push(0);
      calldatas.push(
        governor.interface.encodeFunctionData('setGovernanceConfig', [admins, threshold])
      );
    }

    // Action 2: Update timelock delay (if provided)
    if (updatingTimelock) {
      const timelock = await this.getTimelock();
      const delayBN = utils.parseUnits(timelockDelay!.toString(), 0);
      targets.push(timelock.address);
      values.push(0);
      calldatas.push(
        timelock.interface.encodeFunctionData('setDelay', [delayBN])
      );
    }

    // Create description
    let description = '';
    if (updatingGovernance && updatingTimelock) {
      description = `Governance update: Set ${admins!.length} admins with threshold ${threshold} and update timelock delay to ${timelockDelay} seconds`;
    } else if (updatingGovernance) {
      description = `Governance update: Set ${admins!.length} admins with threshold ${threshold}`;
    } else if (updatingTimelock) {
      description = `Timelock delay update: Update timelock delay to ${timelockDelay} seconds`;
    }

    const proposal: Proposal = {
      targets,
      values,
      calldatas,
      description
    };

    const result = await this.createProposal(proposal);
    
    let actionsDescription = '';
    if (updatingGovernance && updatingTimelock) {
      actionsDescription = 'governance config + timelock delay';
    } else if (updatingGovernance) {
      actionsDescription = 'governance config';
    } else if (updatingTimelock) {
      actionsDescription = 'timelock delay';
    }
    console.log(`   Actions: ${targets.length} (${actionsDescription})`);

    return {
      ...result,
      newAdmins: updatingGovernance ? admins : null,
      newThreshold: updatingGovernance ? threshold : null,
      newTimelockDelay: updatingTimelock ? timelockDelay : null,
      updatingGovernance,
      updatingTimelock
    };
  }
}
