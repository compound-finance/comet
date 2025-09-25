import { DeploymentManager } from '../../plugins/deployment_manager';
import { FaucetToken } from '../../build/types';
import { getPriceFeeds } from '../../src/deploy/NetworkConfiguration';
import { TOKEN_ADDRESSES } from './constants';

// Helper function to get existing tokens
export async function getExistingToken(
  deploymentManager: DeploymentManager,
  symbol: string,
  address: string
): Promise<FaucetToken> {
  const existing = await deploymentManager.existing(symbol, address, deploymentManager.network, 'contracts/test/FaucetToken.sol:FaucetToken');
  return existing as FaucetToken;
}

// Helper function to get all existing test tokens
export async function getExistingTokens(deploymentManager: DeploymentManager): Promise<{
  DAI: FaucetToken;
  WETH: FaucetToken;
  WBTC: FaucetToken;
  LINK: FaucetToken;
  UNI: FaucetToken;
  USDC: FaucetToken;
}> {
  // Get existing test tokens at their deployed addresses using constants
  const DAI = await getExistingToken(deploymentManager, 'DAI', TOKEN_ADDRESSES.DAI);
  const WETH = await getExistingToken(deploymentManager, 'WETH', TOKEN_ADDRESSES.WETH);
  const WBTC = await getExistingToken(deploymentManager, 'WBTC', TOKEN_ADDRESSES.WBTC);
  const LINK = await getExistingToken(deploymentManager, 'LINK', TOKEN_ADDRESSES.LINK);
  const UNI = await getExistingToken(deploymentManager, 'UNI', TOKEN_ADDRESSES.UNI);
  const USDC = await getExistingToken(deploymentManager, 'USDC', TOKEN_ADDRESSES.USDC);

  return {
    DAI,
    WETH,
    WBTC,
    LINK,
    UNI,
    USDC,
  };
}

// Helper function to setup price feeds from configuration
export async function setupPriceFeeds(deploymentManager: DeploymentManager): Promise<void> {
  // Get price feed addresses from configuration and add them to the deployment
  const priceFeedsConfig = await getPriceFeeds(deploymentManager);

  // Add price feeds to the deployment manager's contract map
  for (const [tokenName, priceFeedAddress] of Object.entries(priceFeedsConfig)) {
    const alias = `${tokenName.toLowerCase()}:priceFeed`;
    await deploymentManager.existing(
      alias, 
      priceFeedAddress as string, 
      deploymentManager.network, 
      'contracts/vendor/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface'
    );
  }
}
