import { FaucetToken, SimplePriceFeed, Fauceteer } from "../../build/types";
import { DeploymentManager } from '../../plugins/deployment_manager';

export class DeploymentTokenInfraHelper {
  private deploymentManager: DeploymentManager;
  private useCache: boolean;
  private cacheNetwork: string;
  private cacheDeployment: string;

  constructor(
    deploymentManager: DeploymentManager,
    options?: {
      useCache: boolean,
      cacheDeployment: string
    }
  ) {
    this.deploymentManager = deploymentManager;
    this.cacheNetwork = deploymentManager.network;
    if(options?.useCache) {
      this.useCache = options.useCache;
      this.cacheDeployment = options.cacheDeployment;
    }
  }

  // Helper function to create tokens
  async makeToken(
    symbol: string,
    name: string,
    decimals: number
  ): Promise<FaucetToken> {
    if (this.useCache) {
      // Try to load from cache deployment using fromDep
      try {
        return await this.deploymentManager.fromDep<FaucetToken>(
          symbol,
          this.cacheNetwork,
          this.cacheDeployment
        );
      } catch (error) {
        // If not found in cache, deploy new one
        console.log(`Token ${symbol} not found in cache, deploying new one...`);
      }
    }

    // Deploy new token
    const mint = (BigInt(1000000) * 10n ** BigInt(decimals)).toString();
    return this.deploymentManager.deploy(symbol, 'test/FaucetToken.sol', [mint, name, decimals, symbol]);
  }

  // Helper function to create price feeds
  async makePriceFeed(
    alias: string,
    initialPrice: number,
    decimals: number
  ): Promise<SimplePriceFeed> {
    if (this.useCache) {
      // Try to load from cache deployment using fromDep
      try {
        return await this.deploymentManager.fromDep<SimplePriceFeed>(
          alias,
          this.cacheNetwork,
          this.cacheDeployment
        );
      } catch (error) {
        // If not found in cache, deploy new one
        console.log(`PriceFeed ${alias} not found in cache, deploying new one...`);
      }
    }

    // Deploy new price feed
    return this.deploymentManager.deploy(alias, 'test/SimplePriceFeed.sol', [initialPrice * decimals, decimals]);
  }

  // Helper function to create fauceteer with idempotency check
  async makeFauceteer(): Promise<Fauceteer> {
    if (this.useCache) {
      // Try to load from cache deployment using fromDep
      try {
        return await this.deploymentManager.fromDep<Fauceteer>(
          'fauceteer',
          this.cacheNetwork,
          this.cacheDeployment
        );
      } catch (error) {
        // If not found in cache, deploy new one
        console.log(`Fauceteer not found in cache, deploying new one...`);
      }
    }

    // Deploy new fauceteer
    return this.deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);
  }
}