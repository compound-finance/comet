#!/usr/bin/env ts-node

import { runGovernanceFlow, GovernanceFlowOptions } from '../../../helpers/governanceFlow';
import { log, question, confirm } from '../../../helpers/ioUtil';
import { proposeCombinedUpdate as proposeCombinedUpdateCommand, extractProposalId } from '../../../helpers/commandUtil';

interface CombinedUpdateOptions {
  network: string;
  deployment: string;
}

class CombinedGovernanceUpdater {
  private options: CombinedUpdateOptions;

  constructor(options: CombinedUpdateOptions) {
    this.options = options;
  }

  private validateAdminAddresses(admins: string[]): void {
    for (const admin of admins) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(admin)) {
        throw new Error(`Invalid admin address: ${admin}`);
      }
    }
  }

  private async proposeCombinedUpdate(admins: string[], threshold: number, timelockDelay?: number): Promise<string> {
    const output = await proposeCombinedUpdateCommand(
      this.options.network, 
      this.options.deployment, 
      admins, 
      threshold, 
      timelockDelay
    );
    
    return extractProposalId(output);
  }

  private async runGovernanceFlow(proposalId: string): Promise<void> {
    log(`\n🎉 Combined governance update proposal created successfully!`, 'success');
    
    const options: GovernanceFlowOptions = {
      network: this.options.network,
      proposalId: proposalId,
      executionType: 'combined-governance-update'
    };
    
    const successMessage = `\n🎉 Combined governance update completed successfully!\n🔧 New governance configuration and timelock settings are now active`;
    
    await runGovernanceFlow(options, successMessage);
  }

  private formatDelay(delaySeconds: number): string {
    if (delaySeconds < 60) {
      return `${delaySeconds} seconds`;
    } else if (delaySeconds < 3600) {
      const minutes = Math.floor(delaySeconds / 60);
      return `${minutes} minutes (${delaySeconds} seconds)`;
    } else if (delaySeconds < 86400) {
      const hours = Math.floor(delaySeconds / 3600);
      return `${hours} hours (${delaySeconds} seconds)`;
    } else {
      const days = Math.floor(delaySeconds / 86400);
      return `${days} days (${delaySeconds} seconds)`;
    }
  }

  public async run(): Promise<void> {
    try {
      log(`\n🚀 Starting Combined Governance Update Process`, 'info');
      log(`Network: ${this.options.network}`, 'info');
      log(`Deployment: ${this.options.deployment}`, 'info');
      
      // Ask for admin addresses
      const adminsInput = await question(`\nEnter admin addresses (comma-separated, e.g., 0x123...,0x456...,0x789...): `);
      
      if (!adminsInput) {
        log(`\n❌ Admin addresses are required`, 'error');
        return;
      }
      
      const admins = adminsInput.split(',').map(addr => addr.trim());
      
      // Validate admin addresses
      this.validateAdminAddresses(admins);
      
      // Ask for threshold
      const thresholdInput = await question(`\nEnter multisig threshold (number of required approvals): `);
      
      if (!thresholdInput) {
        log(`\n❌ Threshold is required`, 'error');
        return;
      }
      
      const threshold = parseInt(thresholdInput);
      
      // Validate threshold
      if (isNaN(threshold) || threshold <= 0) {
        log(`\n❌ Threshold must be a positive number`, 'error');
        return;
      }
      
      if (threshold > admins.length) {
        log(`\n❌ Threshold cannot be greater than the number of admins`, 'error');
        return;
      }
      
      // Ask for timelock delay (optional)
      const timelockDelayInput = await question(`\nEnter new timelock delay in seconds (optional, press Enter to skip): `);
      let timelockDelay: number | undefined;
      
      if (timelockDelayInput.trim()) {
        timelockDelay = parseInt(timelockDelayInput);
        
        if (isNaN(timelockDelay) || timelockDelay <= 0) {
          log(`\n❌ Timelock delay must be a positive number`, 'error');
          return;
        }
      }
      
      log(`\n📋 Configuration Summary:`, 'info');
      log(`   Admin addresses: ${admins.join(', ')}`, 'info');
      log(`   Threshold: ${threshold}`, 'info');
      log(`   Total admins: ${admins.length}`, 'info');
      if (timelockDelay) {
        const formattedDelay = this.formatDelay(timelockDelay);
        log(`   Timelock delay: ${formattedDelay}`, 'info');
      } else {
        log(`   Timelock delay: No change`, 'info');
      }
      
      // Confirm before proceeding
      const shouldProceed = await confirm(`\nDo you want to proceed with this combined governance update?`);
      
      if (!shouldProceed) {
        log(`\n⏸️  Combined governance update cancelled.`, 'warning');
        return;
      }
      
      // Step 1: Propose combined governance update
      const proposalId = await this.proposeCombinedUpdate(admins, threshold, timelockDelay);
      
      // Step 2: Run governance flow
      await this.runGovernanceFlow(proposalId);
      
    } catch (error) {
      log(`\n❌ Combined governance update process failed: ${error}`, 'error');
      throw error;
    }
  }
}

// Parse command line arguments
function parseArgs(): CombinedUpdateOptions {
  const args = process.argv.slice(2);
  let network = 'local';
  let deployment = 'dai';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        network = args[++i];
        break;
      case '--deployment':
        deployment = args[++i];
        break;
      case '--help':
      case '-h':
        console.log(`
🔧 Combined Governance Update Script

Usage: yarn ts-node scripts/governor/propose/governance-update/index.ts [options]

Options:
  --network <network>      Network to use (default: local)
  --deployment <market>    Deployment to use (default: dai)
  --help, -h              Show this help message

Examples:
  # Update governance configuration on local network (interactive)
  yarn ts-node scripts/governor/propose/governance-update/index.ts --network local --deployment dai

  # Update governance configuration on polygon network (interactive)
  yarn ts-node scripts/governor/propose/governance-update/index.ts --network polygon --deployment usdc

Interactive prompts:
  - Admin addresses: Enter comma-separated list of admin addresses
  - Threshold: Enter number of required approvals
  - Timelock delay: Enter new delay in seconds (optional)
  - Confirmation: Confirm the configuration before proceeding

Note: This script will guide you through the complete governance process:
1. Create proposal
2. Approve proposal (if you choose to)
3. Queue proposal (if you choose to)
4. Execute proposal (if you choose to)
        `);
        process.exit(0);
    }
  }

  return { network, deployment };
}

// Main execution
async function main() {
  const options = parseArgs();
  const updater = new CombinedGovernanceUpdater(options);
  await updater.run();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}
