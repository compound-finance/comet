import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const MAINNET_TIMELOCK = '0x6d903f6003cca6255d85cca4d3b5e5146dc33925';

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

  const signer = await deploymentManager.getSigner();
  // Pull in existing assets
  const WETH = await deploymentManager.existing(
    'WETH',
    '0x4200000000000000000000000000000000000006',
    'unichain'
  );
  const _USDC = await deploymentManager.existing(
    'USDC',
    '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
    'unichain'
  );
  const _UNI = await deploymentManager.existing(
    'UNI',
    '0x8f187aa05619a017077f5308904739877ce9ea21',
    'unichain'
  );
  const COMP = await deploymentManager.existing(
    'COMP',
    '0xdf78e4f0a8279942ca68046476919a90f2288656',
    'unichain'
  );

  const _WETHPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0xe8D9FbC10e00ecc9f0694617075fDAF657a76FB2', // oracle
      8,                                            // decimals
    ]
  );

  const _USDCPriceFeed = await deploymentManager.deploy(
    'USDC:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0xD15862FC3D5407A03B696548b6902D6464A69b8c', // oracle
      8,                                            // decimals
    ]
  );

  const _UNIPriceFeed = await deploymentManager.deploy(
    'UNI:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      '0xf1454949C6dEdfb500ae63Aa6c784Aa1Dde08A6c', // oracle
      8,                                            // decimals
    ]
  );

  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    [
      '0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007',
      '0x4200000000000000000000000000000000000007',
    ],
    'unichain'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    [
      '0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010',
      '0x4200000000000000000000000000000000000010',
    ],
    'unichain'
  );

  const TokenMinter = await deploymentManager.existing(
    'TokenMinter',
    '0x726bFEF3cBb3f8AF7d8CB141E78F86Ae43C34163',
    'unichain'
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
      1 * DAY,    // delay
      14 * DAY,   // grace period
      12 * HOUR,  // minimum delay
      30 * DAY,   // maximum delay
    ]
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
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);
  const { comet } = deployed;
  // const signer = await deploymentManager.getSigner();

  // Deploy Bulker
  // It won't be used, as we do not have MNT as a base and as a collateral 
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.connect(signer).governor(), // admin
      WETH.address,           // wrapped native token
    ]
  );

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger,
    l2StandardBridge,
    bulker,
    COMP,
    TokenMinter
  };
}
