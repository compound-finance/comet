import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();

  // Pull in existing assets
  const USDbC = await deploymentManager.existing('USDbC', '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', 'base');
  const WETH = await deploymentManager.existing('WETH', '0x4200000000000000000000000000000000000006', 'base');
  const cbETH = await deploymentManager.existing('cbETH', '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', 'base');

  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    ['0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007', '0x4200000000000000000000000000000000000007'],
    'base'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    ['0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010', '0x4200000000000000000000000000000000000010'],
    'base'
  );

  // Deploy OptimismBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/optimism/OptimismBridgeReceiver.sol',
    [l2CrossDomainMessenger.address]
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      1 * DAY,                // delay
      14 * DAY,               // grace period
      12 * HOUR,              // minimum delay
      30 * DAY                // maxiumum delay
    ]
  );

  // Deploy multiplicative price feed for cbETH / USD
  const cbETHMultiplicativePriceFeed = await deploymentManager.deploy(
    'cbETH:priceFeed',
    'pricefeeds/MultiplicativePriceFeed.sol',
    [
      '0x806b4Ac04501c29769051e42783cF04dCE41440b', // cbETH / ETH price feed
      '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', // ETH / USD price feed
      8,                                            // decimals
      'cbETH / USD price feed'                      // description
    ]
  );

  // Initialize OptimismBridgeReceiver
  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        MAINNET_TIMELOCK,      // govTimelock
        localTimelock.address  // localTimelock
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
      WETH.address            // weth
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger, // TODO: don't have to part of roots. can be pulled via relations
    l2StandardBridge,
    bulker,
  };
}
