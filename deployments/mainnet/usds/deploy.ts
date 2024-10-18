import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const WETH = await deploymentManager.existing('WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
  const COMP = await deploymentManager.existing('COMP', '0xc00e94Cb662C3520282E6f5717214004A7f26888');
  const wstETH = await deploymentManager.existing('wstETH', '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0');
  const cbBTC = await deploymentManager.existing('cbBTC', '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf');
  const tBTC = await deploymentManager.existing('tBTC', '0x18084fbA666a33d37592fA2633fD49a74DD93a88');
  const USDe = await deploymentManager.existing('USDe', '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3');
  const USDS = await deploymentManager.existing('USDS', '0xdC035D45d973E3EC169d2276DDab16f1e407384F');

  const wstETHtoUsdPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/WstETHPriceFeed.sol',
    [
      '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // ETH / USD price feed
      wstETH.address,                               // wstETH token
      8,                                            // decimals
    ],
    true
  );

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'mainnet', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'mainnet', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'mainnet', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'mainnet', 'weth');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bulker,
    rewards,
    COMP
  };
}