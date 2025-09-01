#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as readline from 'readline';

interface GovernanceConfigOptions {
  network: string;
  deployment: string;
}

class GovernanceConfigProposer {
  private rl: readline.Interface;
  private options: GovernanceConfigOptions;

  constructor(options: GovernanceConfigOptions) {
    this.options = options;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  private async question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim());
      });
    });
  }

  private async confirm(prompt: string): Promise<boolean> {
    const answer = await this.question(`${prompt} (y/N): `);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  }

  private log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    const colors = {
      info: '\x1b[36m',    // Cyan
      success: '\x1b[32m', // Green
      warning: '\x1b[33m', // Yellow
      error: '\x1b[31m'    // Red
    };
    const reset = '\x1b[0m';
    console.log(`${colors[type]}${message}${reset}`);
  }

  private async runCommand(command: string, description: string): Promise<string> {
    this.log(`\n🔄 ${description}...`, 'info');
    try {
      const output = execSync(command, { 
        stdio: 'pipe',
        encoding: 'utf8'
      });
      this.log(`✅ ${description} completed successfully`, 'success');
      return output;
    } catch (error) {
      this.log(`❌ ${description} failed: ${error}`, 'error');
      throw error;
    }
  }

  private async runCommandWithOutput(command: string, description: string): Promise<void> {
    this.log(`\n🔄 ${description}...`, 'info');
    try {
      execSync(command, { 
        stdio: 'inherit',
        encoding: 'utf8'
      });
      this.log(`✅ ${description} completed successfully`, 'success');
    } catch (error) {
      this.log(`❌ ${description} failed: ${error}`, 'error');
      throw error;
    }
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
    
    const output = await this.runCommand(command, 'Proposing governance configuration change');
    
    // Extract proposal ID from output
    const proposalIdMatch = output.match(/Proposal ID: (\d+)/);
    if (proposalIdMatch) {
      return proposalIdMatch[1];
    }
    
    throw new Error('Could not extract proposal ID from output');
  }

  private async checkProposalStatus(proposalId: string): Promise<void> {
    const command = `yarn hardhat governor:status --network ${this.options.network} --deployment ${this.options.deployment} --proposal-id ${proposalId}`;
    
    await this.runCommandWithOutput(command, 'Checking proposal status');
  }

  private async approveProposal(proposalId: string): Promise<void> {
    const command = `yarn hardhat governor:approve --network ${this.options.network} --deployment ${this.options.deployment} --proposal-id ${proposalId}`;
    
    await this.runCommandWithOutput(command, 'Approving proposal');
  }

  private async queueProposal(proposalId: string): Promise<void> {
    const command = `yarn hardhat governor:queue --network ${this.options.network} --deployment ${this.options.deployment} --proposal-id ${proposalId}`;
    
    await this.runCommandWithOutput(command, 'Queueing proposal');
  }

  private async executeProposal(proposalId: string): Promise<void> {
    const command = `yarn hardhat governor:execute --network ${this.options.network} --deployment ${this.options.deployment} --proposal-id ${proposalId} --execution-type governance-config`;
    
    await this.runCommandWithOutput(command, 'Executing proposal');
  }

  private async runGovernanceFlow(proposalId: string): Promise<void> {
    this.log(`\n🎉 Governance configuration proposal created successfully!`, 'success');
    this.log(`\n🚀 Starting governance flow for proposal ID: ${proposalId}`, 'info');
    
    // Check proposal status
    await this.checkProposalStatus(proposalId);
    
    // Ask user if they want to proceed with governance
    const shouldProcessGovernance = await this.confirm(`\nDo you want to approve, queue, and execute proposal ${proposalId}?`);
    
    if (shouldProcessGovernance) {
      // Approve proposal
      await this.approveProposal(proposalId);
      
      // Check status after approval
      await this.checkProposalStatus(proposalId);
      
      // Queue proposal
      await this.queueProposal(proposalId);
      
      // Check status after queueing
      await this.checkProposalStatus(proposalId);
      
      // Execute proposal
      await this.executeProposal(proposalId);
      
      this.log(`\n🎉 Governance configuration change completed successfully!`, 'success');
      this.log(`\n🔧 New governance configuration is now active`, 'info');
    } else {
      this.log(`\n⏸️  Governance flow paused. You can manually process the proposal later.`, 'warning');
      this.log(`\n📋 Commands to run manually:`, 'info');
      this.log(`   yarn hardhat governor:approve --network ${this.options.network} --deployment ${this.options.deployment} --proposal-id ${proposalId}`, 'info');
      this.log(`   yarn hardhat governor:queue --network ${this.options.network} --deployment ${this.options.deployment} --proposal-id ${proposalId}`, 'info');
      this.log(`   yarn hardhat governor:execute --network ${this.options.network} --deployment ${this.options.deployment} --proposal-id ${proposalId} --execution-type governance-config`, 'info');
    }
  }

  public async run(): Promise<void> {
    try {
      this.log(`\n🚀 Starting Governance Configuration Change Process`, 'info');
      this.log(`Network: ${this.options.network}`, 'info');
      this.log(`Deployment: ${this.options.deployment}`, 'info');
      
      // Ask for admin addresses
      const adminsInput = await this.question(`\nEnter admin addresses (comma-separated, e.g., 0x123...,0x456...,0x789...): `);
      
      if (!adminsInput) {
        this.log(`\n❌ Admin addresses are required`, 'error');
        return;
      }
      
      const admins = adminsInput.split(',').map(addr => addr.trim());
      
      // Validate admin addresses
      this.validateAdminAddresses(admins);
      
      // Ask for threshold
      const thresholdInput = await this.question(`\nEnter multisig threshold (number of required approvals): `);
      
      if (!thresholdInput) {
        this.log(`\n❌ Threshold is required`, 'error');
        return;
      }
      
      const threshold = parseInt(thresholdInput);
      
      // Validate threshold
      if (isNaN(threshold) || threshold <= 0) {
        this.log(`\n❌ Threshold must be a positive number`, 'error');
        return;
      }
      
      if (threshold > admins.length) {
        this.log(`\n❌ Threshold cannot be greater than the number of admins`, 'error');
        return;
      }
      
      this.log(`\n📋 Configuration Summary:`, 'info');
      this.log(`   Admin addresses: ${admins.join(', ')}`, 'info');
      this.log(`   Threshold: ${threshold}`, 'info');
      this.log(`   Total admins: ${admins.length}`, 'info');
      
      // Confirm before proceeding
      const shouldProceed = await this.confirm(`\nDo you want to proceed with this governance configuration change?`);
      
      if (!shouldProceed) {
        this.log(`\n⏸️  Governance configuration change cancelled.`, 'warning');
        return;
      }
      
      // Step 1: Propose governance configuration change
      const proposalId = await this.proposeGovernanceConfig(admins, threshold);
      
      // Step 2: Run governance flow
      await this.runGovernanceFlow(proposalId);
      
    } catch (error) {
      this.log(`\n❌ Governance configuration change process failed: ${error}`, 'error');
      throw error;
    } finally {
      this.rl.close();
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
