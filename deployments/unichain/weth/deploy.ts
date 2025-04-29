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
  const _USDC = await deploymentManager.existing(
    'USDC',
    '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
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

  const _USDCPriceFeed = await deploymentManager.deploy(
    'USDC:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      '0xD15862FC3D5407A03B696548b6902D6464A69b8c', // USDC / USD price feed
      ETH_TO_USD_PRICE_FEED,                        // ETH / USD price feed (reversed)
      8,                                            // decimals
      'WBTC / ETH price feed'                       // description
    ]
  );

  const _UNIPriceFeed = await deploymentManager.deploy(
    'UNI:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      '0xf1454949C6dEdfb500ae63Aa6c784Aa1Dde08A6c', // UNI / USD price feed
      ETH_TO_USD_PRICE_FEED,                        // ETH / USD price feed (reversed)
      8,                                            // decimals
      'WBTC / ETH price feed'                       // description
    ]
  );

  // const l2CrossDomainMessenger = await deploymentManager.existing(
  //   'l2CrossDomainMessenger',
  //   [
  //     '0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007',
  //     '0x4200000000000000000000000000000000000007',
  //   ],
  //   'unichain'
  // );

  // const l2StandardBridge = await deploymentManager.existing(
  //   'l2StandardBridge',
  //   [
  //     '0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010',
  //     '0x4200000000000000000000000000000000000010',
  //   ],
  //   'unichain'
  // );

  // const TokenMinter = await deploymentManager.existing(
  //   'TokenMinter',
  //   '0x726bFEF3cBb3f8AF7d8CB141E78F86Ae43C34163',
  //   'unichain'
  // );

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
