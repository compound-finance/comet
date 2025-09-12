#!/usr/bin/env ts-node

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { runGovernanceFlow } from '../helpers/governanceFlow';
import { log, confirm, updateCometImplAddress } from '../helpers/ioUtil';
import { extractProposalId, extractImplementationAddress, runCommand } from '../helpers/commandUtil';

interface DeployOptions {
  network: string;
  deployments: string[];
  clean?: boolean;
}

class MarketsDeployer {
  private options: DeployOptions;

  constructor(options: DeployOptions) {
    this.options = options;
  }

  public async deploy(): Promise<void> {
    try {
      const deploymentList = this.options.deployments.join(', ');
      log(`\n🚀 Starting market deployment for ${this.options.deployments.length} markets: ${deploymentList} on ${this.options.network}`, 'info');
      
      log(`🔧 Using BDAG custom governor`, 'info');

      // Build project before deployment
      await runCommand('yarn build', 'Building project');

      if (this.options.clean) {
        log(`🧹 Clean mode enabled`, 'info');
        await this.cleanDeployment();
      }

      // Step 1: Deploy Infrastructure
      await this.deployInfrastructure();
      
      // Step 2: Check configuration files for all markets
      await this.checkAllConfigurationFiles();
      
      // Step 3: Prompt for configuration update
      await this.promptForConfigurationUpdate();
      
      // Step 4: Deploy each market and run governance flow
      for (let i = 0; i < this.options.deployments.length; i++) {
        const deployment = this.options.deployments[i];
        log(`\n🎯 Deploying market ${i + 1}/${this.options.deployments.length}: ${deployment}`, 'info');
        
        // Deploy the market
        const proposalId = await this.deployMarket(deployment);
        
        // Run governance flow to accept implementation
        await this.runGovernanceToAcceptImplementation(proposalId, deployment);
        
        log(`\n✅ Market ${deployment} deployment and governance completed successfully!`, 'success');
      }
      
      // Step 5: Run verification tests (after all deployments)
      const runVerification = await confirm(`\nDo you want to run deployment verification tests for all markets?`);
      
      if (runVerification) {
        for (const deployment of this.options.deployments) {
          log(`\n🧪 Running verification test for ${deployment}...`, 'info');
          await this.runDeploymentVerification(deployment);
        }
      }
      
      log(`\n🎉 All ${this.options.deployments.length} markets deployed successfully!`, 'success');
      log(`\n📊 Deployment Summary:`, 'info');
      for (const deployment of this.options.deployments) {
        log(`   ✅ ${deployment}`, 'success');
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

  private getConfigPath(deployment: string): string {
    return path.join(
      process.cwd(),
      'deployments',
      this.options.network,
      deployment,
      'configuration.json'
    );
  }

  private async checkConfigurationFile(deployment: string): Promise<void> {
    const configPath = this.getConfigPath(deployment);
    
    if (!fs.existsSync(configPath)) {
      log(`❌ Configuration file not found at: ${configPath}`, 'error');
      throw new Error(`Configuration file not found for deployment: ${deployment}`);
    }

    log(`📁 Configuration file found at: ${configPath}`, 'info');
    
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent);
      log(`📋 Current configuration loaded successfully for ${deployment}`, 'success');
      return config;
    } catch (error) {
      log(`❌ Failed to parse configuration file: ${error}`, 'error');
      throw error;
    }
  }

  private async checkAllConfigurationFiles(): Promise<void> {
    log(`\n📋 Checking configuration files for ${this.options.deployments.length} markets...`, 'info');
    
    for (const deployment of this.options.deployments) {
      log(`\n🔍 Checking configuration for ${deployment}...`, 'info');
      await this.checkConfigurationFile(deployment);
    }
    
    log(`\n✅ All configuration files checked successfully`, 'success');
  }

  private async promptForConfigurationUpdate(): Promise<void> {
    log(`\n⚠️  IMPORTANT: After infrastructure deployment, you need to update the market configurations.`, 'warning');
    
    log(`\n📁 Configuration file locations:`, 'info');
    for (const deployment of this.options.deployments) {
      log(`   - ${this.getConfigPath(deployment)}`, 'info');
    }
    
    log(`\n📝 You need to update the following in each configuration.json:`, 'info');
    log(`   - Price feeds for your assets`, 'info');
    log(`   - Asset configurations`, 'info');
    log(`   - Supply caps and collateral factors`, 'info');
    log(`   - Any other market-specific settings`, 'info');
    
    const shouldContinue = await confirm(
      `\nHave you updated all configuration.json files for the ${this.options.deployments.length} markets and are ready to continue with deployment?`
    );
    
    if (!shouldContinue) {
      log(`\n⏸️  Deployment paused. Please update the configurations and run the script again.`, 'warning');
      process.exit(0);
    }
  }

  private async cleanDeployment(): Promise<void> {
    const network = this.options.network;
    
    log(`\n🧹 Cleaning deployment cache for ${network}...`, 'info');
    
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

  private async deployMarket(deployment: string): Promise<string> {
    const command = `yarn hardhat deploy --network ${this.options.network} --deployment ${deployment} --bdag`;
    
    return extractProposalId(await runCommand(command, `Deploying market: ${deployment}`));
  }

  private async runDeploymentVerification(deployment: string): Promise<void> {
    const command = `MARKET=${deployment} yarn hardhat test test/deployment-verification-test.ts --network ${this.options.network}`;
    
    await runCommand(command, `Running deployment verification test for ${deployment}`, true);
  }

  private async runGovernanceToAcceptImplementation(proposalId: string, deployment: string): Promise<void> {
    log(`\n🎉 Market deployment completed successfully for ${deployment}!`, 'success');
    log(`\n🚀 Starting governance flow to accept implementation for ${deployment}...`, 'info');
    
    // Step 1: Run governance flow to accept implementation
    const governanceFlowResponse = await runGovernanceFlow({
      network: this.options.network,
      deployment: deployment,
      proposalId,
      executionType: 'comet-impl-in-configuration'
    });
    log(`\n🎉 Governance flow response for ${deployment}: ${governanceFlowResponse}`, 'success');
    log(`\n🎉 Governance flow to accept implementation completed successfully for ${deployment}!`, 'success');
    
    // Step 2: Propose upgrade (if needed)
    try {
      const shouldProposeUpgrade = await confirm(`\nDo you want to propose an upgrade to a new implementation for ${deployment}?`);

      log(`\n🔧 Proposing upgrade to a new implementation for ${deployment}...`, 'info');
      if (shouldProposeUpgrade) {
        // Extract implementation address from governance flow response
        const implementationAddress = extractImplementationAddress(governanceFlowResponse);
        log(`\n📋 Extracted implementation address for ${deployment}: ${implementationAddress}`, 'info');
        
        const proposalId = extractProposalId(await runCommand(
          `yarn hardhat governor:propose-upgrade --network ${this.options.network} --deployment ${deployment} --implementation ${implementationAddress}`,
          `Proposing upgrade for ${deployment}`
        ));
        
        // Step 3: Process upgrade proposal
        await this.runGovernanceToAcceptUpgrade(proposalId, implementationAddress, deployment);
      }
    } catch (error) {
      log(`\n⚠️  Failed to propose upgrade for ${deployment}: ${error}`, 'error');
    }
  
    log(`\n🎉 Governance flow completed successfully for ${deployment}!`, 'success');
  }

  private async runSpiderForMarket(deployment: string): Promise<void> {
    try {
      await runCommand(
        `yarn hardhat spider --network ${this.options.network} --deployment ${deployment}`,
        `Refreshing roots for ${deployment}`
      );
    } catch (error) {
      log(`\n⚠️  Spider failed for ${deployment}, but this is expected behavior after upgrades.`, 'warning');
      log(`📝 This happens because the implementation address doesn't match the expected one.`, 'info');
      log(`\n🔧 To fix this:`, 'info');
      log(`   1. Update the 'comet:implementation' entry in aliases.json`, 'info');
      log(`   2. Update roots.json if needed`, 'info');
      log(`\n📁 Files to update:`, 'info');
      log(`   - deployments/${this.options.network}/${deployment}/aliases.json`, 'info');
      log(`   - deployments/${this.options.network}/${deployment}/roots.json`, 'info');
      
      const filesUpdated = await confirm(`\nHave you updated the aliases.json and roots.json files for ${deployment}?`);
      if (filesUpdated) {
        log(`\n🔄 Retrying spider for ${deployment}...`, 'info');
        await this.runSpiderForMarket(deployment); // Recursive call to retry
      } else {
        log(`\n⏸️  Spider refresh skipped for ${deployment}. You can run it manually later.`, 'warning');
      }
    }
  }

  private async runGovernanceToAcceptUpgrade(proposalId: string, newImplementationAddress: string, deployment: string): Promise<void> {
    if (proposalId) {
      // Approve all upgrade governance steps at once
      const governanceFlowResponse = await runGovernanceFlow({
        network: this.options.network,
        deployment: deployment,
        proposalId,
        executionType: 'comet-upgrade'
      });

      log(`\n🎉 Governance flow response for ${deployment}: ${governanceFlowResponse}`, 'success');
      
      // Update aliases.json and roots.json with the new implementation address
      updateCometImplAddress(this.options.network, deployment, newImplementationAddress);
      
      // Refresh roots after upgrade
      await this.runSpiderForMarket(deployment);
    }
  }
}

// Parse command line arguments
function parseArguments(): DeployOptions {
  const args = process.argv.slice(2);
  const options: DeployOptions = {
    network: 'local',
    deployments: ['dai']
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--network':
        options.network = args[++i];
        break;
      case '--deployment':
      case '--deployments': {
        const deploymentArg = args[++i];
        // Support both single deployment and comma-separated list
        options.deployments = deploymentArg.split(',').map(d => d.trim()).filter(d => d.length > 0);
        break;
      }

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
  --network <network>           Network to deploy to (default: local)
  --deployment <market(s)>      Market(s) to deploy (default: dai)
                               Supports single market or comma-separated list
  --deployments <market(s)>     Alias for --deployment

  --clean                       Clean deployment cache before deploying

  --help, -h                   Show this help message

Examples:
  # Deploy single DAI market on local network
  yarn ts-node scripts/deploy-market.ts --network local --deployment dai

  # Deploy multiple markets on polygon network
  yarn ts-node scripts/deploy-market.ts --network polygon --deployment dai,usdc,usdt

  # Deploy multiple markets with clean cache
  yarn ts-node scripts/deploy-market.ts --network local --deployment dai,usdc --clean

  # Deploy all major markets on mainnet
  yarn ts-node scripts/deploy-market.ts --network mainnet --deployment dai,usdc,usdt,weth,wbtc


Available networks: local, hardhat, mainnet, polygon, arbitrum, optimism, base, etc.
Available markets: dai, usdc, usdt, weth, wbtc, etc.
  `);
}

// Main execution
async function main(): Promise<void> {
  const options = parseArguments();
  
  if (!options.network || !options.deployments || options.deployments.length === 0) {
    console.error('❌ Network and at least one deployment are required');
    showHelp();
    process.exit(1);
  }

  const deployer = new MarketsDeployer(options);
  await deployer.deploy();
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
}

export { MarketsDeployer as MarketDeployer, DeployOptions };
