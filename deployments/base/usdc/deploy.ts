import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const SECONDS_PER_DAY = 24 * 60 * 60;

const CROSS_DOMAIN_MESSENGER = '0x4200000000000000000000000000000000000007';
const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;

  // pull in existing assets
  const USDC = await deploymentManager.existing('USDC', '0x7f5c764cbc14f9669b88837ca1490cca17c31607', 'base');
  const WBTC = await deploymentManager.existing('WBTC', '0x68f180fcce6836688e9084f035309e29bf0a2095', 'base');
  const WETH = await deploymentManager.existing('WETH', '0x4200000000000000000000000000000000000006', 'base');

  // L2CrossDomainMessenger
  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    CROSS_DOMAIN_MESSENGER,
    'base'
  );

  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/optimism/OptimismBridgeReceiver.sol',
    [CROSS_DOMAIN_MESSENGER] // crossDomainMessenger
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      2 * SECONDS_PER_DAY,    // delay
      14 * SECONDS_PER_DAY,   // grace period
      2 * SECONDS_PER_DAY,    // minimum delay
      30 * SECONDS_PER_DAY    // maxiumum delay
    ]
  );

  // Initialize OptimismBridgeReceiver
  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        MAINNET_TIMELOCK,     // govTimelock
        localTimelock.address // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      WETH.address            // weth
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger,
    bulker
  };
}