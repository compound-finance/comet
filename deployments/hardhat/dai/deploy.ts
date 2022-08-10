import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import {
  FaucetToken,
  FaucetToken__factory,
  SimplePriceFeed,
  SimplePriceFeed__factory,
} from '../../../build/types';
import { deployComet } from '../../../src/deploy';
import { exp } from '../../../test/helpers';

// XXX clean this all up further, but minimize changes for now on first pass refactor

async function makeToken(
  deploymentManager: DeploymentManager,
  amount: number,
  name: string,
  decimals: number,
  symbol: string
): Promise<FaucetToken> {
  return await deploymentManager.deploy<
    FaucetToken,
    FaucetToken__factory,
    [string, string, number, string]
  >('test/FaucetToken.sol', [
    (BigInt(amount) * 10n ** BigInt(decimals)).toString(),
    name,
    decimals,
    symbol,
  ]);
}

async function makePriceFeed(
  deploymentManager: DeploymentManager,
  initialPrice: number,
  decimals: number
): Promise<SimplePriceFeed> {
  return await deploymentManager.deploy<
    SimplePriceFeed,
    SimplePriceFeed__factory,
    [number, number]
  >('test/SimplePriceFeed.sol', [initialPrice * 1e8, decimals]);
}

// TODO: Support configurable assets as well?
export default async function deploy(deploymentManager: DeploymentManager) {
  const [admin, pauseGuardianSigner] = await deploymentManager.getSigners();

  let dai = await makeToken(deploymentManager, 10000000, 'DAI', 18, 'DAI');
  let gold = await makeToken(deploymentManager, 20000000, 'GOLD', 8, 'GOLD');
  let silver = await makeToken(deploymentManager, 30000000, 'SILVER', 10, 'SILVER');

  let daiPriceFeed = await makePriceFeed(deploymentManager, 1, 8);
  let goldPriceFeed = await makePriceFeed(deploymentManager, 0.5, 8);
  let silverPriceFeed = await makePriceFeed(deploymentManager, 0.05, 8);

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

  // Contracts referenced in `configuration.json` or configs
  let contracts = new Map([
    ['DAI', dai],
    ['SILVER', silver],
    ['GOLD', gold],
  ]);

  // Deploy all Comet-related contracts
  let { cometProxy, configuratorProxy, rewards } = await deployComet(
    deploymentManager,
    { all: true },
    {
      baseTokenPriceFeed: daiPriceFeed.address,
      assetConfigs: [assetConfig0, assetConfig1],
    },
    contracts
  );

  // Transfer some GOLD token to the rewards contract to use as rewards
  await gold.transfer(rewards.address, exp(2_000_000, 8));

  return {
    comet: cometProxy.address,
    configurator: configuratorProxy.address,
    rewards: rewards.address,
  };
}
