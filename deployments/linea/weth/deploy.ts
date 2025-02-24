import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

const  L2MESSAGE_SERVICE_ADDRESS = '0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec';
const  L2STANDARD_BRIDGE_ADDRESS = '0x353012dc4a9A6cF55c941bADC267f82004A8ceB9';
const  L2USDC_BRIDGE_ADDRESS = '0xA2Ee6Fce4ACB62D95448729cDb781e3BEb62504A';

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

  const WETH = await deploymentManager.existing(
    'WETH',
    '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
    'linea'
  );

  const wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  // Pull in existing assets
  const ezETH = await deploymentManager.existing(
    'ezETH',
    '0x2416092f143378750bb29b79eD961ab195CcEea5',
    'linea'
  );
  
  const ezETHPriceFeed = await deploymentManager.deploy(
    'ezETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0xb71F79770BA599940F454c70e63d4DE0E8606731', // ezETH / ETH price feed
      8                                             // decimals
    ]
  );

  const wstETH = await deploymentManager.existing(
    'wstETH',
    '0xB5beDd42000b71FddE22D3eE8a79Bd49A568fC8F',
    'linea'
  );

  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x3C8A95F2264bB3b52156c766b738357008d87cB7', // wstETH / stETH (we consider stETH / ETH as 1:1) price feed
      8                                             // decimals
    ]
  );

  const WBTC = await deploymentManager.existing(
    'WBTC',
    '0x3aAB2285ddcDdaD8edf438C1bAB47e1a9D05a9b4',
    'linea'
  );

  const wbtcPriceFeed = await deploymentManager.deploy(
    'WBTC:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      '0x7A99092816C8BD5ec8ba229e3a6E6Da1E628E1F9', // WBTC / USD price feed
      '0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA', // USD / ETH price feed
      8,                                            // decimals
      'WBTC / ETH price feed'                       // description
    ]
  );

  const weETH = await deploymentManager.existing(
    'weETH',
    '0x1Bf74C010E6320bab11e2e5A532b5AC15e0b8aA6',
    'linea'
  );

  const weETHPriceFeed = await deploymentManager.deploy(
    'weETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x1FBc7d24654b10c71fd74d3730d9Df17836181EF', // weETH / eETH (we consider eETH / ETH as 1:1) price feed
      8                                             // decimals
    ]
  );

  const wrsETH = await deploymentManager.existing(
    'wrsETH',
    '0xD2671165570f41BBB3B0097893300b6EB6101E6C',
    'linea'
  );

  const wrsETHPriceFeed = await deploymentManager.deploy(
    'wrsETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      '0xEEDF0B095B5dfe75F3881Cb26c19DA209A27463a', // wrsETH / rsETH price feed
      '0x85342bC62aadef58f029ab6d17D643949e6F073e', // rsETH / ETH price feed
      8,                                            // decimals
      'wrsETH / ETH price feed'                     // description
    ]
  );
  
  const l2MessageService = await deploymentManager.existing(
    'l2MessageService',
    L2MESSAGE_SERVICE_ADDRESS,
    'linea'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    L2STANDARD_BRIDGE_ADDRESS,
    'linea'
  );

  const l2USDCBridge = await deploymentManager.existing(
    'l2USDCBridge',
    L2USDC_BRIDGE_ADDRESS,
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
