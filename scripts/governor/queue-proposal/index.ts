#!/usr/bin/env ts-node

import { GovernanceFlowHelper } from '../../helpers/governanceFlow';
import { log } from '../../helpers/ioUtil';

interface QueueProposalOptions {
  network: string;
  proposalId: string;
}

class ProposalQueuer {
  private options: QueueProposalOptions;
  private governanceFlow: GovernanceFlowHelper;

  constructor(options: QueueProposalOptions) {
    this.options = options;
    this.governanceFlow = new GovernanceFlowHelper();
  }

  public async queueProposal(): Promise<void> {
    try {
      log(`\n🎯 Queueing proposal: ${this.options.proposalId} on ${this.options.network}`, 'info');
      
      // Use the governance flow helper to queue the proposal and log the result
      const result = await this.governanceFlow['queueProposal']({
        network: this.options.network,
        proposalId: this.options.proposalId
      });
      
      log(`\n🎉 Proposal queueing process completed!`, 'success');
      log(`📋 Queue result:`, 'info');
      log(result, 'info');
      
    } catch (error) {
      log(`\n❌ Proposal queueing failed: ${error}`, 'error');
      log(`\n💡 Troubleshooting tips:`, 'info');
      log(`   - Check your .env file has all required API keys`, 'info');
      log(`   - Verify network configuration in hardhat.config.ts`, 'info');
      log(`   - Ensure you have sufficient funds for the transaction`, 'info');
      log(`   - Check that all dependencies are installed (yarn install)`, 'info');
      log(`   - Verify the proposal ID exists and is in the correct state`, 'info');
      log(`   - Make sure the proposal has enough approvals to be queued`, 'info');
      log(`   - Ensure you have the required permissions to queue proposals`, 'info');
      process.exit(1);
    }
  }
}

// Parse command line arguments
function parseArguments(): QueueProposalOptions {
  const args = process.argv.slice(2);
  const options: QueueProposalOptions = {
    network: '',
    proposalId: ''
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--proposal-id':
        options.proposalId = args[++i];
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
🎯 Queue Proposal Script

Usage: yarn ts-node scripts/governor/queue-proposal/index.ts [options]

Options:
  --network <network>           Network to use (required)
  --proposal-id <id>           Proposal ID to queue (required)

  --help, -h                   Show this help message

Examples:
  # Queue proposal 1 on local network
  yarn ts-node scripts/governor/queue-proposal/index.ts --network local --proposal-id 1

  # Queue proposal 5 on polygon network
  yarn ts-node scripts/governor/queue-proposal/index.ts --network polygon --proposal-id 5

  # Queue proposal 10 on mainnet
  yarn ts-node scripts/governor/queue-proposal/index.ts --network mainnet --proposal-id 10

Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc.

Features:
  - Uses the governance flow helper for consistent queueing handling
  - Leverages the enhanced queue functionality with timing information
  - Shows timelock delay and execution timing details
  - Provides clear feedback on queueing status
  - Shows next steps after successful queueing
  - Includes comprehensive error handling and troubleshooting tips

Note: This script uses the governance flow helper that provides detailed timing
information and handles cases where proposals are already queued.
  `);
}

// Main execution
async function main(): Promise<void> {
  const options = parseArguments();
  
  if (!options.network || !options.proposalId) {
    console.error('❌ Both network and proposal-id are required');
    showHelp();
    process.exit(1);
  }

  const queuer = new ProposalQueuer(options);
  await queuer.queueProposal();
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

export { ProposalQueuer, QueueProposalOptions };
