#!/usr/bin/env ts-node

import { GovernanceFlowHelper } from '../../helpers/governanceFlow';
import { ExecutionType } from '../../../src/governor/ExecuteProposal';
import { log } from '../../helpers/ioUtil';

interface ExecuteProposalOptions {
  network: string;
  proposalId: string;
  executionType: ExecutionType;
}

class ProposalExecutor {
  private options: ExecuteProposalOptions;
  private governanceFlow: GovernanceFlowHelper;

  constructor(options: ExecuteProposalOptions) {
    this.options = options;
    this.governanceFlow = new GovernanceFlowHelper();
  }

  public async executeProposal(): Promise<void> {
    try {
      log(`\n🎯 Executing proposal: ${this.options.proposalId} on ${this.options.network}`, 'info');
      log(`🔧 Execution type: ${this.options.executionType}`, 'info');
      
      // Use the governance flow helper to execute the proposal
      const result = await this.governanceFlow['executeProposal']({
        network: this.options.network,
        proposalId: this.options.proposalId,
        executionType: this.options.executionType
      });
      
      log(`\n🎉 Proposal execution process completed!`, 'success');
      log(`📋 Execution result:`, 'info');
      log(result, 'info');
      
      log(`\n✅ Proposal execution completed!`, 'success');
      log(`💡 The proposal has been fully processed through the governance system.`, 'info');
      
    } catch (error) {
      log(`\n❌ Proposal execution failed: ${error}`, 'error');
      log(`\n💡 Troubleshooting tips:`, 'info');
      log(`   - Check your .env file has all required API keys`, 'info');
      log(`   - Verify network configuration in hardhat.config.ts`, 'info');
      log(`   - Ensure you have sufficient funds for the transaction`, 'info');
      log(`   - Check that all dependencies are installed (yarn install)`, 'info');
      log(`   - Verify the proposal ID exists and is in the correct state`, 'info');
      log(`   - Make sure the proposal has been queued and the timelock delay has passed`, 'info');
      log(`   - Ensure you have the required permissions to execute proposals`, 'info');
      log(`   - Check if the proposal has already been executed`, 'info');
      log(`   - Verify the execution type is correct for this proposal`, 'info');
      process.exit(1);
    }
  }
}

// Parse command line arguments
function parseArguments(): ExecuteProposalOptions {
  const args = process.argv.slice(2);
  const options: ExecuteProposalOptions = {
    network: '',
    proposalId: '',
    executionType: 'governance-config' // Default value
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--proposal-id':
        options.proposalId = args[++i];
        break;
      case '--execution-type':
        const executionType = args[++i] as ExecutionType;
        // Validate execution type
        const validTypes: ExecutionType[] = [
          'comet-impl-in-configuration',
          'comet-upgrade',
          'governance-config',
          'timelock-delay-change',
          'comet-reward-funding'
        ];
        if (validTypes.includes(executionType)) {
          options.executionType = executionType;
        } else {
          console.error(`❌ Invalid execution type: ${executionType}`);
          console.error(`Valid types: ${validTypes.join(', ')}`);
          process.exit(1);
        }
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
🎯 Execute Proposal Script

Usage: yarn ts-node scripts/governor/execute-proposal/index.ts [options]

Options:
  --network <network>           Network to use (required)
  --proposal-id <id>           Proposal ID to execute (required)
  --execution-type <type>      Execution type (required)

  --help, -h                   Show this help message

Examples:
  # Execute proposal 1 on local network with comet upgrade type
  yarn ts-node scripts/governor/execute-proposal/index.ts --network local --proposal-id 1 --execution-type comet-upgrade

  # Execute proposal 5 on polygon network with implementation type
  yarn ts-node scripts/governor/execute-proposal/index.ts --network polygon --proposal-id 5 --execution-type comet-impl-in-configuration

  # Execute proposal 10 on mainnet with governance config type
  yarn ts-node scripts/governor/execute-proposal/index.ts --network mainnet --proposal-id 10 --execution-type governance-config

Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc.

Available execution types:
  - comet-impl-in-configuration: For Comet implementation deployments
  - comet-upgrade: For Comet upgrades
  - governance-config: For governance configuration changes
  - timelock-delay-change: For timelock delay changes
  - comet-reward-funding: For Comet reward funding

Features:
  - Uses the governance flow helper for consistent execution handling
  - Leverages the enhanced execute functionality with log parsing
  - Supports execution type for better log parsing
  - Provides clear feedback on execution status
  - Includes comprehensive error handling and troubleshooting tips
  - Shows completion confirmation
  - Type-safe execution type validation

Note: This script uses the governance flow helper that provides enhanced execution
functionality with proper log parsing based on execution type.
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

  const executor = new ProposalExecutor(options);
  await executor.executeProposal();
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

export { ProposalExecutor, ExecuteProposalOptions };
