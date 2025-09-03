#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as readline from 'readline';

interface FundingOptions {
  network: string;
}

class CometRewardFunder {
  private rl: readline.Interface;
  private options: FundingOptions;

  constructor(options: FundingOptions) {
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

  private async proposeFunding(amount: string): Promise<string> {
    const command = `yarn hardhat governor:propose-fund-comet-rewards --network ${this.options.network} --amount ${amount}`;
    
    const output = await this.runCommand(command, 'Proposing comet reward funding');
    
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
    const command = `yarn hardhat governor:execute --network ${this.options.network} --proposal-id ${proposalId} --execution-type comet-reward-funding`;
    
    await this.runCommandWithOutput(command, 'Executing proposal');
  }

  private async runGovernanceFlow(proposalId: string): Promise<void> {
    this.log(`\n🎉 Comet reward funding proposal created successfully!`, 'success');
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
      
      this.log(`\n🎉 Comet reward funding completed successfully!`, 'success');
      this.log(`\n💰 COMP tokens have been transferred to CometRewards contract`, 'info');
    } else {
      this.log(`\n⏸️  Governance flow paused. You can manually process the proposal later.`, 'warning');
      this.log(`\n📋 Commands to run manually:`, 'info');
      this.log(`   yarn hardhat governor:approve --network ${this.options.network} --proposal-id ${proposalId}`, 'info');
      this.log(`   yarn hardhat governor:queue --network ${this.options.network} --proposal-id ${proposalId}`, 'info');
      this.log(`   yarn hardhat governor:execute --network ${this.options.network} --proposal-id ${proposalId} --execution-type comet-reward-funding`, 'info');
    }
  }

  public async run(): Promise<void> {
    try {
      this.log(`\n🚀 Starting Comet Reward Funding Process`, 'info');
      this.log(`Network: ${this.options.network}`, 'info');
      
      // Ask for amount interactively
      const amount = await this.question(`\nEnter the amount of COMP tokens to fund (in wei, e.g., 1000000000000000000000 for 1000 COMP): `);
      
      if (!amount) {
        this.log(`\n❌ Amount is required`, 'error');
        return;
      }
      
      this.log(`Amount: ${amount} COMP tokens (wei)`, 'info');
      
      // Confirm before proceeding
      const shouldProceed = await this.confirm(`\nDo you want to proceed with funding CometRewards with ${amount} COMP tokens?`);
      
      if (!shouldProceed) {
        this.log(`\n⏸️  Funding process cancelled.`, 'warning');
        return;
      }
      
      // Step 1: Propose funding
      const proposalId = await this.proposeFunding(amount);
      
      // Step 2: Run governance flow
      await this.runGovernanceFlow(proposalId);
      
    } catch (error) {
      this.log(`\n❌ Comet reward funding process failed: ${error}`, 'error');
      throw error;
    } finally {
      this.rl.close();
    }
  }
}

// Parse command line arguments
function parseArgs(): FundingOptions {
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
🚀 Comet Reward Funding Script

Usage: yarn ts-node scripts/comet-reward-funding/index.ts [options]

Options:
  --network <network>    Network to use (default: local)
  --help, -h            Show this help message

Examples:
  # Fund CometRewards on local network (amount will be asked interactively)
  yarn ts-node scripts/comet-reward-funding/index.ts --network local

  # Fund CometRewards on polygon network (amount will be asked interactively)
  yarn ts-node scripts/comet-reward-funding/index.ts --network polygon
        `);
        process.exit(0);
    }
  }

  return { network };
}

// Main execution
async function main() {
  const options = parseArgs();
  const funder = new CometRewardFunder(options);
  await funder.run();
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
} 