import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed | void> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed | void> {
  const trace = deploymentManager.tracer();

  // Pull in existing assets
  const WRON = await deploymentManager.existing(
    'WRON',
    '0xA959726154953bAe111746E265E6d754F48570E6',
    'ronin-saigon'
  );
  
  const USDC = await deploymentManager.existing(
    'USDC',
    '0x7a7ab4ac45a5329198e818e1fa56c27b443f8e3d',
    'ronin-saigon'
  );
  // pre-deployed OptimismMintableERC20
  // const COMP = await deploymentManager.existing(
  //   'COMP',
  //   '0x52b7D8851d6CcBC6342ba0855Be65f7B82A3F17f',
  //   'ronin-saigon'
  // );

  const l2CCIPRouter = await deploymentManager.existing(
    'l2CCIPRouter',
    '0x0aCAe4e51D3DA12Dd3F45A66e8b660f740e6b820',
    'ronin-saigon'
  );

  const l2CCIPOffRamp = await deploymentManager.existing(
    'l2CCIPOffRamp',
    '0x77008Fbd8Ae8f395beF9c6a55905896f3Ead75e9',
    'ronin-saigon'
  );

  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/optimism/OptimismBridgeReceiver.sol',
    [l2CCIPRouter.address]
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      1 * DAY,    // delay
      14 * DAY,   // grace period
      12 * HOUR,  // minimum delay
      30 * DAY,   // maxiumum delay
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

  const USDCPriceFeed = await deploymentManager.deploy(
    'USDC:simplePriceFeed',
    'test/SimplePriceFeed.sol',
    [
      exp(0.98882408, 18), // Latest answer on mainnet at block 16170924
      8
    ]
  );

  // Deploy cbETH / ETH SimplePriceFeed
  const WRONPriceFeed = await deploymentManager.deploy(
    'WRON:simplePriceFeed',
    'test/SimplePriceFeed.sol',
    [
      exp(0.97, 18),
      8
    ]
  );


  const assetConfig = {
    asset: WRON.address,
    priceFeed: WRONPriceFeed.address,
    decimals: (18).toString(),
    borrowCollateralFactor: (0.9e18).toString(),
    liquidateCollateralFactor: (0.91e18).toString(),
    liquidationFactor: (0.95e18).toString(),
    supplyCap: (1000000e8).toString(),
  };


  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec, {
    baseTokenPriceFeed: USDCPriceFeed.address,
    assetConfigs: [assetConfig],
  });
  // Deploy Comet
  const { comet } = deployed;

  // Deploy Bulker
  // It won't be used, as we do not have MNT as a base and as a collateral 
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      WRON.address,        // wrapped native token
    ]
  );
  // Deploy stETH / ETH SimplePriceFeed
  

  return {
    ...deployed,
    bridgeReceiver,
    l2CCIPRouter,
    l2CCIPOffRamp,
    bulker,
    USDC
    // COMP,
  };
}
