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

  const USDC = await deploymentManager.existing(
    'USDC',
    '0x4fed3d02d095f7d92af161311fa6ef23dc8da040',
    'fuji'
  );

  const WBTC_E = await deploymentManager.existing(
    'WBTC.e',
    '0xfa78400e01Fc9da830Cb2F13B3e7E18F813414Ff',
    'fuji'
  );

  const WAVAX = await deploymentManager.existing(
    'WAVAX',
    '0xA2c25E48269e3f89A60b2CC8e02AAfEeB3BAb761',
    'fuji'
  );

  // Pull in existing assets
  const WETH = await deploymentManager.existing(
    'MintableERC20',
    '0x9668f5f55f2712Dd2dfa316256609b516292D554',
    'fuji'
  );

  const l2TelepathyRouter = await deploymentManager.existing(
    'TelepathyRouter',
    ['0x75d02F008ce008bCC6307784135760795726F281'],
    'fuji'
  );
  
  const srcChainId = 5;
  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/succinct/SuccinctBridgeReceiver.sol',
    [l2TelepathyRouter.address, srcChainId]
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
    ],
    true // force
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