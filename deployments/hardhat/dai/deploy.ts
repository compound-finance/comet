import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { FaucetToken, SimplePriceFeed } from '../../../build/types';
import { debug, deployComet, sameAddress, wait } from '../../../src/deploy';

async function makeToken(
  deploymentManager: DeploymentManager,
  amount: number,
  name: string,
  decimals: number,
  symbol: string
): Promise<FaucetToken> {
  const mint = (BigInt(amount) * 10n ** BigInt(decimals)).toString();
  return deploymentManager.deploy(symbol, 'test/FaucetToken.sol', [mint, name, decimals, symbol]);
}

async function makePriceFeed(
  deploymentManager: DeploymentManager,
  alias: string,
  initialPrice: number,
  decimals: number
): Promise<SimplePriceFeed> {
  return deploymentManager.deploy(alias, 'test/SimplePriceFeed.sol', [initialPrice * 1e8, decimals]);
}

// TODO: Support configurable assets as well?
export default async function deploy(deploymentManager: DeploymentManager, deploySpec) {
  const ethers = deploymentManager.hre.ethers;
  const [admin, pauseGuardianSigner] = await deploymentManager.getSigners();

  // XXX clone
  const governor = await deploymentManager.deploy('governor', 'test/GovernorSimple.sol', []);
  const timelock = await deploymentManager.deploy('timelock', 'test/SimpleTimelock.sol', [governor.address]);

  // XXX will fail if gov already has a diff timelock, and technically should otherwise ensure admin
  //  but we are anyway replacing gov simple
  await deploymentManager.idempotent(
    async () => !sameAddress(await governor.timelock(), timelock.address),
    async () => {
      debug(`Initializing GovSimple`);
      await wait(governor.connect(admin).initialize(timelock.address, [admin.address]));
    }
  );

  const dai = await makeToken(deploymentManager, 1000000, 'DAI', 18, 'DAI');
  const gold = await makeToken(deploymentManager, 2000000, 'GOLD', 8, 'GOLD');
  const silver = await makeToken(deploymentManager, 3000000, 'SILVER', 10, 'SILVER');

  const daiPriceFeed = await makePriceFeed(deploymentManager, 'DAI:priceFeed', 1, 8);
  const goldPriceFeed = await makePriceFeed(deploymentManager, 'GOLD:priceFeed', 0.5, 8);
  const silverPriceFeed = await makePriceFeed(deploymentManager, 'SILVER:priceFeed', 0.05, 8);

  const assetConfig0 = {
    asset: gold.address,
    priceFeed: goldPriceFeed.address,
    decimals: (8).toString(),
    borrowCollateralFactor: (0.9e18).toString(),
    liquidateCollateralFactor: (1e18).toString(),
    liquidationFactor: (0.95e18).toString(),
    supplyCap: (1000000e8).toString(),
  };

  const assetConfig1 = {
    asset: silver.address,
    priceFeed: silverPriceFeed.address,
    decimals: (10).toString(),
    borrowCollateralFactor: (0.4e18).toString(),
    liquidateCollateralFactor: (0.5e18).toString(),
    liquidationFactor: (0.9e18).toString(),
    supplyCap: (500000e10).toString(),
  };

  // Deploy all Comet-related contracts
  await deployComet( deploymentManager, deploySpec, {
    baseTokenPriceFeed: daiPriceFeed.address,
    assetConfigs: [assetConfig0, assetConfig1],
  });

  return ['comet', 'configurator', 'rewards'];
}
