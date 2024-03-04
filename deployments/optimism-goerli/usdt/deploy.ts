import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

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
    'optimism-goerli',
    'usdc'
  );
  const cometFactory = await deploymentManager.fromDep(
    'cometFactory',
    'optimism-goerli',
    'usdc'
  );
  const $configuratorImpl = await deploymentManager.fromDep(
    'configurator:implementation',
    'optimism-goerli',
    'usdc'
  );
  const configurator = await deploymentManager.fromDep(
    'configurator',
    'optimism-goerli',
    'usdc'
  );
  const rewards = await deploymentManager.fromDep(
    'rewards',
    'optimism-goerli',
    'usdc'
  );
  const bulker = await deploymentManager.fromDep(
    'bulker',
    'optimism-goerli',
    'usdc'
  );
  const fauceteer = await deploymentManager.fromDep(
    'fauceteer',
    'optimism-goerli',
    'usdc'
  );
  const l2CrossDomainMessenger = await deploymentManager.fromDep(
    'l2CrossDomainMessenger',
    'optimism-goerli',
    'usdc'
  );
  const l2StandardBridge = await deploymentManager.fromDep(
    'l2StandardBridge',
    'optimism-goerli',
    'usdc'
  );
  const localTimelock = await deploymentManager.fromDep(
    'timelock',
    'optimism-goerli',
    'usdc'
  );
  const bridgeReceiver = await deploymentManager.fromDep(
    'bridgeReceiver',
    'optimism-goerli',
    'usdc'
  );

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger,
    l2StandardBridge,
    bulker,
    fauceteer,
  };
}
