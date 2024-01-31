import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp, wait } from '../../../src/deploy';

const secondsPerDay = 24 * 60 * 60;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;

  // Pull in existing assets
  const WETH = await deploymentManager.existing(
    'WETH',
    '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
    'linea'
  );

  const l2MessageService = await deploymentManager.existing(
    'l2MessageService',
    '0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec',
    'linea'
  );

  const l2TokenBridge = await deploymentManager.existing(
    'l2TokenBridge',
    '0x353012dc4a9A6cF55c941bADC267f82004A8ceB9',
    'linea'
  );

  const l2usdcBridge = await deploymentManager.existing(
    'l2usdcBridge',
    '0xA2Ee6Fce4ACB62D95448729cDb781e3BEb62504A',
    'linea'
  );

  // Deploy LineaBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/linea/LineaBridgeReceiver.sol',
    [l2MessageService.address]
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy('timelock', 'vendor/Timelock.sol', [
    bridgeReceiver.address, // admin
    10 * 60, // delay
    14 * secondsPerDay, // grace period
    10 * 60, // minimum delay
    30 * secondsPerDay // maximum delay
  ]);

  // Initialize BridgeReceiver
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
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy('bulker', 'bulkers/BaseBulker.sol', [
    await comet.governor(), // admin
    WETH.address // weth
  ]);

  return {
    ...deployed,
    bridgeReceiver,
    l2MessageService,
    l2TokenBridge,
    bulker,
    l2usdcBridge
  };
}
