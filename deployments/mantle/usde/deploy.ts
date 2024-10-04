import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';
const METH_TO_ETH_PRICE_FEED_ADDRESS = '0x9b2C948dbA5952A1f5Ab6fA16101c1392b8da1ab';
const ETH_TO_USD_PRICE_FEED_ADDRESS = '0xFc34806fbD673c21c1AEC26d69AA247F1e69a2C6';
 
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
  const trace = deploymentManager.tracer();

  const COMP = await deploymentManager.existing(
    'COMP',
    '0x52b7D8851d6CcBC6342ba0855Be65f7B82A3F17f',
    'mantle'
  );

  const methPriceFeed = await deploymentManager.deploy(
    'mETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      METH_TO_ETH_PRICE_FEED_ADDRESS,   // mETH / ETH price feed
      ETH_TO_USD_PRICE_FEED_ADDRESS,    // ETH / USD price feed
      8,                                // decimals
      'mETH / USD price feed'           // description
    ]
  );

  // Pull in existing assets
  const mETH = await deploymentManager.existing(
    'mETH',
    '0xcDA86A272531e8640cD7F1a92c01839911B90bb0',
    'mantle'
  );
  const WETH = await deploymentManager.existing(
    'WETH',
    '0xdEAddEaDdeadDEadDEADDEAddEADDEAddead1111',
    'mantle'
  );
  const WMANTLE = await deploymentManager.existing(
    'wMANTLE',
    '0x78c1b0C915c4FAA5FffA6CAbf0219DA63d7f4cb8',
    'mantle'
  );


  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    [
      '0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007',
      '0x4200000000000000000000000000000000000007',
    ],
    'mantle'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    [
      '0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010',
      '0x4200000000000000000000000000000000000010',
    ],
    'mantle'
  );

  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/optimism/OptimismBridgeReceiver.sol',
    [l2CrossDomainMessenger.address],
    true
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      1 * DAY,    // delay
      14 * DAY,   // grace period
      12 * HOUR,  // minimum delay
      30 * DAY,   // maxiumum delay
    ],
    true
  );

  // Initialize OptimismBridgeReceiver
  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        MAINNET_TIMELOCK,     // govTimelock
        localTimelock.address // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      WMANTLE.address,        // wrapped native token
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger, // TODO: don't have to part of roots. can be pulled via relations
    l2StandardBridge,
    bulker,
    COMP,
  };
}
