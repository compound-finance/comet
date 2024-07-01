import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;

  // pull in existing assets
  // USDC native
  const WETH = await deploymentManager.existing('WETH', '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', 'arbitrum');
  const WBTC = await deploymentManager.existing('WBTC', '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', 'arbitrum');
  //wstETH
  const wstETH = await deploymentManager.existing('wstETH', '0x5979D7b546E38E414F7E9822514be443A4800529', 'arbitrum');
  const USDT = await deploymentManager.existing('USDT', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 'arbitrum');
  const ARB = await deploymentManager.existing('ARB', '0x912ce59144191c1204e64559fe8253a0e49e6548', 'arbitrum');
  const GMX = await deploymentManager.existing('GMX', '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a', 'arbitrum');
  const COMP = await deploymentManager.existing('COMP', '0x354A6dA3fcde098F8389cad84b0182725c6C91dE', 'arbitrum');

  // Deploy scaling price feed for cbETH
  const wstETHMultiplicativePriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      '0xb523AE262D20A936BC152e6023996e46FDC2A95D', // wstETH / ETH price feed
      '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612', // ETH / USD price feed
      8,                                            // decimals
      'wstETH/USD price feed'                       // description
    ]
  );

  // Import shared contracts from the USDC.e market
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'arbitrum', 'usdc.e');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'arbitrum', 'usdc.e');
  const configurator = await deploymentManager.fromDep('configurator', 'arbitrum', 'usdc.e');
  const rewards = await deploymentManager.fromDep('rewards', 'arbitrum', 'usdc.e');
  // should use this bulker, not MainnetBulker
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