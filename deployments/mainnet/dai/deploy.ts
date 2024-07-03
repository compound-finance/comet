import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const DAI = await deploymentManager.existing('DAI', '0x6B175474E89094C44Da98b954EedeAC495271d0F');
  const WBTC = await deploymentManager.existing('WBTC', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
  const WETH = await deploymentManager.existing('WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
  const USDe = await deploymentManager.existing('USDe', '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3');
  const sUSDe = await deploymentManager.existing('sUSDe', '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497');
  const COMP = await deploymentManager.existing('COMP', '0xc00e94Cb662C3520282E6f5717214004A7f26888');

  const wbtcScalingPriceFeed = await deploymentManager.deploy(
    'WBTC:priceFeed',
    'pricefeeds/WBTCPriceFeed.sol',
    [
      '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23', // WBTC / BTC price feed
      '0xdeb288F737066589598e9214E782fa5A8eD689e8', // BTC / USD price feed
      8                                             // decimals
    ]
  );

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'mainnet', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'mainnet', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'mainnet', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'mainnet', 'usdc');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  return {
    ...deployed,
    bulker,
    rewards,
    COMP
  };
}
