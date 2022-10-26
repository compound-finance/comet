import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const secondsPerDay = 24 * 60 * 60;

const CROSS_DOMAIN_MESSENGER = "0x4200000000000000000000000000000000000007";
const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;

  // pull in existing assets
  const USDC = await deploymentManager.existing('USDC', '0x7f5c764cbc14f9669b88837ca1490cca17c31607', 'optimism');
  const UNI = await deploymentManager.existing('UNI', '0x6fd9d7ad17242c41f7131d257212c54a0e816691', 'optimism');
  const LINK = await deploymentManager.existing('LINK', '0x350a791bfc2c21f9ed5d10980dad2e2638ffa7f6', 'optimism');
  const WBTC = await deploymentManager.existing('WBTC', '0x68f180fcce6836688e9084f035309e29bf0a2095', 'optimism');
  const WETH = await deploymentManager.existing('WETH', '0x4200000000000000000000000000000000000006', 'optimism');

  // L2CrossDomainMessenger
  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    CROSS_DOMAIN_MESSENGER,
    'optimism'
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
      2 * secondsPerDay,      // delay
      14 * secondsPerDay,     // grace period
      2 * secondsPerDay,      // minimum delay
      30 * secondsPerDay      // maxiumum delay
    ]
  );

  // Initialize PolygonBridgeReceiver
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
    'Bulker.sol',
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