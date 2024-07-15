import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;

  const WETH = await deploymentManager.existing(
    'WETH',
    '0x4200000000000000000000000000000000000006',
    'optimism'
  );
  const rETH = await deploymentManager.existing(
    'rETH',
    '0x9Bcef72be871e61ED4fBbc7630889beE758eb81D',
    'optimism'
  );
  const wstETH = await deploymentManager.existing(
    'wstETH',
    '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb',
    'optimism'
  );
  const WBTC = await deploymentManager.existing(
    'WBTC',
    '0x68f180fcCe6836688e9084f035309E29Bf0A2095',
    'optimism'
  );

  const COMP = await deploymentManager.existing(
    'COMP',
    '0x7e7d4467112689329f7E06571eD0E8CbAd4910eE',
    'optimism'
  );

  const wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  const rETHPriceFeed = await deploymentManager.deploy(
    'rETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x22F3727be377781d1579B7C9222382b21c9d1a8f', // rETH / ETH price feed
      8                                             // decimals
    ]
  );

  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      '0xe59EBa0D492cA53C6f46015EEa00517F2707dc77', // wstETH / stETH price feed
      '0x14d2d3a82AeD4019FddDfe07E8bdc485fb0d2249', // stETH / ETH price feed
      8,                                            // decimals
      'wstETH / ETH price feed'                     // description
    ]
  );

  const wbtcETHPriceFeed = await deploymentManager.deploy(
    'WBTC:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      '0x718A5788b89454aAE3A028AE9c111A29Be6c2a6F', // WBTC / USD price feed
      '0x13e3Ee699D1909E989722E753853AE30b17e08c5', // ETH / USD price feed (reversed)
      8,                                            // decimals
      'WBTC / ETH price feed'                       // description
    ]
  );

  // Import shared contracts from cUSDCv3 and cUSDTv3 deployments
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'optimism', 'usdc');
  // we use cometFactory from usdc deployment, because usdt deployment use the same one. 
  // the factory is not the latest version of comet (update for USDT on Mainnet)
  // for this market it works perfectly
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'optimism', 'usdc');
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
