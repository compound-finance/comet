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

  const wbtcScalingPriceFeed = await deploymentManager.deploy(
    'WBTC:priceFeed',
    'pricefeeds/WBTCPriceFeed.sol',
    [
      '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23', // WBTC / BTC price feed
      '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', // BTC / USD price feed
      8                                             // decimals
    ]
  );

  // WETH Mainnet makret uses custom price feed wstETH / ETH (WstETHPriceFeed.sol)
  // We uses this already existing price feed on address https://etherscan.io/address/0x4F67e4d9BD67eFa28236013288737D39AeF48e79
  // As we have wstETH / ETH, we just need ETH / USD to receive wstETH / USD price feed
  const wstETHtoUsdPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      '0x4F67e4d9BD67eFa28236013288737D39AeF48e79', // stETH / ETH price feed
      '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419', // ETH / USD price feed
      8,
      "Custom price feed for wstETH / USD"
    ]
  );

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'mainnet', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'mainnet', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'mainnet', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'mainnet', 'weth');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bulker,
    rewards,
    COMP
  };
}