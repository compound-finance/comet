import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const wstETH = await deploymentManager.existing('wstETH', '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0');
  const weth = await deploymentManager.existing('weth', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
  const rsETHToETHPriceFeed = await deploymentManager.fromDep('rsETH:priceFeed', 'mainnet', 'weth');
  const wstETHToETHPriceFeed = await deploymentManager.fromDep('wstETH:priceFeed', 'mainnet', 'weth');
  const ezETHToETHPriceFeed = await deploymentManager.fromDep('ezETH:priceFeed', 'mainnet', 'weth');
  const weETHToETHPriceFeed = await deploymentManager.fromDep('weETH:priceFeed', 'mainnet', 'weth');

  // Deploy constant price feed for wstETH
  const wstETHConstantPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,          // decimals
      exp(1, 8)   // constantPrice
    ],
    true
  );

  // Deploy reverse multiplicative price feed for rsETH
  const rsETHScalingPriceFeed = await deploymentManager.deploy(
    'rsETH:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      rsETHToETHPriceFeed.address,  // rsETH / ETH price feed
      wstETHToETHPriceFeed.address, // wstETH / ETH price feed (reversed)
      8,                            // decimals
      'rsETH / wstETH price feed'   // description
    ],
    true
  );

  // Deploy reverse multiplicative price feed for ezETH
  const ezETHScalingPriceFeed = await deploymentManager.deploy(
    'ezETH:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      ezETHToETHPriceFeed.address,  // ezETH / ETH price feed
      wstETHToETHPriceFeed.address, // wstETH / ETH price feed (reversed)
      8,                            // decimals
      'ezETH / wstETH price feed'   // description
    ],
    true
  );

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdt');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'mainnet', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'mainnet', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'mainnet', 'usdc');

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/MainnetBulkerWithWstETHSupport.sol',
    [
      await comet.governor(),  // admin_
      weth.address,            // weth_
      wstETH.address           // wsteth_
    ],
    true
  );
  console.log('Bulker deployed at:', bulker.address);

  const bulkerNow = await deploymentManager.contract('bulker');
  console.log('Bulker now at:',  bulkerNow? bulkerNow.address: 'N/A');

  return { ...deployed, bulker };
}
