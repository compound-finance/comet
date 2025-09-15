#!/usr/bin/env ts-node

import { runGovernanceFlow, GovernanceFlowOptions } from '../helpers/governanceFlow';
import { log, question, confirm } from '../helpers/ioUtil';
import { runCommand, extractProposalId } from '../helpers/commandUtil';

interface FundingOptions {
  network: string;
}

class CometRewardFunder {
  private options: FundingOptions;

  constructor(options: FundingOptions) {
    this.options = options;
  }

  private async proposeFunding(amount: string): Promise<string> {
    const command = `yarn hardhat governor:propose-fund-comet-rewards --network ${this.options.network} --amount ${amount}`;
    
    const output = await runCommand(command, 'Proposing comet reward funding');
    
    return extractProposalId(output);
  }

  private async runGovernanceFlow(proposalId: string): Promise<void> {
    log(`\n🎉 Comet reward funding proposal created successfully!`, 'success');
    
    const options: GovernanceFlowOptions = {
      network: this.options.network,
      proposalId: proposalId,
      executionType: 'comet-reward-funding'
    };
    
    const successMessage = `\n🎉 Comet reward funding completed successfully!\n💰 COMP tokens have been transferred to CometRewards contract`;
    
    await runGovernanceFlow(options, successMessage);
  }

  public async run(): Promise<void> {
    try {
      log(`\n🚀 Starting Comet Reward Funding Process`, 'info');
      log(`Network: ${this.options.network}`, 'info');
      
      // Ask for amount interactively
      const amount = await question(`\nEnter the amount of COMP tokens to fund (in wei, e.g., 1000000000000000000000 for 1000 COMP): `);
      
      if (!amount) {
        log(`\n❌ Amount is required`, 'error');
        return;
      }
      
      log(`Amount: ${amount} COMP tokens (wei)`, 'info');
      
      // Confirm before proceeding
      const shouldProceed = await confirm(`\nDo you want to proceed with funding CometRewards with ${amount} COMP tokens?`);
      
      if (!shouldProceed) {
        log(`\n⏸️  Funding process cancelled.`, 'warning');
        return;
      }
      
      // Step 1: Propose funding
      const proposalId = await this.proposeFunding(amount);
      
      // Step 2: Run governance flow
      await this.runGovernanceFlow(proposalId);
      
    } catch (error) {
      log(`\n❌ Comet reward funding process failed: ${error}`, 'error');
      throw error;
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