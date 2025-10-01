import * as fs from 'fs';
import * as path from 'path';
import { DeploymentManager } from '../../../plugins/deployment_manager';

interface AssetConfig {
  priceFeed: string;
  decimals: string;
  borrowCF: number;
  liquidateCF: number;
  liquidationFactor: number;
  supplyCap: string;
}

interface Configuration {
  name: string;
  symbol: string;
  baseToken: string;
  baseTokenPriceFeed: string;
  borrowMin: string;
  storeFrontPriceFactor: number;
  targetReserves: string;
  rates: {
    supplyKink: number;
    supplySlopeLow: number;
    supplySlopeHigh: number;
    supplyBase: number;
    borrowKink: number;
    borrowSlopeLow: number;
    borrowSlopeHigh: number;
    borrowBase: number;
  };
  tracking: {
    indexScale: string;
    baseSupplySpeed: string;
    baseBorrowSpeed: string;
    baseMinForRewards: string;
  };
  rewardToken: string;
  assets: {
    [symbol: string]: AssetConfig;
  };
}

export class ConfiguratorModifierHelper {
  private deploymentManager: DeploymentManager;
  private network: string;
  private deployment: string;
  private configPath: string;
  private configuration: Configuration | null = null;

  constructor(deploymentManager: DeploymentManager) {
    this.deploymentManager = deploymentManager;
    this.network = deploymentManager.network;
    this.deployment = deploymentManager.deployment;
    
    // Build path to configuration.json
    this.configPath = path.join(
      process.cwd(),
      'deployments',
      this.network,
      this.deployment,
      'configuration.json'
    );
  }

  /**
   * Loads the configuration.json file
   */
  private loadConfiguration(): Configuration {
    if (this.configuration) {
      return this.configuration;
    }

    if (!fs.existsSync(this.configPath)) {
      throw new Error(`Configuration file not found at: ${this.configPath}`);
    }

    const configContent = fs.readFileSync(this.configPath, 'utf-8');
    this.configuration = JSON.parse(configContent) as Configuration;
    return this.configuration;
  }

  /**
   * Saves the modified configuration back to configuration.json
   */
  private saveConfiguration(): void {
    if (!this.configuration) {
      throw new Error('No configuration loaded to save');
    }

    const configContent = JSON.stringify(this.configuration, null, 2);
    fs.writeFileSync(this.configPath, configContent + '\n', 'utf-8');
    
    const trace = this.deploymentManager.tracer();
    trace(`✅ Updated configuration at: ${this.configPath}`);
  }

  /**
   * Updates the baseTokenPriceFeed address based on the base token
   * For example, if baseToken is "DAI", it will use the "daiPriceFeed" contract address
   */
  async updateBaseTokenPriceFeed(): Promise<void> {
    const config = this.loadConfiguration();
    const trace = this.deploymentManager.tracer();
    
    const baseToken = config.baseToken; // e.g., "DAI", "USDC"
    const priceFeedAlias = `${baseToken.toLowerCase()}PriceFeed`; // e.g., "daiPriceFeed"
    
    trace(`Looking for price feed: ${priceFeedAlias}`);
    
    // Get the price feed contract from the deployment
    const priceFeed = await this.deploymentManager.contract(priceFeedAlias);
    
    if (!priceFeed) {
      throw new Error(`Price feed not found: ${priceFeedAlias}`);
    }
    
    trace(`Found ${priceFeedAlias} at: ${priceFeed.address}`);
    
    // Update the configuration
    const oldAddress = config.baseTokenPriceFeed;
    config.baseTokenPriceFeed = priceFeed.address;
    
    trace(`Updated baseTokenPriceFeed: ${oldAddress} → ${priceFeed.address}`);
    
    this.saveConfiguration();
  }

  /**
   * Updates all asset price feeds in the configuration
   * For each asset (e.g., WBTC, WETH), updates its priceFeed address
   */
  async updateAssetPriceFeeds(): Promise<void> {
    const config = this.loadConfiguration();
    const trace = this.deploymentManager.tracer();
    
    for (const [assetSymbol, assetConfig] of Object.entries(config.assets)) {
      const priceFeedAlias = `${assetSymbol.toLowerCase()}PriceFeed`; // e.g., "wbtcPriceFeed"
      
      trace(`Looking for asset price feed: ${priceFeedAlias}`);
      
      // Get the price feed contract from the deployment
      const priceFeed = await this.deploymentManager.contract(priceFeedAlias);
      
      if (!priceFeed) {
        trace(`⚠️  Price feed not found: ${priceFeedAlias}, skipping...`);
        continue;
      }
      
      trace(`Found ${priceFeedAlias} at: ${priceFeed.address}`);
      
      // Update the asset's price feed
      const oldAddress = assetConfig.priceFeed;
      assetConfig.priceFeed = priceFeed.address;
      
      trace(`Updated ${assetSymbol} priceFeed: ${oldAddress} → ${priceFeed.address}`);
    }
    
    this.saveConfiguration();
  }

  /**
   * Updates both base token and asset price feeds
   */
  async updateAllPriceFeeds(): Promise<void> {
    const trace = this.deploymentManager.tracer();
    trace(`\n📝 Updating price feeds in configuration for ${this.network}/${this.deployment}...`);
    
    await this.updateBaseTokenPriceFeed();
    await this.updateAssetPriceFeeds();
    
    trace(`✅ All price feeds updated successfully!\n`);
  }

  /**
   * Gets the current configuration (loads if not already loaded)
   */
  getConfiguration(): Configuration {
    return this.loadConfiguration();
  }
} 