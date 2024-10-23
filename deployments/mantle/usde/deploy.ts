import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';
const USDE_TO_USD_PRICE_FEED_ADDRESS = '0xc49E06B50FCA57751155DA78803DCa691AfcDB22';
const METH_TO_ETH_PRICE_FEED_ADDRESS = '0xBeaa52edFeB12da4F026b38eD6203938a9936EDF';
const ETH_TO_USD_PRICE_FEED_ADDRESS = '0x61A31634B4Bb4B9C2556611f563Ed86cE2D4643B';
const FBTC_TO_USD_PRICE_FEED_ADDRESS = '0x7e19d187d7B3Be8dDEF2fD0A3b4df6Ed0b8E62ee';

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
  const USDe = await deploymentManager.existing(
    'USDe',
    '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
    'mantle'
  );
  const mETH = await deploymentManager.existing(
    'mETH',
    '0xcDA86A272531e8640cD7F1a92c01839911B90bb0',
    'mantle'
  );
  const WETH = await deploymentManager.existing(
    'WETH',
    '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111',
    'mantle'
  );
  const WMANTLE = await deploymentManager.existing(
    'WMNT',
    '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8',
    'mantle'
  );
  const FBTC = await deploymentManager.existing(
    'FBTC',
    '0xC96dE26018A54D51c097160568752c4E3BD6C364',
    'mantle'
  );

  // pre-deployed OptimismMintableERC20
  const COMP = await deploymentManager.existing(
    'COMP',
    '0x52b7D8851d6CcBC6342ba0855Be65f7B82A3F17f',
    'mantle'
  );

  const usdePriceFeed = await deploymentManager.deploy(
    'USDe:priceFeed',
    'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
    [
      USDE_TO_USD_PRICE_FEED_ADDRESS,   // USDe / USD price feed
      8,                                // decimals
      'USDe / USD price feed by API3'           // description
    ],
    true
  );

  const wethPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
    [
      ETH_TO_USD_PRICE_FEED_ADDRESS,   // ETH / USD price feed
      8,                               // decimals
      'WETH / USD price feed by API3'          // description
    ],
    true
  );

  const methPriceFeed = await deploymentManager.deploy(
    'mETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      METH_TO_ETH_PRICE_FEED_ADDRESS,   // mETH / ETH price feed
      ETH_TO_USD_PRICE_FEED_ADDRESS,    // ETH / USD price feed
      8,                                // decimals
      'mETH / USD price feed by API3'           // description
    ],
    true
  );

  const fbtcPriceFeed = await deploymentManager.deploy(
    'FBTC:priceFeed',
    'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
    [
      FBTC_TO_USD_PRICE_FEED_ADDRESS,   // FBTC / USD price feed
      8,                                // decimals
      'FBTC / USD price feed by API3'           // description
    ],
    true
  );

  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    [
      '0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007',
      '0x4200000000000000000000000000000000000007',
    ],
    'mantle'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    [
      '0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010',
      '0x4200000000000000000000000000000000000010',
    ],
    'mantle'
  );

  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/optimism/OptimismBridgeReceiver.sol',
    [l2CrossDomainMessenger.address]
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

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  // It won't be used, as we do not have MNT as a base and as a collateral 
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      WMANTLE.address,        // wrapped native token
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger,
    l2StandardBridge,
    bulker,
    COMP,
  };
}
