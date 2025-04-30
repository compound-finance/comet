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

const ETH_TO_USD_PRICE_FEED = '0xe8D9FbC10e00ecc9f0694617075fDAF657a76FB2';

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
    ]
  );

  const _wbtcConstantPriceFeed = await deploymentManager.deploy(
    'WBTC:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(51.95, 8)                                  // constantPrice
    ]
  );

  const _ezEthConstantPriceFeed = await deploymentManager.deploy(
    'ezETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1.046, 8)                                  // constantPrice
    ]
  );

  const _weEthConstantPriceFeed = await deploymentManager.deploy(
    'weETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1.066, 8)                                  // constantPrice
    ]
  );

  const _wstethConstantPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1.199, 8)                                  // constantPrice
    ]
  );

  const _UNIPriceFeed = await deploymentManager.deploy(
    'UNI:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      '0xf1454949C6dEdfb500ae63Aa6c784Aa1Dde08A6c', // UNI / USD price feed
      ETH_TO_USD_PRICE_FEED,                        // ETH / USD price feed (reversed)
      8,                                            // decimals
      'UNI / ETH price feed'                        // description
    ]
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
