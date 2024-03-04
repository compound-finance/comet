import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep(
    'cometAdmin',
    'optimism',
    'usdc'
  );
  const cometFactory = await deploymentManager.fromDep(
    'cometFactory',
    'optimism',
    'usdc'
  );
  const $configuratorImpl = await deploymentManager.fromDep(
    'configurator:implementation',
    'optimism',
    'usdc'
  );
  const configurator = await deploymentManager.fromDep(
    'configurator',
    'optimism',
    'usdc'
  );
  const rewards = await deploymentManager.fromDep(
    'rewards',
    'optimism',
    'usdc'
  );
  const bulker = await deploymentManager.fromDep('bulker', 'optimism', 'usdc');
  const l2CrossDomainMessenger = await deploymentManager.fromDep(
    'l2CrossDomainMessenger',
    'optimism',
    'usdc'
  );
  const l2StandardBridge = await deploymentManager.fromDep(
    'l2StandardBridge',
    'optimism',
    'usdc'
  );
  const localTimelock = await deploymentManager.fromDep(
    'timelock',
    'optimism',
    'usdc'
  );
  const bridgeReceiver = await deploymentManager.fromDep(
    'bridgeReceiver',
    'optimism',
    'usdc'
  );

  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger, // TODO: don't have to part of roots. can be pulled via relations
    l2StandardBridge,
    bulker,
  };
}
