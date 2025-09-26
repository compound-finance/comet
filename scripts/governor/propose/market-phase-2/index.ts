#!/usr/bin/env ts-node

import { proposeUpgrade as proposeUpgradeCommand, extractProposalId } from '../../../helpers/commandUtil';
import { log } from '../../../helpers/ioUtil';

interface NewMarketUpgradeOptions {
  network: string;
  deployment: string;
  implementation: string;
}

class NewMarketUpgrader {
  private options: NewMarketUpgradeOptions;

  constructor(options: NewMarketUpgradeOptions) {
    this.options = options;
  }

  public async proposeUpgrade(): Promise<void> {
    try {
      log(`\n🚀 Proposing new market upgrade: ${this.options.deployment} on ${this.options.network}`, 'info');
      log(`🔧 New implementation address: ${this.options.implementation}`, 'info');
      log(`🔧 Using BDAG custom governor (default)`, 'info');
      
      // Use the proposeUpgradeCommand function instead of runCommand
      const result = await proposeUpgradeCommand(
        this.options.network, 
        this.options.deployment, 
        this.options.implementation, 
        false // batchDeploy = false for single market upgrade
      );
      
      log(`\n🎉 New market upgrade proposal created successfully!`, 'success');
      log(`📋 Proposal result:`, 'info');
      log(result, 'info');
      
      // Extract proposal ID from the result
      const proposalId = extractProposalId(result);
      log(`\n📋 Proposal created with ID: ${proposalId}`, 'success');
      
      log(`\n💡 Next steps for proposal ${proposalId}:`, 'info');
      log(`   1. Accept the proposal: ./scripts/governor/accept-proposal/index.sh -n ${this.options.network} -p ${proposalId}`, 'info');
      log(`   2. Queue the proposal: ./scripts/governor/queue-proposal/index.sh -n ${this.options.network} -p ${proposalId}`, 'info');
      log(`   3. Execute the proposal: ./scripts/governor/execute-proposal/index.sh -n ${this.options.network} -p ${proposalId} -t comet-upgrade`, 'info');
      log(`   4. Or use the complete governance flow script for automated processing`, 'info');
      
    } catch (error) {
      log(`\n❌ New market upgrade proposal failed: ${error}`, 'error');
      log(`\n💡 Troubleshooting tips:`, 'info');
      log(`   - Check your .env file has all required API keys`, 'info');
      log(`   - Verify network configuration in hardhat.config.ts`, 'info');
      log(`   - Ensure you have sufficient funds for the transaction`, 'info');
      log(`   - Check that all dependencies are installed (yarn install)`, 'info');
      log(`   - Verify the deployment exists in deployments/${this.options.network}/${this.options.deployment}/`, 'info');
      log(`   - Ensure the new implementation address is valid and deployed`, 'info');
      log(`   - Make sure you have the required permissions to propose upgrades`, 'info');
      log(`   - Check that the new implementation is compatible with the current market`, 'info');
      process.exit(1);
    }
  }
}

// Parse command line arguments
function parseArguments(): NewMarketUpgradeOptions {
  const args = process.argv.slice(2);
  const options: NewMarketUpgradeOptions = {
    network: '',
    deployment: '',
    implementation: ''
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--deployment':
        options.deployment = args[++i];
        break;
      case '--implementation':
        options.implementation = args[++i];
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
🚀 New Market Upgrade Script

Usage: yarn ts-node scripts/governor/propose/market-phase-2/index.ts [options]

Options:
  --network <network>                    Network to use (required)
  --deployment <market>                  Market to upgrade (required)
  --implementation <addr>                New implementation contract address (required)

  --help, -h                            Show this help message

Examples:
  # Propose upgrade for DAI market on local network
  yarn ts-node scripts/governor/propose/market-phase-2/index.ts --network local --deployment dai --implementation 0x1234567890123456789012345678901234567890

  # Propose upgrade for USDC market on polygon network
  yarn ts-node scripts/governor/propose/market-phase-2/index.ts --network polygon --deployment usdc --implementation 0xabcdefabcdefabcdefabcdefabcdefabcdefabcd

  # Propose upgrade for WETH market on mainnet
  yarn ts-node scripts/governor/propose/market-phase-2/index.ts --network mainnet --deployment weth --implementation 0x9876543210987654321098765432109876543210

Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc.
Available markets: dai, usdc, usdt, weth, wbtc, etc.

Features:
  - Uses the governor:propose-upgrade command to create upgrade proposals
  - Shows the new implementation address being proposed
  - Provides clear feedback on proposal creation
  - Includes comprehensive error handling and troubleshooting tips
  - Shows next steps for the governance process
  - Automatically extracts proposal ID from the output

Note: This script creates a proposal for upgrading a market. The proposal will need to go
through the complete governance process (approve, queue, execute) before the upgrade
takes effect.
  `);
}

// Main execution
async function main(): Promise<void> {
  const options = parseArguments();
  
  if (!options.network || !options.deployment || !options.implementation) {
    console.error('❌ Network, deployment, and implementation are all required');
    showHelp();
    process.exit(1);
  }

  const upgrader = new NewMarketUpgrader(options);
  await upgrader.proposeUpgrade();
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

export { NewMarketUpgrader, NewMarketUpgradeOptions };
