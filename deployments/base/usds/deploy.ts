import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  // Deploy constant price feed for WETH
  const _USDS = await deploymentManager.existing(
    'USDS',
    '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc',
    'base'
  );
  const _sUSDS = await deploymentManager.existing(
    'sUSDS',
    '0x5875eEE11Cf8398102FdAd704C9E96607675467a',
    'base'
  );

  const COMP = await deploymentManager.existing(
    'COMP',
    '0x9e1028F5F1D5eDE59748FFceE5532509976840E0',
    'base'
  );

  const l2USDSBridge = await deploymentManager.existing(
    'l2USDSBridge',
    '0xee44cdb68D618d58F75d9fe0818B640BD7B8A7B7',
    'base'
  );

  // Import shared contracts from cUSDbCv3
  const _cometAdmin = await deploymentManager.fromDep('cometAdmin', 'base', 'usdbc');
  const _cometFactory = await deploymentManager.fromDep('cometFactory', 'base', 'usdbc');
  const _$configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'base', 'usdbc');
  const _configurator = await deploymentManager.fromDep('configurator', 'base', 'usdbc');
  const _1rewards = await deploymentManager.fromDep('rewards', 'base', 'usdbc');
  const bulker = await deploymentManager.fromDep('bulker', 'base', 'usdbc');
  const l2CrossDomainMessenger = await deploymentManager.fromDep('l2CrossDomainMessenger', 'base', 'usdbc');
  const l2StandardBridge = await deploymentManager.fromDep('l2StandardBridge', 'base', 'usdbc');
  const _localTimelock = await deploymentManager.fromDep('timelock', 'base', 'usdbc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'base', 'usdbc');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);

  // XXX We will need to deploy a new bulker only if need to support wstETH

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger, // TODO: don't have to part of roots. can be pulled via relations
    l2StandardBridge,
    l2USDSBridge,
    bulker,
    COMP
  };
}
