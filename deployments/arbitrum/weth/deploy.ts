import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const WETH = await deploymentManager.existing('WETH', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'arbitrum');
  const rETH = await deploymentManager.existing('rETH', '0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8', 'arbitrum');
  const wstETH = await deploymentManager.existing('wstETH', '0x5979D7b546E38E414F7E9822514be443A4800529', 'arbitrum');
  const COMP = await deploymentManager.existing('COMP', '0x354A6dA3fcde098F8389cad84b0182725c6C91dE', 'arbitrum');

  // Deploy WstETHPriceFeed
  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0xb523AE262D20A936BC152e6023996e46FDC2A95D', // wstETH / ETH price feed
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
      '0xD6aB2298946840262FcC278fF31516D39fF611eF', // rETH / ETH price feed
      8                                             // decimals
    ]
  );

  // Deploy scaling price feed for weETH
  const weETHScalingPriceFeed = await deploymentManager.deploy(
    'weETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0xE141425bc1594b8039De6390db1cDaf4397EA22b', // weETH / ETH price feed
      8                                             // decimals
    ]
  );

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'arbitrum', 'usdc.e');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'arbitrum', 'usdc.e');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'arbitrum', 'usdc.e');
  const configurator = await deploymentManager.fromDep('configurator', 'arbitrum', 'usdc.e');
  const rewards = await deploymentManager.fromDep('rewards', 'arbitrum', 'usdc.e');
  const bulker = await deploymentManager.fromDep('bulker', 'arbitrum', 'usdc.e');
  const localTimelock = await deploymentManager.fromDep('timelock', 'arbitrum', 'usdc.e');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'arbitrum', 'usdc.e');


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