import { DeploymentManager } from '../../plugins/deployment_manager';
import { FaucetToken } from '../../build/types';
import { getPriceFeeds } from '../../src/deploy/NetworkConfiguration';

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
  // Get existing test tokens at their deployed addresses
  const DAI = await getExistingToken(deploymentManager, 'DAI', '0xeF4555a8ee300250DeFa1f929FEfa2A3a9af628a');
  const WETH = await getExistingToken(deploymentManager, 'WETH', '0xf5aD60F3B4F86D1Ef076fB4e26b4A4FeDbE7a93b');
  const WBTC = await getExistingToken(deploymentManager, 'WBTC', '0x7c9Dfdc92A707937C4CfD1C21B3BBA5220D4f3A2');
  const LINK = await getExistingToken(deploymentManager, 'LINK', '0x4686A8C76a095584112AC3Fd0362Cb65f7C11b8B');
  const UNI = await getExistingToken(deploymentManager, 'UNI', '0xc1031Cfd04d0c68505B0Fc3dFdfC41DF391Cf6A6');
  const USDC = await getExistingToken(deploymentManager, 'USDC', '0x27E8e32f076e1B4cc45bdcA4dbA5D9D8505Bab43');

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
