import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;

  const weETH = await deploymentManager.existing(
    'weETH',
    '0x01f0a31698C4d065659b9bdC21B3610292a1c506',
    'scroll'
  );
  const wrsETH = await deploymentManager.existing(
    'wrsETH',
    '0xa25b25548B4C98B0c7d3d27dcA5D5ca743d68b7F',
    'scroll'
  );
  const wstETH = await deploymentManager.existing(
    'wstETH',
    '0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32',
    'scroll'
  );
  const pufETH = await deploymentManager.existing(
    'PufETH',
    '0xc4d46E8402F476F269c379677C99F18E22Ea030e',
    'scroll'
  );

  const COMP = await deploymentManager.existing(
    'COMP',
    '0x643e160a3C3E2B7eae198f0beB1BfD2441450e86',
    'scroll'
  );

  const WETH = await deploymentManager.existing(
    'WETH',
    '0x5300000000000000000000000000000000000004',
    'scroll'
  );
  
  const l2Messenger = await deploymentManager.existing('l2Messenger','0x781e90f1c8Fc4611c9b7497C3B47F99Ef6969CbC','scroll');
  const l2ERC20Gateway = await deploymentManager.existing('l2ERC20Gateway','0xE2b4795039517653c5Ae8C2A9BFdd783b48f447A','scroll');
  const l2ETHGateway = await deploymentManager.existing('l2ETHGateway', '0x6EA73e05AdC79974B931123675ea8F78FfdacDF0', 'scroll');
  const l2WETHGateway = await deploymentManager.existing('l2WETHGateway','0x7003E7B7186f0E6601203b99F7B8DECBfA391cf9','scroll');
  const l2WstETHGateway = await deploymentManager.existing('l2WstETHGateway', '0x8aE8f22226B9d789A36AC81474e633f8bE2856c9', 'scroll');

  const wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  const weETHPriceFeed = await deploymentManager.deploy(
    'weETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x57bd9E614f542fB3d6FeF2B744f3B813f0cc1258', // weETH / ETH price feed
      8                                             // decimals
    ]
  );

  const wrsETHPriceFeed = await deploymentManager.deploy(
    'wrsETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x3a44916dc37Bb7D73419Fc6492d6d9Dfd8e6ddf7', // wrsETH / ETH price feed
      8                                             // decimals
    ]
  );

  const wstETHETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0xE61Da4C909F7d86797a0D06Db63c34f76c9bCBDC', // wstETH / ETH price feed
      8                                             // decimals
    ]
  );

  const pufETHPriceFeed = await deploymentManager.deploy(
    'PufETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x7C6Da2C92caCe9F77274379Dc32a1eEE0B4C5FfD', // pufETH / ETH price feed
      8                                             // decimals
    ]
  );
  // Import shared contracts from cUSDCv3 and cUSDTv3 deployments
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'scroll', 'usdc', true);
  // we use cometFactory from usdc deployment, because usdt deployment use the same one. 
  // the factory is not the latest version of comet (update for USDT on Mainnet)
  // for this market it works perfectly
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'scroll', 'usdc', true);
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'scroll', 'usdc', true);
  const configurator = await deploymentManager.fromDep('configurator', 'scroll', 'usdc', true);
  const rewards = await deploymentManager.fromDep('rewards', 'scroll', 'usdc', true);
  const bulker = await deploymentManager.fromDep('bulker', 'scroll', 'usdc', true);
  const localTimelock = await deploymentManager.fromDep('timelock', 'scroll', 'usdc', true);
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'scroll', 'usdc', true);

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  return {
    ...deployed,
    bridgeReceiver,
    l2Messenger,
    l2ERC20Gateway,
    l2ETHGateway,
    l2WETHGateway,
    l2WstETHGateway,
    bulker,
    rewards,
    COMP
  };
}
