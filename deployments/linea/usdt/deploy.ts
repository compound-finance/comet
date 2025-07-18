import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const WSTETH_TO_STETH_PRICE_FEED = '0x3C8A95F2264bB3b52156c766b738357008d87cB7';
const ETH_TO_USD_PRICE_FEED = '0x3c6Cd9Cc7c7a4c2Cf5a82734CD249D7D593354dA';

const L2MESSAGE_SERVICE_ADDRESS = '0x508Ca82Df566dCD1B0DE8296e70a96332cD644ec';
const L2STANDARD_BRIDGE_ADDRESS = '0x353012dc4a9A6cF55c941bADC267f82004A8ceB9';
const L2USDC_BRIDGE_ADDRESS = '0xA2Ee6Fce4ACB62D95448729cDb781e3BEb62504A';

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  // Pull in existing assets
  const _USDT = await deploymentManager.existing(
    'USDT',
    '0xA219439258ca9da29E9Cc4cE5596924745e12B93',
    'linea'
  );
  const _WETH = await deploymentManager.existing(
    'WETH',
    '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
    'linea'
  );
  const _WBTC = await deploymentManager.existing(
    'WBTC',
    '0x3aAB2285ddcDdaD8edf438C1bAB47e1a9D05a9b4',
    'linea'
  );

  const _wstETH = await deploymentManager.existing(
    'wstETH',
    '0xB5beDd42000b71FddE22D3eE8a79Bd49A568fC8F',
    'linea'
  );

  const _wstETHtoUsdPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      WSTETH_TO_STETH_PRICE_FEED, // wstETH / stETH price feed
      ETH_TO_USD_PRICE_FEED,      // ETH / USD price feed (we consider stETH / ETH as 1:1)
      8,                          // decimals
      'wstETH / USD price feed'   // description
    ]
  );
  
  const l2MessageService = await deploymentManager.existing(
    'l2MessageService',
    L2MESSAGE_SERVICE_ADDRESS,
    'linea'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    L2STANDARD_BRIDGE_ADDRESS,
    'linea'
  );

  const l2USDCBridge = await deploymentManager.existing(
    'l2USDCBridge',
    L2USDC_BRIDGE_ADDRESS,
    'linea'
  );

  // Import shared contracts from cUSDCv3
  const _cometAdmin = await deploymentManager.fromDep('cometAdmin', 'linea', 'usdc');
  const _assetListFactory = await deploymentManager.fromDep('assetListFactory', 'linea', 'usdc');
  const _cometFactory = await deploymentManager.fromDep('cometFactory', 'linea', 'usdc');
  const _$configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'linea', 'usdc');
  const _configurator = await deploymentManager.fromDep('configurator', 'linea', 'usdc');
  const _rewards = await deploymentManager.fromDep('rewards', 'linea', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'linea', 'usdc');
  const _localTimelock = await deploymentManager.fromDep('timelock', 'linea', 'usdc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'linea', 'usdc');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);

  return {
    ...deployed,
    bridgeReceiver,
    l2MessageService,
    l2StandardBridge,
    l2USDCBridge,
    bulker,
  };
}
