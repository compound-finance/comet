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

  const USDC = await deploymentManager.existing('USDC', '0x29219dd400f2Bf60E5a23d13Be72B486D4038894', 'sonic');
  const WETH = await deploymentManager.existing('WETH', '0x50c42dEAcD8Fc9773493ED674b675bE577f2634b', 'sonic');

  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/optimism/OptimismBridgeReceiver.sol', //TODO other
    [l2CrossDomainMessenger.address]
  );

  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address,
      1 * DAY,
      14 * DAY,
      12 * HOUR,
      30 * DAY,
    ]
  );

  // Initialize OptimismBridgeReceiver
  await deploymentManager.retry(() => {
    return deploymentManager.idempotent(
      async () => !(await bridgeReceiver.initialized()),
      async () => {
        trace(`Initializing BridgeReceiver`);
        await bridgeReceiver.initialize(
          MAINNET_TIMELOCK, // govTimelock
          localTimelock.address // localTimelock
        );
        trace(`BridgeReceiver initialized`);
      }
    );
  });

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      WETH.address, // weth
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger, // TODO: don't have to part of roots. can be pulled via relations
    l2StandardBridge,
    bulker,
  };
}