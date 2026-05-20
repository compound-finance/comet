import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const USDC_USD_PRICE_FEED = '0x88f415c12d45d4C6DC018553BBE472A4558ff3f8';
const MAINNET_TIMELOCK = '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925';
const ETH_USD_PRICE_FEED = '0x662Fdb0E7D95d89CD3458E4A3506296E48BB1F44';
const RON_USD_PRICE_FEED = '0x0B6074F21488B95945989E513EFEA070096d931D';
const AXS_USD_PRICE_FEED = '0x81DfC7A054C8F60497e47579c5A5cEB37bc047e8';

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

  const bridgeReceiver = await deploymentManager.existing(
    'bridgeReceiver',
    '0x2c7EfA766338D33B9192dB1fB5D170Bdc03ef3F9',
    'ronin'
  );


  // const bridgeReceiver = await deploymentManager.deploy(
  //   'bridgeReceiver',
  //   'bridges/ronin/RoninBridgeReceiver.sol',
  //   [
  //     l2CCIPRouter.address, // l2CCIPRouter
  //   ]
  // );


  const WETH = await deploymentManager.existing(
    'WETH',
    '0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5',
    'ronin'
  );

  // const COMP = await deploymentManager.existing(
  //   'COMP',
  //   '',
  //   'ronin'
  // );

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
      await bridgeReceiver.connect(await deploymentManager.getSigner()).initialize(
        MAINNET_TIMELOCK,     // govTimelock
        localTimelock.address // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );



  // const WETHPriceFeed = await deploymentManager.deploy(
  //   'WETH:priceFeed',
  //   'pricefeeds/ConstantPriceFeed.sol',
  //   [
  //     8,
  //     exp(1, 8),
  //   ]
  // );

  const WETHPriceFeed = await deploymentManager.existing(
    'WETH:priceFeed',
    '0x8AC2b57d15c84755A3333aD68025d2496AE3BeBD',
    'ronin'
  );


  // const WRONMultiplicativePriceFeed = await deploymentManager.deploy(
  //   'WRON:priceFeed',
  //   'pricefeeds/ReverseMultiplicativePriceFeed.sol',
  //   [
  //     RON_USD_PRICE_FEED, // RON / USD price feed
  //     ETH_USD_PRICE_FEED, // ETH / USD
  //     8,                                            // decimals
  //     'RON/ETH price feed'                       // description
  //   ]
  // );

  const WRONMultiplicativePriceFeed = await deploymentManager.existing(
    'WRON:priceFeed',
    '0x692e4736f891CD940bA559d487845117e2c6b48D',
    'ronin'
  );

  // const AXSMultiplicativePriceFeed = await deploymentManager.deploy(
  //   'AXS:priceFeed',
  //   'pricefeeds/ReverseMultiplicativePriceFeed.sol',
  //   [
  //     AXS_USD_PRICE_FEED, // AXS / USD price feed
  //     ETH_USD_PRICE_FEED, // ETH / USD
  //     8,                                            // decimals
  //     'AXS/ETH price feed'                       // description
  //   ]
  // )

  const AXSMultiplicativePriceFeed = await deploymentManager.existing(
    'AXS:priceFeed',
    '0xB2237b8F0690f7F8c7D03FE70da62213714F8B5D',
    'ronin'
  );

  // const USDCMultiplicativePriceFeed = await deploymentManager.deploy(
  //   'USDC:priceFeed',
  //   'pricefeeds/ReverseMultiplicativePriceFeed.sol',
  //   [
  //     USDC_USD_PRICE_FEED, // USDC / USD price feed
  //     ETH_USD_PRICE_FEED, // ETH / USD
  //     8,                                            // decimals
  //     'USDC/ETH price feed'                       // description
  //   ]
  // );

  const USDCMultiplicativePriceFeed = await deploymentManager.existing(
    'USDC:priceFeed',
    '0xC41CdfAE648A76EF471160F62bf38a03Ad5B67DF',
    'ronin'
  );


  // const COMPPriceFeed = await deploymentManager.deploy(
  //   'COMP:priceFeed',);


  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);
  // Deploy Comet
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      '0xe514d9deb7966c8be0ca922de8a064264ea6bcd4',        // wrapped native token
    ]
  );


  return {
    ...deployed,
    bridgeReceiver,
    l2CCIPRouter,
    l2CCIPOffRamp,
    roninl2NativeBridge,
    bulker,
    // COMP
  };
}
