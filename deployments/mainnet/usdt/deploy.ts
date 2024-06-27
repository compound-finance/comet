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

  // Deploy WstETHPriceFeed
  /*
   This price feed can be used, although the contract mentions the stETH / ETH price feed,
    this does not affect the logic in any way since correct price feed (stETH / USD) is used
  */
  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/WstETHPriceFeed.sol',
    [
      '0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8', // stETHtoUSDPriceFeed
      wstETH.address,                               // wstETH
      8                                             // decimals
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