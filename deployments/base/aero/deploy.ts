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
  // AERO 
  const aeroConstantPriceFeed = await deploymentManager.deploy(
    'AERO:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );
  // USDC
  // address priceFeedA_, address priceFeedB_, uint8 decimals_, string memory description_
  // USDC -> USD | USD -> AERO
  const usdcToAeroReversedPriceFeed = await deploymentManager.deploy(
    'USDC:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B', // USDC -> USD
      '0x4EC5970fC728C5f65ba413992CD5fF6FD70fcfF0', // AERO -> USD, Reversed USD -> AERO
      8,                                             // decimals
      'USDC / USD USD / AERO'
    ],
    true
  );
  // WETH
  const ethToAeroReversedPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', // ETH -> USD
      '0x4EC5970fC728C5f65ba413992CD5fF6FD70fcfF0', // AERO -> USD, Reversed USD -> AERO
      8,                                            // decimals
      'ETH / USD USD / AERO'
    ],
    true
  );
  // wstETH
  const wstETHToAeroReversedPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      '0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061', // wstETH -> stETH (exchange rate)
      ethToAeroReversedPriceFeed.address,           // ETH -> AERO
      8,                                            // decimals
      'wstETH / stETH ETH / USD USD / AERO'
    ],
    true
  );
  // cbBTC
  const cbBTCToAeroReversedPriceFeed = await deploymentManager.deploy(
    'cbBTC:priceFeed',
    'pricefeeds/ReverseMultiplicativePriceFeed.sol',
    [
      '0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D', // cbBTC -> USD
      '0x4EC5970fC728C5f65ba413992CD5fF6FD70fcfF0', // AERO -> USD, Reversed USD -> AERO
      8,                                            // decimals
      'cbBTC / USD USD / AERO'
    ],
    true
  );

  // Import shared contracts from cUSDbCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'base', 'usdbc');
  // new comet factory
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'base', 'usdbc');
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
