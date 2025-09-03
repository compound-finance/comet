#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as readline from 'readline';

interface DelayChangeOptions {
  network: string;
}

class TimelockDelayChanger {
  private rl: readline.Interface;
  private options: DelayChangeOptions;

  constructor(options: DelayChangeOptions) {
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

  private async proposeDelayChange(delay: string): Promise<string> {
    const command = `yarn hardhat governor:propose-timelock-delay-change --network ${this.options.network} --delay ${delay}`;
    
    const output = await this.runCommand(command, 'Proposing timelock delay change');
    
    // Extract proposal ID from output
    const proposalIdMatch = output.match(/Proposal ID: (\d+)/);
    if (proposalIdMatch) {
      return proposalIdMatch[1];
    }
    
    throw new Error('Could not extract proposal ID from output');
  }

  private async checkProposalStatus(proposalId: string): Promise<void> {
    const command = `yarn hardhat governor:status --network ${this.options.network} --proposal-id ${proposalId}`;
    
    await this.runCommandWithOutput(command, 'Checking proposal status');
  }

  private async approveProposal(proposalId: string): Promise<void> {
    const command = `yarn hardhat governor:approve --network ${this.options.network} --proposal-id ${proposalId}`;
    
    await this.runCommandWithOutput(command, 'Approving proposal');
  }

  private async queueProposal(proposalId: string): Promise<void> {
    const command = `yarn hardhat governor:queue --network ${this.options.network} --proposal-id ${proposalId}`;
    
    await this.runCommandWithOutput(command, 'Queueing proposal');
  }

  private async executeProposal(proposalId: string): Promise<void> {
    const command = `yarn hardhat governor:execute --network ${this.options.network} --proposal-id ${proposalId} --execution-type timelock-delay-change`;
    
    await this.runCommandWithOutput(command, 'Executing proposal');
  }

  private async runGovernanceFlow(proposalId: string): Promise<void> {
    this.log(`\n🎉 Timelock delay change proposal created successfully!`, 'success');
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
      
      this.log(`\n🎉 Timelock delay change completed successfully!`, 'success');
      this.log(`\n⏰ Timelock delay has been updated`, 'info');
    } else {
      this.log(`\n⏸️  Governance flow paused. You can manually process the proposal later.`, 'warning');
      this.log(`\n📋 Commands to run manually:`, 'info');
      this.log(`   yarn hardhat governor:approve --network ${this.options.network} --proposal-id ${proposalId}`, 'info');
      this.log(`   yarn hardhat governor:queue --network ${this.options.network} --proposal-id ${proposalId}`, 'info');
      this.log(`   yarn hardhat governor:execute --network ${this.options.network} --proposal-id ${proposalId} --execution-type timelock-delay-change`, 'info');
    }
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
      this.log(`\n🚀 Starting Timelock Delay Change Process`, 'info');
      this.log(`Network: ${this.options.network}`, 'info');
      
      // Ask for delay interactively
      const delay = await this.question(`\nEnter the new delay value in seconds (e.g., 86400 for 1 day): `);
      
      if (!delay) {
        this.log(`\n❌ Delay value is required`, 'error');
        return;
      }

      // Validate delay format
      const delayNumber = parseInt(delay);
      if (isNaN(delayNumber) || delayNumber < 0) {
        this.log(`\n❌ Delay must be a positive integer`, 'error');
        return;
      }
      
      const formattedDelay = this.formatDelay(delay);
      this.log(`New delay: ${formattedDelay}`, 'info');
      
      // Confirm before proceeding
      const shouldProceed = await this.confirm(`\nDo you want to proceed with changing the timelock delay to ${formattedDelay}?`);
      
      if (!shouldProceed) {
        this.log(`\n⏸️  Delay change process cancelled.`, 'warning');
        return;
      }
      
      // Step 1: Propose delay change
      const proposalId = await this.proposeDelayChange(delay);
      
      // Step 2: Run governance flow
      await this.runGovernanceFlow(proposalId);
      
    } catch (error) {
      this.log(`\n❌ Timelock delay change process failed: ${error}`, 'error');
      throw error;
    } finally {
      this.rl.close();
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