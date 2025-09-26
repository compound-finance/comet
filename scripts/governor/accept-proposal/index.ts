#!/usr/bin/env ts-node

import { GovernanceFlowHelper } from '../../helpers/governanceFlow';
import { log } from '../../helpers/ioUtil';

interface AcceptProposalOptions {
  network: string;
  proposalId: string;
}

class ProposalAcceptor {
  private options: AcceptProposalOptions;
  private governanceFlow: GovernanceFlowHelper;

  constructor(options: AcceptProposalOptions) {
    this.options = options;
    this.governanceFlow = new GovernanceFlowHelper();
  }

  public async acceptProposal(): Promise<void> {
    try {
      log(`\n🎯 Accepting proposal: ${this.options.proposalId} on ${this.options.network}`, 'info');
      
      // Use the governance flow helper to approve the proposal and log the result
      const result = await this.governanceFlow['approveProposal']({
        network: this.options.network,
        proposalId: this.options.proposalId
      });
      
      log(`\n🎉 Proposal acceptance process completed!`, 'success');
      log(`📋 Approval result:`, 'info');
      log(result, 'info');
      
    } catch (error) {
      log(`\n❌ Proposal acceptance failed: ${error}`, 'error');
      log(`\n💡 Troubleshooting tips:`, 'info');
      log(`   - Check your .env file has all required API keys`, 'info');
      log(`   - Verify network configuration in hardhat.config.ts`, 'info');
      log(`   - Ensure you have sufficient funds for the transaction`, 'info');
      log(`   - Check that all dependencies are installed (yarn install)`, 'info');
      log(`   - Verify the proposal ID exists and is in the correct state`, 'info');
      log(`   - Make sure you have the required permissions to approve proposals`, 'info');
      process.exit(1);
    }
  }
}

// Parse command line arguments
function parseArguments(): AcceptProposalOptions {
  const args = process.argv.slice(2);
  const options: AcceptProposalOptions = {
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
🎯 Accept Proposal Script

Usage: yarn ts-node scripts/governor/accept-proposal/index.ts [options]

Options:
  --network <network>                    Network to use (required)
  --proposal-id <id>                     Proposal ID to accept (required)

  --help, -h                            Show this help message

Examples:
  # Accept proposal 123 on local network
  yarn ts-node scripts/governor/accept-proposal/index.ts --network local --proposal-id 123

  # Accept proposal 456 on polygon network
  yarn ts-node scripts/governor/accept-proposal/index.ts --network polygon --proposal-id 456

Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc.

Features:
  - Uses the governor:approve command to approve proposals
  - Shows detailed approval status information
  - Provides clear feedback on approval process
  - Includes comprehensive error handling and troubleshooting tips
  - Shows next steps based on approval status

Note: This script approves a proposal. The proposal will need to be queued and executed
to take effect.
  `);
}

// Main execution
async function main(): Promise<void> {
  const options = parseArguments();
  
  if (!options.network || !options.proposalId) {
    console.error('❌ Network and proposal ID are both required');
    showHelp();
    process.exit(1);
  }

  const acceptor = new ProposalAcceptor(options);
  await acceptor.acceptProposal();
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

export { ProposalAcceptor, AcceptProposalOptions };
