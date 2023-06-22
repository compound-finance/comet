import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const SECONDS_PER_DAY = 24 * 60 * 60;

const GOERLI_TIMELOCK = '0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399';

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
  const WETH = await deploymentManager.existing(
    'BridgeToken',
    '0xB767287A7143759f294CfB7b1Adbca1140F3de71',
    'fuji'
  );

  const l2TelepathyRouter = await deploymentManager.existing(
    'TelepathyRouter',
    ['0x4D2DFD0Df230927A4C93DF6bcc4d720377343aA7', '0x677b79C9ec8FC287C10d8dE70384a4C5e3999b5c'],
    'fuji'
  );

  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/succinct/SuccinctBridgeReceiver.sol',
    [l2TelepathyRouter.address]
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      10 * 60,                // delay
      14 * SECONDS_PER_DAY,   // grace period
      10 * 60,                // minimum delay
      30 * SECONDS_PER_DAY    // maximum delay
    ]
  );

  // Initialize OptimismBridgeReceiver
  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        GOERLI_TIMELOCK,      // govTimelock
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

  // Deploy fauceteer
  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);

  return {
    ...deployed,
    bridgeReceiver,
    l2TelepathyRouter,
    bulker,
    fauceteer
  };
}