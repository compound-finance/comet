import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const stETH = await deploymentManager.existing('stETH', '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84');
  const wstETH = await deploymentManager.existing('wstETH', '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0');

  // Deploy WstETHPriceFeed
  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'WstETHPriceFeed.sol',
    [
      '0x86392dC19c0b719886221c78AB11eb8Cf5c52812', // stETHtoETHPriceFeed
      wstETH.address,                                // wstETH
      8                                             // decimals
    ]
  );

  // Deploy constant price feed for WETH
  const wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  // Deploy scaling price feed for cbETH
  const cbETHScalingPriceFeed = await deploymentManager.deploy(
    'cbETH:priceFeed',
    'ScalingPriceFeed.sol',
    [
      '0xF017fcB346A1885194689bA23Eff2fE6fA5C483b', // cbETH / ETH price feed
      8                                             // decimals
    ]
  );

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'mainnet', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'mainnet', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'mainnet', 'usdc');

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/MainnetBulker.sol',
    [
      await comet.governor(),  // admin_
      await comet.baseToken(), // weth_
      wstETH.address           // wsteth_
    ]
  );

  return { ...deployed, bulker };
}
