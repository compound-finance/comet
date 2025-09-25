#!/usr/bin/env ts-node

import { runGovernanceFlow, GovernanceFlowOptions } from '../../../../helpers/governanceFlow';
import { log, question, confirm } from '../../../../helpers/ioUtil';
import { runCommand, extractProposalId } from '../../../../helpers/commandUtil';

interface DelayChangeOptions {
  network: string;
}

class TimelockDelayChanger {
  private options: DelayChangeOptions;

  constructor(options: DelayChangeOptions) {
    this.options = options;
  }

  private async proposeDelayChange(delay: string): Promise<string> {
    const command = `yarn hardhat governor:propose-timelock-delay-change --network ${this.options.network} --delay ${delay}`;
    
    const output = await runCommand(command, 'Proposing timelock delay change');
    
    return extractProposalId(output);
  }

  private async runGovernanceFlow(proposalId: string): Promise<void> {
    log(`\n🎉 Timelock delay change proposal created successfully!`, 'success');
    
    const options: GovernanceFlowOptions = {
      network: this.options.network,
      proposalId: proposalId,
      executionType: 'timelock-delay-change'
    };
    
    const successMessage = `\n🎉 Timelock delay change completed successfully!\n⏰ Timelock delay has been updated`;
    
    await runGovernanceFlow(options, successMessage);
  }

  private formatDelay(delaySeconds: string): string {
    const seconds = parseInt(delaySeconds);
    if (seconds < 60) {
      return `${seconds} seconds`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} minutes (${seconds} seconds)`;
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours} hours (${seconds} seconds)`;
    } else {
      const days = Math.floor(seconds / 86400);
      return `${days} days (${seconds} seconds)`;
    }
  }

  public async run(): Promise<void> {
    try {
      log(`\n🚀 Starting Timelock Delay Change Process`, 'info');
      log(`Network: ${this.options.network}`, 'info');
      
      // Ask for delay interactively
      const delay = await question(`\nEnter the new delay value in seconds (e.g., 86400 for 1 day): `);
      
      if (!delay) {
        log(`\n❌ Delay value is required`, 'error');
        return;
      }

      // Validate delay format
      const delayNumber = parseInt(delay);
      if (isNaN(delayNumber) || delayNumber < 0) {
        log(`\n❌ Delay must be a positive integer`, 'error');
        return;
      }
      
      const formattedDelay = this.formatDelay(delay);
      log(`New delay: ${formattedDelay}`, 'info');
      
      // Confirm before proceeding
      const shouldProceed = await confirm(`\nDo you want to proceed with changing the timelock delay to ${formattedDelay}?`);
      
      if (!shouldProceed) {
        log(`\n⏸️  Delay change process cancelled.`, 'warning');
        return;
      }
      
      // Step 1: Propose delay change
      const proposalId = await this.proposeDelayChange(delay);
      
      // Step 2: Run governance flow
      await this.runGovernanceFlow(proposalId);
      
    } catch (error) {
      log(`\n❌ Timelock delay change process failed: ${error}`, 'error');
      throw error;
    }
  }
}

// Parse command line arguments
function parseArgs(): DelayChangeOptions {
  const args = process.argv.slice(2);
  let network = 'local';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        network = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`
🚀 Timelock Delay Change Script

Usage: yarn ts-node scripts/timelock-delay-change/index.ts [options]

Options:
  --network <network>    Network to use (default: local)
  --help, -h            Show this help message

Examples:
  # Change timelock delay on local network (delay will be asked interactively)
  yarn ts-node scripts/timelock-delay-change/index.ts --network local

  # Change timelock delay on mainnet (delay will be asked interactively)
  yarn ts-node scripts/timelock-delay-change/index.ts --network mainnet

Delay examples (when prompted):
  86400  = 1 day
  172800 = 2 days
  3600   = 1 hour
  1800   = 30 minutes
  300    = 5 minutes
        `);
        process.exit(0);
    }
  }

  return { network };
}

// Main execution
async function main() {
  const options = parseArgs();
  const delayChanger = new TimelockDelayChanger(options);
  await delayChanger.run();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
} 