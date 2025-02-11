import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const _WBTC = await deploymentManager.existing('WBTC', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599');
  const _LBTC = await deploymentManager.existing('LBTC', '0x8236a87084f8B84306f72007F36F2618A5634494');
  const _pumpBTC = await deploymentManager.existing('pumpBTC', '0xF469fBD2abcd6B9de8E169d128226C0Fc90a012e');
  const COMP = await deploymentManager.existing('COMP', '0xc00e94Cb662C3520282E6f5717214004A7f26888');

  // Deploy scaling price feed for pumpBTC
  const _pumpBTCScalingPriceFeed = await deploymentManager.deploy(
    'pumpBTC:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x6CE4Ef3689F26edD40ed3ccbE3Cc29dab62C915f', // pumpBTC / BTC price feed
      8                                             // decimals
    ],
    true
  );

  // Import shared contracts from cUSDCv3
  const _cometFactory = await deploymentManager.existing('cometFactory', '0x1fA408992e74A42D1787E28b880C451452E8C958');
  const _assetListFactory = await deploymentManager.existing('assetListFactory', '0x3ff744cf6078714bb9d3c4fe5ab37fa6d05dec4e');
  const _cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const _$configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'mainnet', 'usdc');
  const _configurator = await deploymentManager.fromDep('configurator', 'mainnet', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'mainnet', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'mainnet', 'weth');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);

  return {
    ...deployed,
    bulker,
    rewards,
    COMP
  };
}