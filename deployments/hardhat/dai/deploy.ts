import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { FaucetToken, SimplePriceFeed } from '../../../build/types';
import { deployComet } from '../../../src/deploy';

// XXX clean this all up further, but minimize changes for now on first pass refactor

async function makeToken(
  deploymentManager: DeploymentManager,
  amount: number,
  name: string,
  decimals: number,
  symbol: string
): Promise<FaucetToken> {
  return deploymentManager.getOrDeployAlias(symbol, 'test/FaucetToken.sol', [
    (BigInt(amount) * 10n ** BigInt(decimals)).toString(),
    name,
    decimals,
    symbol,
  ]);
}

async function makePriceFeed(
  deploymentManager: DeploymentManager,
  alias: string,
  initialPrice: number,
  decimals: number
): Promise<SimplePriceFeed> {
  return deploymentManager.getOrDeployAlias(alias, 'test/SimplePriceFeed.sol', [initialPrice * 1e8, decimals]);
}

// TODO: Support configurable assets as well?
export default async function deploy(deploymentManager: DeploymentManager) {
  const [admin, pauseGuardianSigner] = await deploymentManager.getSigners();

  let dai = await makeToken(deploymentManager, 1000000, 'DAI', 18, 'DAI');
  let gold = await makeToken(deploymentManager, 2000000, 'GOLD', 8, 'GOLD');
  let silver = await makeToken(deploymentManager, 3000000, 'SILVER', 10, 'SILVER');

  let daiPriceFeed = await makePriceFeed(deploymentManager, 'DAI:priceFeed', 1, 8);
  let goldPriceFeed = await makePriceFeed(deploymentManager, 'GOLD:priceFeed', 0.5, 8);
  let silverPriceFeed = await makePriceFeed(deploymentManager, 'SILVER:priceFeed', 0.05, 8);

  let assetConfig0 = {
    asset: gold.address,
    priceFeed: goldPriceFeed.address,
    decimals: (8).toString(),
    borrowCollateralFactor: (0.9e18).toString(),
    liquidateCollateralFactor: (1e18).toString(),
    liquidationFactor: (0.95e18).toString(),
    supplyCap: (1000000e8).toString(),
  };

  let assetConfig1 = {
    asset: silver.address,
    priceFeed: silverPriceFeed.address,
    decimals: (10).toString(),
    borrowCollateralFactor: (0.4e18).toString(),
    liquidateCollateralFactor: (0.5e18).toString(),
    liquidationFactor: (0.9e18).toString(),
    supplyCap: (500000e10).toString(),
  };

  // Deploy all Comet-related contracts
  let { cometProxy, configuratorProxy, timelock, rewards } = await deployComet(
    deploymentManager,
    { all: true },
    {
      baseTokenPriceFeed: daiPriceFeed.address,
      assetConfigs: [assetConfig0, assetConfig1],
    }
  );

  return {
    comet: cometProxy.address,
    configurator: configuratorProxy.address,
    rewards: rewards.address,
  };
}
