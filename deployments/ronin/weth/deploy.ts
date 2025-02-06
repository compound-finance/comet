import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const SEPOLIA_TIMELOCK = '0x54a06047087927D9B0fb21c1cf0ebd792764dDB8';

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

  const l2CCIPRouter = await deploymentManager.existing(
    'l2CCIPRouter',
    '0x46527571D5D1B68eE7Eb60B18A32e6C60DcEAf99',
    'ronin'
  );

  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/ronin/RoninBridgeReceiver.sol',
    [l2CCIPRouter.address], 
    true
  );

  const WETH = await deploymentManager.existing(
    'WETH',
    '0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5',
    'ronin'
  );
  // pre-deployed OptimismMintableERC20
  const COMP = await deploymentManager.existing(
    'COMP',
    '0x3902228d6a3d2dc44731fd9d45fee6a61c722d0b',
    'ronin'
  );

  const l2CCIPOffRamp = await deploymentManager.existing(
    'l2CCIPOffRamp',
    '0x320A10449556388503Fd71D74A16AB52e0BD1dEb',
    'ronin'
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
        SEPOLIA_TIMELOCK,     // govTimelock
        localTimelock.address // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );

  const WETHPriceFeed = await deploymentManager.deploy(
    'WETH:simplePriceFeed',
    'test/SimplePriceFeed.sol',
    [
      exp(1, 18),
      8
    ]
  );

  // const WRONPriceFeed = await deploymentManager.deploy(
  //   'WRON:simplePriceFeed',
  //   'test/SimplePriceFeed.sol',
  //   [
  //     exp(0.047, 18),
  //     8
  //   ]
  // );

  const COMPPriceFeed = await deploymentManager.deploy(
    'COMP:simplePriceFeed',
    'test/SimplePriceFeed.sol',
    [
      exp(0.022, 18),
      8
    ]
  );


  // const assetConfig0 = {
  //   asset: WETH.address,
  //   priceFeed: WRONPriceFeed.address,
  //   decimals: (18).toString(),
  //   borrowCollateralFactor: (0.9e18).toString(),
  //   liquidateCollateralFactor: (0.91e18).toString(),
  //   liquidationFactor: (0.95e18).toString(),
  //   supplyCap: (1000000e8).toString(),
  // };

  const assetConfig1 = {
    asset: COMP.address,
    priceFeed: COMPPriceFeed.address,
    decimals: (18).toString(),
    borrowCollateralFactor: (0.9e18).toString(),
    liquidateCollateralFactor: (0.91e18).toString(),
    liquidationFactor: (0.95e18).toString(),
    supplyCap: (1000000e8).toString(),
  };



  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec, {
    baseTokenPriceFeed: WETHPriceFeed.address,
    //assetConfigs: [assetConfig0, assetConfig1],\
    assetConfigs: [assetConfig1],
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
      WETH.address,        // wrapped native token
    ]
  );
  // Deploy stETH / ETH SimplePriceFeed
  

  return {
    ...deployed,
    bridgeReceiver,
    l2CCIPRouter,
    l2CCIPOffRamp,
    bulker,
    COMP,
    // WETH
  };
}
