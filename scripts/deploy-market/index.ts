#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

interface DeployOptions {
  network: string;
  deployment: string;
  clean?: boolean;
}

class MarketDeployer {
  private rl: readline.Interface;
  private options: DeployOptions;

  constructor(options: DeployOptions) {
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

  private async runCommand(command: string, description: string): Promise<void> {
    this.log(`\n🔄 ${description}...`, 'info');
    try {
      const output = execSync(command, { 
        stdio: 'inherit',
        encoding: 'utf8'
      });
      this.log(`✅ ${description} completed successfully`, 'success');
    } catch (error) {
      this.log(`❌ ${description} failed: ${error}`, 'error');
      throw error;
    }
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
      this.log(`❌ Configuration file not found at: ${configPath}`, 'error');
      throw new Error('Configuration file not found');
    }

    this.log(`📁 Configuration file found at: ${configPath}`, 'info');
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent);
      this.log(`📋 Current configuration loaded successfully`, 'success');
      return config;
    } catch (error) {
      this.log(`❌ Failed to parse configuration file: ${error}`, 'error');
      throw error;
    }
  }

  private async promptForConfigurationUpdate(): Promise<void> {
    this.log(`\n⚠️  IMPORTANT: After infrastructure deployment, you need to update the market configuration.`, 'warning');
    this.log(`📁 Configuration file location: ${this.getConfigPath()}`, 'info');
    
    this.log(`\n📝 You need to update the following in your configuration.json:`, 'info');
    this.log(`   - Price feeds for your assets`, 'info');
    this.log(`   - Asset configurations`, 'info');
    this.log(`   - Supply caps and collateral factors`, 'info');
    this.log(`   - Any other market-specific settings`, 'info');
    
    const shouldContinue = await this.confirm(
      `\nHave you updated the configuration.json file and are ready to continue with market deployment?`
    );
    
    if (!shouldContinue) {
      this.log(`\n⏸️  Deployment paused. Please update the configuration and run the script again.`, 'warning');
      process.exit(0);
    }
  }

  private async cleanDeployment(): Promise<void> {
    const network = this.options.network;
    const deployment = this.options.deployment;
    
    this.log(`\n🧹 Cleaning deployment cache for ${network}/${deployment}...`, 'info');
    
    const cleanCommand = `rm -rf deployments/${network}/_infrastructure/aliases.json deployments/${network}/_infrastructure/roots.json deployments/${network}/.contracts deployments/${network}/*/aliases.json deployments/${network}/*/roots.json`;
    
    try {
      execSync(cleanCommand, { stdio: 'inherit' });
      this.log(`✅ Cleaned deployment cache successfully`, 'success');
    } catch (error) {
      this.log(`⚠️  Clean command completed (some files may not have existed)`, 'warning');
    }
  }

  private async deployInfrastructure(): Promise<void> {
    const command = `yarn hardhat deploy_infrastructure --network ${this.options.network} --bdag`;
    
    await this.runCommand(command, 'Deploying infrastructure');
  }

  private async deployMarket(): Promise<void> {
    const command = `yarn hardhat deploy --network ${this.options.network} --deployment ${this.options.deployment} --bdag`;
    
    await this.runCommand(command, 'Deploying market');
  }

  private async runDeploymentVerification(): Promise<void> {
    const command = `MARKET=${this.options.deployment} yarn hardhat test test/deployment-verification-test.ts --network ${this.options.network}`;
    
    await this.runCommand(command, 'Running deployment verification test');
  }



  private async runGovernanceToAcceptImplementation(): Promise<void> {
    this.log(`\n🎉 Market deployment completed successfully!`, 'success');
    this.log(`\n🚀 Starting governance flow to accept implementation...`, 'info');
    
    // Step 1: Check proposal status
    const proposalId = await this.question(`\nEnter the proposal ID to process (default: 1): `) || '1';
    
    this.log(`\n📋 Processing proposal ID: ${proposalId}`, 'info');
    
    // Check proposal status
    await this.runCommand(
      `yarn hardhat governor:status --network ${this.options.network} --proposal-id ${proposalId}`,
      'Checking proposal status'
    );
    
    // Approve all governance steps at once
    const shouldProcessGovernance = await this.confirm(`\nDo you want to approve, queue, and execute proposal ${proposalId}?`);
    if (shouldProcessGovernance) {
      // Approve proposal
      await this.runCommand(
        `yarn hardhat governor:approve --network ${this.options.network} --proposal-id ${proposalId}`,
        'Approving proposal'
      );
      
      // Queue proposal
      await this.runCommand(
        `yarn hardhat governor:queue --network ${this.options.network} --proposal-id ${proposalId}`,
        'Queueing proposal'
      );
      
      // Execute proposal
      await this.runCommand(
        `yarn hardhat governor:execute --network ${this.options.network} --proposal-id ${proposalId} --execution-type comet-impl-in-configuration`,
        'Executing proposal'
      );
    }
    
    // Step 2: Propose upgrade (if needed)
    const shouldProposeUpgrade = await this.confirm(`\nDo you want to propose an upgrade to a new implementation?`);
    if (shouldProposeUpgrade) {
      const implementationAddress = await this.question(`\nEnter the new implementation address: `);
      
      if (implementationAddress) {
        await this.runCommand(
          `yarn hardhat governor:propose-upgrade --network ${this.options.network} --deployment ${this.options.deployment} --implementation ${implementationAddress}`,
          'Proposing upgrade'
        );
        
        // Step 3: Process upgrade proposal
        await this.runGovernanceToAcceptUpgrade();
      }
    }
    
    this.log(`\n🎉 Governance flow completed successfully!`, 'success');
  }

  private async runSpiderForMarket(): Promise<void> {
    try {
      await this.runCommand(
        `yarn hardhat spider --network ${this.options.network} --deployment ${this.options.deployment}`,
        'Refreshing roots'
      );
    } catch (error) {
      this.log(`\n⚠️  Spider failed, but this is expected behavior after upgrades.`, 'warning');
      this.log(`📝 This happens because the implementation address doesn't match the expected one.`, 'info');
      this.log(`\n🔧 To fix this:`, 'info');
      this.log(`   1. Update the 'comet:implementation' entry in aliases.json`, 'info');
      this.log(`   2. Update roots.json if needed`, 'info');
      this.log(`\n📁 Files to update:`, 'info');
      this.log(`   - deployments/${this.options.network}/${this.options.deployment}/aliases.json`, 'info');
      this.log(`   - deployments/${this.options.network}/${this.options.deployment}/roots.json`, 'info');
      
      const filesUpdated = await this.confirm(`\nHave you updated the aliases.json and roots.json files?`);
      if (filesUpdated) {
        this.log(`\n🔄 Retrying spider...`, 'info');
        await this.runSpiderForMarket(); // Recursive call to retry
      } else {
        this.log(`\n⏸️  Spider refresh skipped. You can run it manually later.`, 'warning');
      }
    }
  }

  private async runGovernanceToAcceptUpgrade(): Promise<void> {
    const upgradeProposalId = await this.question(`\nEnter the upgrade proposal ID: `);
    
    if (upgradeProposalId) {
      this.log(`\n📋 Processing upgrade proposal ID: ${upgradeProposalId}`, 'info');
      
      // Check upgrade proposal status
      await this.runCommand(
        `yarn hardhat governor:status --network ${this.options.network} --proposal-id ${upgradeProposalId}`,
        'Checking upgrade proposal status'
      );
      
      // Approve all upgrade governance steps at once
      const shouldProcessUpgradeGovernance = await this.confirm(`\nDo you want to approve, queue, and execute upgrade proposal ${upgradeProposalId}?`);
      if (shouldProcessUpgradeGovernance) {
        // Approve upgrade proposal
        await this.runCommand(
          `yarn hardhat governor:approve --network ${this.options.network} --proposal-id ${upgradeProposalId}`,
          'Approving upgrade proposal'
        );
        
        // Queue upgrade proposal
        await this.runCommand(
          `yarn hardhat governor:queue --network ${this.options.network} --proposal-id ${upgradeProposalId}`,
          'Queueing upgrade proposal'
        );
        
        // Execute upgrade proposal
        await this.runCommand(
          `yarn hardhat governor:execute --network ${this.options.network} --proposal-id ${upgradeProposalId} --execution-type comet-upgrade`,
          'Executing upgrade proposal'
        );
        
        // Refresh roots after upgrade
        const shouldRefreshRoots = await this.confirm(`\nDo you want to refresh roots after the upgrade?`);
        if (shouldRefreshRoots) {
          await this.runSpiderForMarket();
        }
      }
    }
  }

  public async deploy(): Promise<void> {
    try {
      this.log(`\n🚀 Starting market deployment for ${this.options.deployment} on ${this.options.network}`, 'info');
      
      this.log(`🔧 Using BDAG custom governor`, 'info');

      // Build project before deployment
      await this.runCommand('yarn build', 'Building project');

      if (this.options.clean) {
        this.log(`🧹 Clean mode enabled`, 'info');
        await this.cleanDeployment();
      }

      // Step 1: Deploy Infrastructure
      await this.deployInfrastructure();
      
      // Step 2: Check configuration file exists
      await this.checkConfigurationFile();
      
      // Step 3: Prompt for configuration update
      await this.promptForConfigurationUpdate();
      
      // Step 4: Deploy Market
      await this.deployMarket();
      
      // Step 5: Run governance flow
      const runGovernance = await this.confirm(`\nDo you want to run the governance flow?`);
      if (runGovernance) {
        await this.runGovernanceToAcceptImplementation();
      }
      
      // Step 6: Run verification test (after governance)
      const runVerification = await this.confirm(`\nDo you want to run deployment verification test?`);
      
      if (runVerification) {
        await this.runDeploymentVerification();
      }
      
    } catch (error) {
      this.log(`\n❌ Deployment failed: ${error}`, 'error');
      this.log(`\n💡 Troubleshooting tips:`, 'info');
      this.log(`   - Check your .env file has all required API keys`, 'info');
      this.log(`   - Verify network configuration in hardhat.config.ts`, 'info');
      this.log(`   - Ensure you have sufficient funds for deployment`, 'info');
      this.log(`   - Check that all dependencies are installed (yarn install)`, 'info');
      process.exit(1);
    } finally {
      this.rl.close();
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
