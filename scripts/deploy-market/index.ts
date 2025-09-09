#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { runGovernanceFlow } from '../helpers/governanceFlow';
import { log, question, confirm } from '../helpers/ioUtil';
import { extractProposalId, runCommand } from '../helpers/commandUtil';

interface DeployOptions {
  network: string;
  deployment: string;
  clean?: boolean;
}

class MarketDeployer {
  private options: DeployOptions;

  constructor(options: DeployOptions) {
    this.options = options;
  }

  private getConfigPath(): string {
    return path.join(
      process.cwd(),
      'deployments',
      this.options.network,
      this.options.deployment,
      'configuration.json'
    );
  }

  private async checkConfigurationFile(): Promise<void> {
    const configPath = this.getConfigPath();
    
    if (!fs.existsSync(configPath)) {
      log(`❌ Configuration file not found at: ${configPath}`, 'error');
      throw new Error('Configuration file not found');
    }

    log(`📁 Configuration file found at: ${configPath}`, 'info');
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent);
      log(`📋 Current configuration loaded successfully`, 'success');
      return config;
    } catch (error) {
      log(`❌ Failed to parse configuration file: ${error}`, 'error');
      throw error;
    }
  }

  private async promptForConfigurationUpdate(): Promise<void> {
    log(`\n⚠️  IMPORTANT: After infrastructure deployment, you need to update the market configuration.`, 'warning');
    log(`📁 Configuration file location: ${this.getConfigPath()}`, 'info');
    
    log(`\n📝 You need to update the following in your configuration.json:`, 'info');
    log(`   - Price feeds for your assets`, 'info');
    log(`   - Asset configurations`, 'info');
    log(`   - Supply caps and collateral factors`, 'info');
    log(`   - Any other market-specific settings`, 'info');
    
    const shouldContinue = await confirm(
      `\nHave you updated the configuration.json file and are ready to continue with market deployment?`
    );
    
    if (!shouldContinue) {
      log(`\n⏸️  Deployment paused. Please update the configuration and run the script again.`, 'warning');
      process.exit(0);
    }
  }

  private async cleanDeployment(): Promise<void> {
    const network = this.options.network;
    const deployment = this.options.deployment;
    
    log(`\n🧹 Cleaning deployment cache for ${network}/${deployment}...`, 'info');
    
    const cleanCommand = `rm -rf deployments/${network}/_infrastructure/aliases.json deployments/${network}/_infrastructure/roots.json deployments/${network}/.contracts deployments/${network}/*/aliases.json deployments/${network}/*/roots.json`;
    
    try {
      execSync(cleanCommand, { stdio: 'inherit' });
      log(`✅ Cleaned deployment cache successfully`, 'success');
    } catch (error) {
      log(`⚠️  Clean command completed (some files may not have existed)`, 'warning');
    }
  }

  private async deployInfrastructure(): Promise<void> {
    const command = `yarn hardhat deploy_infrastructure --network ${this.options.network} --bdag`;
    
    await runCommand(command, 'Deploying infrastructure');
  }

  private async deployMarket(): Promise<string> {
    const command = `yarn hardhat deploy --network ${this.options.network} --deployment ${this.options.deployment} --bdag`;
    
    return extractProposalId(await runCommand(command, 'Deploying market', true));
  }

  private async runDeploymentVerification(): Promise<void> {
    const command = `MARKET=${this.options.deployment} yarn hardhat test test/deployment-verification-test.ts --network ${this.options.network}`;
    
    await runCommand(command, 'Running deployment verification test');
  }

  private async runGovernanceToAcceptImplementation(proposalId: string): Promise<void> {
    log(`\n🎉 Market deployment completed successfully!`, 'success');
    log(`\n🚀 Starting governance flow to accept implementation...`, 'info');
    
    // Step 1: Run governance flow to accept implementation
    await runGovernanceFlow({
      network: this.options.network,
      deployment: this.options.deployment,
      proposalId,
      executionType: 'comet-impl-in-configuration'
    });
    log(`\n🎉 Governance flow to accept implementation completed successfully!`, 'success');
    
    // Step 2: Propose upgrade (if needed)
    try {
      const shouldProposeUpgrade = await confirm(`\nDo you want to propose an upgrade to a new implementation?`);

      log(`\n🔧 Proposing upgrade to a new implementation...`, 'info');
      if (shouldProposeUpgrade) {
        const implementationAddress = await question(`\nEnter the new implementation address: `);
        
        if (implementationAddress) {
          const proposalId = extractProposalId(await runCommand(
            `yarn hardhat governor:propose-upgrade --network ${this.options.network} --deployment ${this.options.deployment} --implementation ${implementationAddress}`,
            'Proposing upgrade'
          ));
          
          // Step 3: Process upgrade proposal
          await this.runGovernanceToAcceptUpgrade(proposalId);
        }
      }
    } catch (error) {
      log(`\n⚠️  Failed to propose upgrade: ${error}`, 'error');
    }
  
    log(`\n🎉 Governance flow completed successfully!`, 'success');
  }

  private async runSpiderForMarket(): Promise<void> {
    try {
      await runCommand(
        `yarn hardhat spider --network ${this.options.network} --deployment ${this.options.deployment}`,
        'Refreshing roots'
      );
    } catch (error) {
      log(`\n⚠️  Spider failed, but this is expected behavior after upgrades.`, 'warning');
      log(`📝 This happens because the implementation address doesn't match the expected one.`, 'info');
      log(`\n🔧 To fix this:`, 'info');
      log(`   1. Update the 'comet:implementation' entry in aliases.json`, 'info');
      log(`   2. Update roots.json if needed`, 'info');
      log(`\n📁 Files to update:`, 'info');
      log(`   - deployments/${this.options.network}/${this.options.deployment}/aliases.json`, 'info');
      log(`   - deployments/${this.options.network}/${this.options.deployment}/roots.json`, 'info');
      
      const filesUpdated = await confirm(`\nHave you updated the aliases.json and roots.json files?`);
      if (filesUpdated) {
        log(`\n🔄 Retrying spider...`, 'info');
        await this.runSpiderForMarket(); // Recursive call to retry
      } else {
        log(`\n⏸️  Spider refresh skipped. You can run it manually later.`, 'warning');
      }
    }
  }

  private async runGovernanceToAcceptUpgrade(proposalId: string): Promise<void> {
    if (proposalId) {
      // Approve all upgrade governance steps at once
      await runGovernanceFlow({
        network: this.options.network,
        deployment: this.options.deployment,
        proposalId,
        executionType: 'comet-upgrade'
      });
      
      // Refresh roots after upgrade
      const shouldRefreshRoots = await confirm(`\nDo you want to refresh roots after the upgrade?`);
      if (shouldRefreshRoots) {
        await this.runSpiderForMarket();
      }
    }
  }

  public async deploy(): Promise<void> {
    try {
      log(`\n🚀 Starting market deployment for ${this.options.deployment} on ${this.options.network}`, 'info');
      
      log(`🔧 Using BDAG custom governor`, 'info');

      // Build project before deployment
      await runCommand('yarn build', 'Building project');

      if (this.options.clean) {
        log(`🧹 Clean mode enabled`, 'info');
        await this.cleanDeployment();
      }

      // Step 1: Deploy Infrastructure
      await this.deployInfrastructure();
      
      // Step 2: Check configuration file exists
      await this.checkConfigurationFile();
      
      // Step 3: Prompt for configuration update
      await this.promptForConfigurationUpdate();
      
      // Step 4: Deploy Market
      const proposalId = await this.deployMarket();
      
      // Step 5: Run governance flow
      await this.runGovernanceToAcceptImplementation(proposalId);
      
      // Step 6: Run verification test (after governance)
      const runVerification = await confirm(`\nDo you want to run deployment verification test?`);
      
      if (runVerification) {
        await this.runDeploymentVerification();
      }
      
    } catch (error) {
      log(`\n❌ Deployment failed: ${error}`, 'error');
      log(`\n💡 Troubleshooting tips:`, 'info');
      log(`   - Check your .env file has all required API keys`, 'info');
      log(`   - Verify network configuration in hardhat.config.ts`, 'info');
      log(`   - Ensure you have sufficient funds for deployment`, 'info');
      log(`   - Check that all dependencies are installed (yarn install)`, 'info');
      process.exit(1);
    } 
  }
}

