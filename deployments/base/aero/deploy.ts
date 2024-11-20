import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const aero = await deploymentManager.existing(
    'AERO',
    '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    'base'
  );
  const weth = await deploymentManager.existing(
    'WETH',
    '0x4200000000000000000000000000000000000006',
    'base'
  );
  const usdc = await deploymentManager.existing(
    'USDC',
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    'base'
  );
  const wstETH = await deploymentManager.existing(
    'wstETH',
    '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
    'base'
  );
  const cbETH = await deploymentManager.existing(
    'cbETH',
    '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    'base'
  );
  // AERO 
  // AERO -> USD
  const aeroUsdPriceFeed = await deploymentManager.deploy(
    'AERO:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x4EC5970fC728C5f65ba413992CD5fF6FD70fcfF0',
      8
    ]
  );
  // USDC
  // USDC -> USD
  const usdcToUsdPriceFeed = await deploymentManager.deploy(
    'USDC:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B', // USDC -> USD
      8,
    ],
    true
  );
  // WETH
  // WETH -> USD
  const ethToUsdPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', // ETH -> USD
      8,                                            // decimals
    ],
    true
  );
  // wstETH
  // wstETH -> USD
  const wstETHToUsdPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      '0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061',
      '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
      8,                                            // decimals
      'wstETH / stETH ETH / USD'
    ],
    true
  );
  // cbBTC
  // cbBTC -> USD
  const cbBTCToUsdPriceFeed = await deploymentManager.deploy(
    'cbBTC:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D', // cbBTC -> USD
      8,                                            // decimals
    ],
    true
  );

  // Import shared contracts from cUSDbCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'base', 'usdbc');
  // new comet factory
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'base', 'usdbc');
  const configurator = await deploymentManager.fromDep('configurator', 'base', 'usdbc');
  const rewards = await deploymentManager.fromDep('rewards', 'base', 'usdbc');
  const bulker = await deploymentManager.fromDep('bulker', 'base', 'usdbc');
  const l2CrossDomainMessenger = await deploymentManager.fromDep('l2CrossDomainMessenger', 'base', 'usdbc');
  const l2StandardBridge = await deploymentManager.fromDep('l2StandardBridge', 'base', 'usdbc');
  const localTimelock = await deploymentManager.fromDep('timelock', 'base', 'usdbc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'base', 'usdbc');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  // XXX We will need to deploy a new bulker only if need to support wstETH

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger, // TODO: don't have to part of roots. can be pulled via relations
    l2StandardBridge,
    bulker
  };
}
