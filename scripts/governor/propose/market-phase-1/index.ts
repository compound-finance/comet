#!/usr/bin/env ts-node

import { deployMarket as deployMarketCommand, extractProposalId } from '../../../helpers/commandUtil';
import { log } from '../../../helpers/ioUtil';

interface NewMarketImplOptions {
  network: string;
  deployment: string;
}

class NewMarketImpl {
  private options: NewMarketImplOptions;

  constructor(options: NewMarketImplOptions) {
    this.options = options;
  }

  public async addMarket(): Promise<void> {
    try {
      log(`\n🚀 Adding new market implementation: ${this.options.deployment} on ${this.options.network}`, 'info');
      log(`🔧 Using BDAG custom governor (default)`, 'info');
      log(`🔧 Using standard deploy mode (default)`, 'info');
      
      // Deploy the market using default values: bdag=true, batchDeploy=false
      const result = await deployMarketCommand(this.options.network, this.options.deployment);
      const proposalId = extractProposalId(result);
      
      log(`\n🎉 New market implementation proposed successfully! Proposal ID: ${proposalId}`, 'success');
      
    } catch (error) {
      log(`\n❌ New market implementation deployment failed: ${error}`, 'error');
      log(`\n💡 Troubleshooting tips:`, 'info');
      log(`   - Check your .env file has all required API keys`, 'info');
      log(`   - Verify network configuration in hardhat.config.ts`, 'info');
      log(`   - Ensure you have sufficient funds for deployment`, 'info');
      log(`   - Check that all dependencies are installed (yarn install)`, 'info');
      log(`   - Verify the deployment configuration exists in deployments/${this.options.network}/${this.options.deployment}/`, 'info');
      process.exit(1);
    }
  }
}

// Parse command line arguments
function parseArguments(): NewMarketImplOptions {
  const args = process.argv.slice(2);
  const options: NewMarketImplOptions = {
    network: '',
    deployment: ''
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--deployment':
        options.deployment = args[++i];
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
🚀 New Market Implementation Script

Usage: yarn ts-node scripts/governor/propose/market-phase-1/index.ts [options]

Options:
  --network <network>           Network to deploy to (required)
  --deployment <market>         Market to deploy (required)

  --help, -h                   Show this help message

Examples:
  # Add new DAI market implementation on local network
  yarn ts-node scripts/governor/propose/market-phase-1/index.ts --network local --deployment dai

  # Add new USDC market implementation on polygon network
  yarn ts-node scripts/governor/propose/market-phase-1/index.ts --network polygon --deployment usdc

  # Add new WETH market implementation on mainnet
  yarn ts-node scripts/governor/propose/market-phase-1/index.ts --network mainnet --deployment weth

Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc.
Available markets: dai, usdc, usdt, weth, wbtc, etc.

Note: This script uses BDAG custom governor and standard deploy mode by default.
  `);
}

// Main execution
async function main(): Promise<void> {
  const options = parseArguments();
  
  if (!options.network || !options.deployment) {
    console.error('❌ Both network and deployment are required');
    showHelp();
    process.exit(1);
  }

  const newMarketImpl = new NewMarketImpl(options);
  await newMarketImpl.addMarket();
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

export { NewMarketImpl, NewMarketImplOptions };
