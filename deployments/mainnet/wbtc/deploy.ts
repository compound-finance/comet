import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const WBTC = await deploymentManager.existing('WBTC', '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599');
  const solvBTC_BBN = await deploymentManager.existing('SolvBTC.BBN', '0xd9D920AA40f578ab794426F5C90F6C731D159DEf');
  const LBTC = await deploymentManager.existing('LBTC', '0x8236a87084f8B84306f72007F36F2618A5634494');
  const pumpBTC = await deploymentManager.existing('pumpBTC', '0xF469fBD2abcd6B9de8E169d128226C0Fc90a012e');
  const COMP = await deploymentManager.existing('COMP', '0xc00e94Cb662C3520282E6f5717214004A7f26888');

  const solvBTC_BBNPriceFeed = await deploymentManager.deploy(
    'SolvBTC.BBN:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      '0x1f34794A16D644b9810477EbF3f0b3870141E2e3', // SolvBTC.BBN / SolvBTC price feed
      '0x936B31C428C29713343E05D631e69304f5cF5f49', // SolvBTC / BTC price feed
      8,                                            // decimals
      'solvBTC.BBN / BTC price feed'                // description
    ],
    true
  );

  // Deploy scaling price feed for pumpBTC
  const pumpBTCScalingPriceFeed = await deploymentManager.deploy(
    'pumpBTC:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x6CE4Ef3689F26edD40ed3ccbE3Cc29dab62C915f', // pumpBTC / BTC price feed
      8                                             // decimals
    ],
    true
  );

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');
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