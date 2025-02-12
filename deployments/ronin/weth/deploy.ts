import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925';

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

  const roninl2NativeBridge = await deploymentManager.existing(
    'roninl2NativeBridge',
    '0x0cf8ff40a508bdbc39fbe1bb679dcba64e65c7df',
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
        MAINNET_TIMELOCK,     // govTimelock
        localTimelock.address // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );

  const WETHPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [ 
      8,
      exp(2600, 8),
     
    ]
  );

  const WRONPriceFeed = await deploymentManager.deploy(
    'WRON:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,
      exp(10.04, 8)
    ]
  );


  const AXSPriceFeed = await deploymentManager.deploy(
    'AXS:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,
      exp(4.02, 8),
    ]
  );


  const USDCPriceFeed = await deploymentManager.deploy(
    'USDC:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,
      exp(1, 8),
    ]
  );


  const COMPPriceFeed = await deploymentManager.deploy(
    'LINK:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,
      exp(18.4, 18),
    ]
  );




  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  // Deploy Comet
  const { comet } = deployed;

  // Deploy Bulker
  // It won't be used, as we do not have MNT as a base and as a collateral 
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      '0xe514d9deb7966c8be0ca922de8a064264ea6bcd4',        // wrapped native token
    ]
  );
  // Deploy stETH / ETH SimplePriceFeed
  

  return {
    ...deployed,
    bridgeReceiver,
    l2CCIPRouter,
    l2CCIPOffRamp,
    roninl2NativeBridge,
    bulker,
    COMP
    // WETH
  };
}
