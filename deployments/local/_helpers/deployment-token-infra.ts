import { FaucetToken, SimplePriceFeed, Fauceteer } from "../../../build/types";
import { DeploymentManager } from '../../../plugins/deployment_manager';

// Helper function to create tokens
export async function makeToken(
  deploymentManager: DeploymentManager,
  symbol: string,
  name: string,
  decimals: number
): Promise<FaucetToken> {
  // Check if token already exists
  const existingToken = await deploymentManager.contract(symbol);
  if (existingToken) {
    return existingToken as FaucetToken;
  }
  
  // Deploy new token
  const mint = (BigInt(1000000) * 10n ** BigInt(decimals)).toString();
  return deploymentManager.deploy(symbol, 'test/FaucetToken.sol', [mint, name, decimals, symbol]);
}

// Helper function to create price feeds
export async function makePriceFeed(
  deploymentManager: DeploymentManager,
  alias: string,
  initialPrice: number,
  decimals: number
): Promise<SimplePriceFeed> {
  // Check if price feed already exists
  const existingPriceFeed = await deploymentManager.contract(alias);
  if (existingPriceFeed) {
    return existingPriceFeed as SimplePriceFeed;
  }
  
  // Deploy new price feed
  return deploymentManager.deploy(alias, 'test/SimplePriceFeed.sol', [initialPrice * decimals, decimals]);
}

// Helper function to create fauceteer with idempotency check
export async function makeFauceteer(
  deploymentManager: DeploymentManager
): Promise<Fauceteer> {
  // Check if fauceteer already exists
  const existingFauceteer = await deploymentManager.contract('fauceteer');
  if (existingFauceteer) {
    return existingFauceteer as Fauceteer;
  }
  
  // Deploy new fauceteer
  return deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);
}
