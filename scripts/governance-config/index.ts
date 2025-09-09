#!/usr/bin/env ts-node

import { runGovernanceFlow, GovernanceFlowOptions } from '../helpers/governanceFlow';
import { log, question, confirm } from '../helpers/ioUtil';
import { runCommand, extractProposalId } from '../helpers/commandUtil';

interface GovernanceConfigOptions {
  network: string;
  deployment: string;
}

class GovernanceConfigProposer {
  private options: GovernanceConfigOptions;

  constructor(options: GovernanceConfigOptions) {
    this.options = options;
  }

  private validateAdminAddresses(admins: string[]): void {
    for (const admin of admins) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(admin)) {
        throw new Error(`Invalid admin address: ${admin}`);
      }
    }
  }

  private async proposeGovernanceConfig(admins: string[], threshold: number): Promise<string> {
    const adminsParam = admins.join(',');
    const command = `yarn hardhat governor:propose-governance-config --network ${this.options.network} --deployment ${this.options.deployment} --admins "${adminsParam}" --threshold ${threshold}`;
    
    const output = await runCommand(command, 'Proposing governance configuration change');
    
    return extractProposalId(output);
  }

  private async runGovernanceFlow(proposalId: string): Promise<void> {
    log(`\n🎉 Governance configuration proposal created successfully!`, 'success');
    
    const options: GovernanceFlowOptions = {
      network: this.options.network,
      deployment: this.options.deployment,
      proposalId: proposalId,
      executionType: 'governance-config'
    };
    
    const successMessage = `\n🎉 Governance configuration change completed successfully!\n🔧 New governance configuration is now active`;
    
    await runGovernanceFlow(options, successMessage);
  }

  public async run(): Promise<void> {
    try {
      log(`\n🚀 Starting Governance Configuration Change Process`, 'info');
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
      
      log(`\n📋 Configuration Summary:`, 'info');
      log(`   Admin addresses: ${admins.join(', ')}`, 'info');
      log(`   Threshold: ${threshold}`, 'info');
      log(`   Total admins: ${admins.length}`, 'info');
      
      // Confirm before proceeding
      const shouldProceed = await confirm(`\nDo you want to proceed with this governance configuration change?`);
      
      if (!shouldProceed) {
        log(`\n⏸️  Governance configuration change cancelled.`, 'warning');
        return;
      }
      
      // Step 1: Propose governance configuration change
      const proposalId = await this.proposeGovernanceConfig(admins, threshold);
      
      // Step 2: Run governance flow
      await this.runGovernanceFlow(proposalId);
      
    } catch (error) {
      log(`\n❌ Governance configuration change process failed: ${error}`, 'error');
      throw error;
    } finally {
      // No cleanup needed since each function manages its own readline interface
    }
  }
}

// Parse command line arguments
function parseArgs(): GovernanceConfigOptions {
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
🔧 Governance Configuration Change Script

Usage: yarn ts-node scripts/governance-config/index.ts [options]

Options:
  --network <network>      Network to use (default: local)
  --deployment <market>    Deployment to use (default: dai)
  --help, -h              Show this help message

Examples:
  # Change governance configuration on local network (interactive)
  yarn ts-node scripts/governance-config/index.ts --network local --deployment dai

  # Change governance configuration on polygon network (interactive)
  yarn ts-node scripts/governance-config/index.ts --network polygon --deployment usdc

Interactive prompts:
  - Admin addresses: Enter comma-separated list of admin addresses
  - Threshold: Enter number of required approvals
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
  const proposer = new GovernanceConfigProposer(options);
  await proposer.run();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}
