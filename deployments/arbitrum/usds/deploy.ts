import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const SUSDS_TO_USDS_PRICE_FEED = '0x2483326d19f780Fb082f333Fe124e4C075B207ba';
const USDS_TO_USD_PRICE_FEED = '0x37833E5b3fbbEd4D613a3e0C354eF91A42B81eeB';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const _USDS = await deploymentManager.existing('USDS', '0x6491c05A82219b8D1479057361ff1654749b876b', 'arbitrum');
  const _sUSDS = await deploymentManager.existing('sUSDS', '0xdDb46999F8891663a8F2828d25298f70416d7610', 'arbitrum');
  const COMP = await deploymentManager.existing('COMP', '0x354A6dA3fcde098F8389cad84b0182725c6C91dE', 'arbitrum');

  const _sUSDSPriceFeed = await deploymentManager.deploy(
    'sUSDS:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      SUSDS_TO_USDS_PRICE_FEED, // sUSDS / USDS price feed
      USDS_TO_USD_PRICE_FEED,   // USDS / USD price feed
      8,                        // decimals
      'sUSDS / USD price feed'  // description
    ]
  );

  // Import shared contracts from cUSDCv3
  const _cometAdmin = await deploymentManager.fromDep('cometAdmin', 'arbitrum', 'usdc.e');
  const _assetListFactory = await deploymentManager.fromDep('assetListFactory', 'arbitrum', 'usdc.e');
  const _cometFactory = await deploymentManager.fromDep('cometFactory', 'arbitrum', 'usdc.e');
  const _$configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'arbitrum', 'usdc.e');
  const _configurator = await deploymentManager.fromDep('configurator', 'arbitrum', 'usdc.e');
  const rewards = await deploymentManager.fromDep('rewards', 'arbitrum', 'usdc.e');
  const bulker = await deploymentManager.fromDep('bulker', 'arbitrum', 'usdc.e');
  const _localTimelock = await deploymentManager.fromDep('timelock', 'arbitrum', 'usdc.e');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'arbitrum', 'usdc.e');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);

  return {
    ...deployed,
    bridgeReceiver, 
    bulker,
    rewards,
    COMP
  };
}
