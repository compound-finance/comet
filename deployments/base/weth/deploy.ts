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
  // Deploy constant price feed for WETH
  const wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  // Deploy scaling price feed for cbETH
  const cbETHScalingPriceFeed = await deploymentManager.deploy(
    'cbETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0x806b4Ac04501c29769051e42783cF04dCE41440b', // cbETH / ETH price feed
      8                                             // decimals
    ]
  );

  // Import shared contracts from cUSDbCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'base', 'usdbc');
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
