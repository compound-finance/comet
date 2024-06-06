import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const USDT = await deploymentManager.existing('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7');
  const WBTC = await deploymentManager.existing('WBTC', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
  const WETH = await deploymentManager.existing('WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
  const COMP = await deploymentManager.existing('COMP', '0xc00e94Cb662C3520282E6f5717214004A7f26888');
  const LINK = await deploymentManager.existing('LINK', '0x514910771af9ca656af840dff83e8264ecf986ca');
  const UNI = await deploymentManager.existing('UNI', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984');
  const stETH = await deploymentManager.existing('stETH', '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84');
  const wstETH = await deploymentManager.existing('wstETH', '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0');

  // Deploy WstETHPriceFeed
  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/WstETHPriceFeed.sol',
    [
      '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8', // stETHtoUSDPriceFeed
      wstETH.address,                                // wstETH
      8                                             // decimals
    ]
  );

  // deploy scaling price feed for USDT
  const usdtScalingPriceFeed = await deploymentManager.deploy(
    'USDT:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D', // USDT / USD price feed
      8                                             // decimals
    ]
  );

  const wbtcScalingPriceFeed = await deploymentManager.deploy(
    'WBTC:priceFeed',
    'pricefeeds/WBTCPriceFeed.sol',
    [
      '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23', // WBTC / BTC price feed
      '0xdeb288F737066589598e9214E782fa5A8eD689e8', // BTC / USD price feed
      8                                             // decimals
    ]
  );

  const compScalingPriceFeed = await deploymentManager.deploy(
    'COMP:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5', // COMP / USD price feed
      8                                             // decimals
    ]
  );

  const wethScalingPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // WETH / USD price feed
      8                                             // decimals
    ]
  );

  const linkScalingPriceFeed = await deploymentManager.deploy(
    'LINK:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c', // LINK / USD price feed
      8                                             // decimals
    ]
  );

  const uniScalingPriceFeed = await deploymentManager.deploy(
    'UNI:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x553303d460EE0afB37EdFf9bE42922D8FF63220e', // UNI / USD price feed
      8                                             // decimals
    ]
  );
  const cometFactory = await deploymentManager.deploy('USDT:cometFactory', 'CometFactory.sol', [], true);

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'mainnet', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'mainnet', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'mainnet', 'usdc');


  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/MainnetBulker.sol',
    [
      await comet.governor(),  // admin_
      WETH.address,            // weth_
      wstETH.address           // wsteth_
    ]
  );
  return {
    ...deployed,
    bulker,
    rewards,
    COMP
  };
}