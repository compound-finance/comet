import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

// ONLY REDSTONE PROVIDER IS USED
const ETH_TO_USD_PRICE_FEED = '0xe8D9FbC10e00ecc9f0694617075fDAF657a76FB2';
const WBTC_TO_USD_PRICE_FEED = '0xc44be6D00307c3565FDf753e852Fc003036cBc13';
const wstETH_TO_ETH_MARKET_PRICE_FEED = '0x24c8964338Deb5204B096039147B8e8C3AEa42Cc';
const weETH_TO_ETH_EXCHANGE_RATE_PRICE_FEED = '0xBf3bA2b090188B40eF83145Be0e9F30C6ca63689';
const ezETH_TO_ETH_EXCHANGE_RATE_PRICE_FEED = '0xa0f2EF6ceC437a4e5F6127d6C51E1B0d3A746911';
const UNI_TO_USD_PRICE_FEED = '0xf1454949C6dEdfb500ae63Aa6c784Aa1Dde08A6c';

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  // Pull in existing assets
  const _WETH = await deploymentManager.existing(
    'WETH',
    '0x4200000000000000000000000000000000000006',
    'unichain'
  );
  const _weETH = await deploymentManager.existing(
    'weETH',
    '0x7DCC39B4d1C53CB31e1aBc0e358b43987FEF80f7',
    'unichain'
  );
  const _wstETH = await deploymentManager.existing(
    'wstETH',
    '0xc02fE7317D4eb8753a02c35fe019786854A92001',
    'unichain'
  );
  const _WBTC = await deploymentManager.existing(
    'WBTC',
    '0x927B51f251480a681271180DA4de28D44EC4AfB8',
    'unichain'
  );
  const _ezETH = await deploymentManager.existing(
    'ezETH',
    '0x2416092f143378750bb29b79eD961ab195CcEea5',
    'unichain'
  );
  const _UNI = await deploymentManager.existing(
    'UNI',
    '0x8f187aa05619a017077f5308904739877ce9ea21',
    'unichain'
  );
  const COMP = await deploymentManager.existing(
    'COMP',
    '0xdf78e4f0a8279942ca68046476919a90f2288656',
    'unichain'
  );

  const _wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ],
    true
  );

  const _wbtcPriceFeed = await deploymentManager.deploy(
    'WBTC:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      WBTC_TO_USD_PRICE_FEED, // WBTC / USD
      ETH_TO_USD_PRICE_FEED, // ETH / USD -> reverse USD / ETH
      8,
      'WBTC / ETH price feed'
    ]
  );

  const _ezEthExchangeRatePriceFeed = await deploymentManager.deploy(
    'ezETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      ezETH_TO_ETH_EXCHANGE_RATE_PRICE_FEED, // address
      8,                                     // decimals
    ]
  );

  const _weEthExchangeRatePriceFeed = await deploymentManager.deploy(
    'weETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      weETH_TO_ETH_EXCHANGE_RATE_PRICE_FEED, // address
      8,                                     // decimals
    ]
  );

  const _wstEthMarketRatePriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      wstETH_TO_ETH_MARKET_PRICE_FEED, // address
      8,                               // decimals
    ]
  );

  const _UNIPriceFeed = await deploymentManager.deploy(
    'UNI:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      UNI_TO_USD_PRICE_FEED, // UNI / USD price feed
      ETH_TO_USD_PRICE_FEED, // ETH / USD price feed (reversed)
      8,                     // decimals
      'UNI / ETH price feed' // description
    ],
    true
  );

  // Import shared contracts from cUSDCv3
  const l2CrossDomainMessenger = await deploymentManager.fromDep('l2CrossDomainMessenger', 'unichain', 'usdc');
  const l2StandardBridge = await deploymentManager.fromDep('l2StandardBridge', 'unichain', 'usdc');
  const TokenMinter = await deploymentManager.fromDep('TokenMinter', 'unichain', 'usdc');

  const _cometAdmin = await deploymentManager.fromDep('cometAdmin', 'unichain', 'usdc');
  const _assetListFactory = await deploymentManager.fromDep('assetListFactory', 'unichain', 'usdc');
  const _cometFactory = await deploymentManager.fromDep('cometFactory', 'unichain', 'usdc');
  const _$configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'unichain', 'usdc');
  const _configurator = await deploymentManager.fromDep('configurator', 'unichain', 'usdc');
  const _rewards = await deploymentManager.fromDep('rewards', 'unichain', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'unichain', 'usdc');
  const _localTimelock = await deploymentManager.fromDep('timelock', 'unichain', 'usdc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'unichain', 'usdc');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger,
    l2StandardBridge,
    bulker,
    COMP,
    TokenMinter
  };
}
