import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

const SUSDS_TO_USDS_PRICE_FEED = '0x026a5B6114431d8F3eF2fA0E1B2EDdDccA9c540E';
const USDS_TO_USD_PRICE_FEED = '0x2330aaE3bca5F05169d5f4597964D44522F62930';

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {

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

  // Make to deploy 24 collaterals Comet version, as this proposal is pushed before 24 collaterals updated on Base
  deploySpec.cometMain = true;

  const _sUSDSPriceFeed = await deploymentManager.deploy(
    'sUSDS:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      SUSDS_TO_USDS_PRICE_FEED, // sUSDS / USDS price feed
      USDS_TO_USD_PRICE_FEED,   // USDS / USD price feed
      8,                        // decimals
      'sUSDS / USD price feed'  // description
    ]
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
  // We do not import cometFactory, because we will deploy the new one with 24 collaterals
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'base', 'usdbc');
  const _cometAdmin = await deploymentManager.fromDep('cometAdmin', 'base', 'usdbc');
  const _configurator = await deploymentManager.fromDep('configurator', 'base', 'usdbc');
  const _rewards = await deploymentManager.fromDep('rewards', 'base', 'usdbc');
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
    cometFactory,
    bridgeReceiver,
    l2CrossDomainMessenger, // TODO: don't have to part of roots. can be pulled via relations
    l2StandardBridge,
    l2USDSBridge,
    bulker,
    COMP
  };
}
