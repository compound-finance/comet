import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';
  
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
  
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
  
  const USDT = await deploymentManager.existing(
    'USDT',
    '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    'optimism'
  );
  const WETH = await deploymentManager.existing(
    'WETH',
    '0x4200000000000000000000000000000000000006',
    'optimism'
  );
  const WBTC = await deploymentManager.existing(
    'WBTC',
    '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
    'optimism'
  );
  const OP = await deploymentManager.existing(
    'OP',
    '0x4200000000000000000000000000000000000042',
    'optimism'
  );

  const COMP = await deploymentManager.existing(
    'COMP',
    '0x7e7d4467112689329f7E06571eD0E8CbAd4910eE',
    'optimism'
  );
    
  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'optimism', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'optimism', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'optimism', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'optimism', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'optimism', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'optimism', 'usdc');
  const localTimelock = await deploymentManager.fromDep('timelock', 'optimism', 'usdc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'optimism', 'usdc');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bridgeReceiver, 
    bulker,
    rewards,
    COMP
  };
}