// Parse command line arguments
function parseArguments(): DeployOptions {
  const args = process.argv.slice(2);
  const options: DeployOptions = {
    network: 'local',
    deployment: 'dai'
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--deployment':
        options.deployment = args[++i];
        break;

      case '--clean':
        options.clean = true;
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
🚀 Market Deployment Script

Usage: yarn ts-node scripts/deploy-market.ts [options]

Options:
  --network <network>     Network to deploy to (default: local)
  --deployment <market>   Market to deploy (default: dai)

  --clean                 Clean deployment cache before deploying

  --help, -h             Show this help message

Examples:
  # Deploy DAI market on local network
  yarn ts-node scripts/deploy-market.ts --network local --deployment dai

  # Deploy USDC market on polygon network
  yarn ts-node scripts/deploy-market.ts --network polygon --deployment usdc

  # Deploy with clean cache
  yarn ts-node scripts/deploy-market.ts --network local --deployment dai --clean



Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc.
Available markets: dai, usdc, usdt, weth, wbtc, etc.
  `);
}

// Main execution
async function main(): Promise<void> {
  const options = parseArguments();
  
  if (!options.network || !options.deployment) {
    console.error('❌ Network and deployment are required');
    showHelp();
    process.exit(1);
  }

  const deployer = new MarketDeployer(options);
  await deployer.deploy();
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

export { MarketDeployer, DeployOptions };
