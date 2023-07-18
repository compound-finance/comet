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
  const trace = deploymentManager.tracer();

  // Pull in existing assets
  const USDC = await deploymentManager.existing('USDC', '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', 'base'); // TODO
  const WETH = await deploymentManager.existing('WETH', '0x4200000000000000000000000000000000000006', 'base');
  const cbETH = await deploymentManager.existing('WETH', '0x4200000000000000000000000000000000000006', 'base'); // TODO
  const WBTC = await deploymentManager.existing('WBTC', '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', 'base'); // TODO

  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    ['0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007', '0x4200000000000000000000000000000000000007'],
    'base'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    ['0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010', '0x4200000000000000000000000000000000000010'],
    'base'
  );

  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/optimism/OptimismBridgeReceiver.sol',
    [l2CrossDomainMessenger.address]
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      1 * DAY,                // delay
      14 * DAY,               // grace period
      12 * HOUR,              // minimum delay
      30 * DAY                // maxiumum delay
    ]
  );

  // Initialize OptimismBridgeReceiver
  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        MAINNET_TIMELOCK,      // govTimelock
        localTimelock.address  // localTimelock
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
    l2CrossDomainMessenger, // TODO: don't have to part of roots. can be pulled via relations
    l2StandardBridge,
    bulker,
  };
}
