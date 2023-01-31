import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const secondsPerDay = 24 * 60 * 60;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;

  // pull in existing assets
  const USDC = await deploymentManager.existing('USDC', '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', 'polygon');
  const WETH = await deploymentManager.existing('WETH', '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619', 'polygon');
  const WBTC = await deploymentManager.existing('WBTC', '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', 'polygon');
  const DAI = await deploymentManager.existing('DAI', '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063', 'polygon');
  const USDT = await deploymentManager.existing('USDT', '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', 'polygon');

  const fxChild = await deploymentManager.existing('fxChild', '0x8397259c983751DAf40400790063935a11afa28a', 'polygon');

  // Deploy PolygonBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/polygon/PolygonBridgeReceiver.sol',
    [fxChild?.address]  // fxChild
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
      await comet.governor(),      // admin
      ethers.constants.AddressZero // weth (zero address, since Polygon deployment does not include WMATIC)
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    fxChild,
    bulker
  };
}