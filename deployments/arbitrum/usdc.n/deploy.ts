import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;

  // pull in existing assets
  // USDC native
  const USDC = await deploymentManager.existing('USDC', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'arbitrum');
  const ARB = await deploymentManager.existing('ARB', '0x912ce59144191c1204e64559fe8253a0e49e6548', 'arbitrum');
  const GMX = await deploymentManager.existing('GMX', '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', 'arbitrum');
  const WETH = await deploymentManager.existing('WETH', '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'arbitrum');
  const WBTC = await deploymentManager.existing('WBTC', '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', 'arbitrum');
  const arbitrumCCTPTokenMinter = await deploymentManager.existing('arbitrumCCTPTokenMinter', '0xE7Ed1fa7f45D05C508232aa32649D89b73b8bA48', 'arbitrum');

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'arbitrum', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'arbitrum', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'arbitrum', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'arbitrum', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'arbitrum', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'arbitrum', 'usdc');
  const localTimelock = await deploymentManager.fromDep('timelock', 'arbitrum', 'usdc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'arbitrum', 'usdc');
  const bridgedComet = await deploymentManager.fromDep('bridgedComet', 'arbitrum', 'usdc', 'comet');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bridgeReceiver, 
    arbitrumCCTPTokenMinter,
    bulker, 
    rewards, 
    bridgedComet
  };
}