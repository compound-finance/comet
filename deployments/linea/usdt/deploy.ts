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

  // Pull in existing assets
  const USDT = await deploymentManager.existing(
    'USDT',
    '0xA219439258ca9da29E9Cc4cE5596924745e12B93',
    'linea'
  );
  const WETH = await deploymentManager.existing(
    'WETH',
    '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
    'linea'
  );
  const WBTC = await deploymentManager.existing(
    'WBTC',
    '0x3aAB2285ddcDdaD8edf438C1bAB47e1a9D05a9b4',
    'linea'
  );

  const wstETH = await deploymentManager.existing(
    'wstETH',
    '0xB5beDd42000b71FddE22D3eE8a79Bd49A568fC8F',
    'linea'
  );

  const l2MessageService = await deploymentManager.existing(
    'l2MessageService',
    [
      '0x05d43713B7E333d2D54be65cE3b5F3698aB960Fd',
      '0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec',
    ],
    'linea'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    [
      '0xD90ed3D4f9d11262d3D346a4369058d5B3777137',
      '0x353012dc4a9A6cF55c941bADC267f82004A8ceB9',
    ],
    'linea'
  );

  const l2USDCBridge = await deploymentManager.existing(
    'l2USDCBridge',
    [
      '0x6D967F862d8c5D9E230a976AB2063eD1d4D7A43c',
      '0xA2Ee6Fce4ACB62D95448729cDb781e3BEb62504A',
    ],
    'linea'
  );
  
  // Import shared contracts from cUSDCv3
  // const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'linea', 'usdc');
  // const cometFactory = await deploymentManager.fromDep('cometFactory', 'linea', 'usdc');
  // const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'linea', 'usdc');
  // const configurator = await deploymentManager.fromDep('configurator', 'linea', 'usdc');
  // const rewards = await deploymentManager.fromDep('rewards', 'linea', 'usdc');
  // const bulker = await deploymentManager.fromDep('bulker', 'linea', 'usdc');
  // const localTimelock = await deploymentManager.fromDep('timelock', 'linea', 'usdc');
  // const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'linea', 'usdc');

  // Deploy LineaBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/linea/LineaBridgeReceiver.sol',
    [l2MessageService.address]
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      1 * DAY, // delay
      14 * DAY, // grace period
      12 * HOUR, // minimum delay
      30 * DAY, // maxiumum delay
    ]
  );

  // Initialize OptimismBridgeReceiver
  await deploymentManager.idempotent(
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

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);
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
    l2MessageService,
    l2StandardBridge,
    l2USDCBridge,
    bulker,
  };
}
