import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  // Pull in existing assets
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'base', 'usdbc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'base', 'usdbc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'base', 'usdbc');
  const configurator = await deploymentManager.fromDep('configurator', 'base', 'usdbc');
  const rewards = await deploymentManager.fromDep('rewards', 'base', 'usdbc');
  const bulker = await deploymentManager.fromDep('bulker', 'base', 'usdbc');
  const l2CrossDomainMessenger = await deploymentManager.fromDep('l2CrossDomainMessenger', 'base', 'usdbc');
  const l2StandardBridge = await deploymentManager.fromDep('l2StandardBridge', 'base', 'usdbc');
  const localTimelock = await deploymentManager.fromDep('timelock', 'base', 'usdbc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'base', 'usdbc');
  const cbETHMultiplicativePriceFeed = await deploymentManager.fromDep('cbETH:priceFeed','base', 'usdbc');


  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger, // TODO: don't have to part of roots. can be pulled via relations
    l2StandardBridge,
    bulker,
  };
}
