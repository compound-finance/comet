import { FaucetToken, SimplePriceFeed, Fauceteer } from "../../../build/types";
import { DeploymentManager } from '../../../plugins/deployment_manager';

// Helper function to create tokens
export async function makeToken(
  deploymentManager: DeploymentManager,
  symbol: string,
  name: string,
  decimals: number
): Promise<FaucetToken> {
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
  // Deploy new price feed
  return deploymentManager.deploy(alias, 'test/SimplePriceFeed.sol', [initialPrice * decimals, decimals]);
}

// Helper function to create fauceteer with idempotency check
export async function makeFauceteer(
  deploymentManager: DeploymentManager
): Promise<Fauceteer> {
  // Deploy new fauceteer
  return deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);
}
