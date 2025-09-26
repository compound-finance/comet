import { runCommand } from './commandUtil';
import { log, confirm } from './ioUtil';
import { ExecutionType } from '../../src/governor/ExecuteProposal';

export interface GovernanceFlowOptions {
  network: string;
  proposalId: string;
  executionType?: ExecutionType;
}

export class GovernanceFlowHelper {
  private async approveProposal(options: GovernanceFlowOptions): Promise<string> {
    const command = `yarn hardhat governor:approve --network ${options.network} --proposal-id ${options.proposalId}`;
    
    return await runCommand(command, 'Approving proposal');
  }

  private async queueProposal(options: GovernanceFlowOptions): Promise<string> {
    const command = `yarn hardhat governor:queue --network ${options.network} --proposal-id ${options.proposalId}`;
    
    return await runCommand(command, 'Queueing proposal');
  }

  private async executeProposal(options: GovernanceFlowOptions): Promise<string> {
    const executionType: ExecutionType = options.executionType || 'governance-update';
    const command = `yarn hardhat governor:execute --network ${options.network} --proposal-id ${options.proposalId} --execution-type ${executionType}`;
    
    return await runCommand(command, 'Executing proposal');
  }

  /**
   * Runs the complete governance flow for a proposal
   * @param options - Governance flow options including network and proposal ID
   * @param successMessage - Custom success message to display after completion
   * @param manualCommands - Custom manual commands to display if user chooses not to run automatically
   */
  public async runGovernanceFlow(
    options: GovernanceFlowOptions,
    successMessage?: string,
    manualCommands?: string[]
  ): Promise<string> {
    log(`\n🎯 Running governance flow for proposal ${options.proposalId}...`, 'info');
    
    // Ask user if they want to proceed with governance
    const shouldProcessGovernance = await confirm(`\nDo you want to approve, queue, and execute proposal ${options.proposalId}?`);
    
    let governanceFlowResponse = '';
    if (shouldProcessGovernance) {
      // Approve proposal
      await this.approveProposal(options);
      
      // Queue proposal
      await this.queueProposal(options);
      
      // Execute proposal
      governanceFlowResponse = await this.executeProposal(options);
      
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
        log(`   yarn hardhat governor:approve --network ${options.network} --proposal-id ${options.proposalId}`, 'info');
        log(`   yarn hardhat governor:queue --network ${options.network} --proposal-id ${options.proposalId}`, 'info');
        log(`   yarn hardhat governor:execute --network ${options.network} --proposal-id ${options.proposalId} --execution-type ${options.executionType || 'governance-config'}`, 'info');
      }
    }

    return governanceFlowResponse;
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
): Promise<string> {
  const helper = new GovernanceFlowHelper();
  return await helper.runGovernanceFlow(options, successMessage, manualCommands);
}
