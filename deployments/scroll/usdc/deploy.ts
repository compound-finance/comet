import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp, wait } from '../../../src/deploy';

const secondsPerDay = 24 * 60 * 60;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925'; // L1 contract

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;

  // Pull in existing assets
  const WETH = await deploymentManager.existing('WETH','0x5300000000000000000000000000000000000004','scroll');
  const wstETH = await deploymentManager.existing('wstETH', '0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32', 'scroll');

  const l2Messenger = await deploymentManager.existing('l2Messenger','0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC','scroll');
  const l2ERC20Gateway = await deploymentManager.existing('l2ERC20Gateway','0xE2b4795039517653c5Ae8C2A9BFdd783b48f447A','scroll');
  const l2ETHGateway = await deploymentManager.existing('l2ETHGateway', '0x6EA73e05AdC79974B931123675ea8F78FfdacDF0', 'scroll');
  const l2WETHGateway = await deploymentManager.existing('l2WETHGateway','0x7003E7B7186f0E6601203b99F7B8DECBfA391cf9','scroll');

  // Deploy ScrollBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/scroll/ScrollBridgeReceiver.sol',
    [l2Messenger.address]
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy('timelock', 'vendor/Timelock.sol', [
    bridgeReceiver.address, // admin
    10 * 60, // delay
    14 * secondsPerDay, // grace period
    10 * 60, // minimum delay
    30 * secondsPerDay // maximum delay
  ]);

  // Deploy multiplicative price feed for wstETH / USD
  const wstETHMultiplicativePriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      '0xe428fbdbd61CC1be6C273dC0E27a1F43124a86F3', // wstETH / ETH price feed
      '0x6bF14CB0A831078629D993FDeBcB182b21A8774C', // ETH / USD price feed
      8,                                            // decimals
      'wstETH / USD price feed'                      // description
    ]
  );

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
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/MainnetBulker.sol',
    [
      await comet.governor(),        // admin_
      WETH.address,                  // weth_
      wstETH.address                 // wsteth_
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    l2Messenger,
    l2ERC20Gateway,
    l2ETHGateway,
    l2WETHGateway,
    bulker,
  };
}
