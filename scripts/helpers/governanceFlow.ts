import { runCommand } from './commandUtil';
import { log, confirm } from './ioUtil';

export interface GovernanceFlowOptions {
  network: string;
  deployment: string;
  proposalId: string;
  executionType?: string;
}

export class GovernanceFlowHelper {

  private async checkProposalStatus(options: GovernanceFlowOptions): Promise<void> {
    const command = `yarn hardhat governor:status --network ${options.network} --deployment ${options.deployment} --proposal-id ${options.proposalId}`;
    
    try {
      await runCommand(command, 'Checking proposal status');
    } catch (error) {
      log(`\n⚠️  Could not check proposal status. Please verify the proposal ID is correct.`, 'warning');
      const shouldContinue = await confirm(`\nDo you want to continue with the governance flow?`);
      if (!shouldContinue) {
        throw new Error('Governance flow cancelled by user');
      }
    }
  }

  private async approveProposal(options: GovernanceFlowOptions): Promise<void> {
    const command = `yarn hardhat governor:approve --network ${options.network} --deployment ${options.deployment} --proposal-id ${options.proposalId}`;
    
    await runCommand(command, 'Approving proposal');
  }

  private async queueProposal(options: GovernanceFlowOptions): Promise<void> {
    const command = `yarn hardhat governor:queue --network ${options.network} --deployment ${options.deployment} --proposal-id ${options.proposalId}`;
    
    await runCommand(command, 'Queueing proposal');
  }

  private async executeProposal(options: GovernanceFlowOptions): Promise<void> {
    const executionType = options.executionType || 'governance-config';
    const command = `yarn hardhat governor:execute --network ${options.network} --deployment ${options.deployment} --proposal-id ${options.proposalId} --execution-type ${executionType}`;
    
    await runCommand(command, 'Executing proposal');
  }

  /**
   * Runs the complete governance flow for a proposal
   * @param options - Governance flow options including network, deployment, and proposal ID
   * @param successMessage - Custom success message to display after completion
   * @param manualCommands - Custom manual commands to display if user chooses not to run automatically
   */
  public async runGovernanceFlow(
    options: GovernanceFlowOptions,
    successMessage?: string,
    manualCommands?: string[]
  ): Promise<void> {
    log(`\n🎯 Running governance flow for proposal ${options.proposalId}...`, 'info');
    
    // Check proposal status first
    await this.checkProposalStatus(options);
    
    // Ask user if they want to proceed with governance
    const shouldProcessGovernance = await confirm(`\nDo you want to approve, queue, and execute proposal ${options.proposalId}?`);
    
    if (shouldProcessGovernance) {
      // Approve proposal
      await this.approveProposal(options);
      
      // Queue proposal
      await this.queueProposal(options);
      
      // Execute proposal
      await this.executeProposal(options);
      
      log(`\n✅ Governance flow completed successfully!`, 'success');
      if (successMessage) {
        log(successMessage, 'success');
      }
    } else {
      log(`\n⏸️  Governance flow paused. You can manually process the proposal later.`, 'warning');
      log(`\n📋 Commands to run manually:`, 'info');
      
      if (manualCommands && manualCommands.length > 0) {
        manualCommands.forEach(cmd => log(`   ${cmd}`, 'info'));
      } else {
        // Default manual commands
        log(`   yarn hardhat governor:approve --network ${options.network} --deployment ${options.deployment} --proposal-id ${options.proposalId}`, 'info');
        log(`   yarn hardhat governor:queue --network ${options.network} --deployment ${options.deployment} --proposal-id ${options.proposalId}`, 'info');
        log(`   yarn hardhat governor:execute --network ${options.network} --deployment ${options.deployment} --proposal-id ${options.proposalId} --execution-type ${options.executionType || 'governance-config'}`, 'info');
      }
    }
  }
}

/**
 * Convenience function to run governance flow without creating a class instance
 * @param options - Governance flow options (proposalId defaults to 'latest' if not provided)
 * @param successMessage - Custom success message to display after completion
 * @param manualCommands - Custom manual commands to display if user chooses not to run automatically
 */
export async function runGovernanceFlow(
  options: GovernanceFlowOptions,
  successMessage?: string,
  manualCommands?: string[]
): Promise<void> {
  const helper = new GovernanceFlowHelper();
  return await helper.runGovernanceFlow(options, successMessage, manualCommands);
}
