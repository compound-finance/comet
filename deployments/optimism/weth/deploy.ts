import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const WETH = await deploymentManager.existing('WETH', '0x4200000000000000000000000000000000000006', 'optimism');
  const rETH = await deploymentManager.existing('rETH', '0x9Bcef72be871e61ED4fBbc7630889beE758eb81D', 'optimism');
  const wstETH = await deploymentManager.existing('wstETH', '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb', 'optimism');
  const WBTC = await deploymentManager.existing('WBTC', '0x68f180fcCe6836688e9084f035309E29Bf0A2095', 'optimism');
  const COMP = await deploymentManager.existing('COMP', '0x7e7d4467112689329f7E06571eD0E8CbAd4910eE', 'optimism');

  // Deploy WstETHPriceFeed
  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x524299Ab0987a7c4B3c8022a35669DdcdC715a10', // wstETH / ETH price feed
      8                                             // decimals
    ]
  );

  // Deploy constant price feed for WETH
  const wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  // Deploy scaling price feed for rETH
  const rETHScalingPriceFeed = await deploymentManager.deploy(
    'rETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0xb429DE60943a8e6DeD356dca2F93Cd31201D9ed0', // rETH / ETH price feed
      8                                             // decimals
    ]
  );

  // Deploy scaling price feed for WBTC
  const WBTCReverseMultiplicativePriceFeed = await deploymentManager.deploy(
    'WBTC:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      '0x718A5788b89454aAE3A028AE9c111A29Be6c2a6F', // WBTC / USD price feed
      '0x13e3Ee699D1909E989722E753853AE30b17e08c5', // ETH / USD price feed
      8,                                            // decimals
      'WBTC / USD, USD / ETH'                       // description
    ]
  );

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'optimism', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'optimism', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'optimism', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'optimism', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'optimism', 'usdc');
  const localTimelock = await deploymentManager.fromDep('timelock', 'optimism', 'usdc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'optimism', 'usdc');


  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bridgeReceiver, 
    bulker,
    rewards,
    COMP
  };
}
