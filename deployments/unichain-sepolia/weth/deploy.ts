import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const SEPOLIA_TIMELOCK = '0x54a06047087927D9B0fb21c1cf0ebd792764dDB8';
const FAUCETEER = '0xd3A19CfC8b926f631C62d6D1213b51c27719Aa49';

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

  // Pull in existing assets
  const WETH = await deploymentManager.existing(
    'WETH',
    '0x4200000000000000000000000000000000000006',
    'unichain-sepolia'
  );
  const USDC = await deploymentManager.existing(
    'USDC',
    '0xb7A896348C193B2CC5FEDc79295DcEE999670Ee7',
    'unichain-sepolia'
  );
  const COMP = await deploymentManager.existing(
    'COMP',
    '0x1ffEae2b36604C3F7a2de19c531D050e9fE836FA',
    'unichain-sepolia'
  );

  const WETHConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,        // decimals
      exp(1, 8) // constantPrice
    ]
  );

  const USDCConstantPriceFeed = await deploymentManager.deploy(
    'USDC:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,              // decimals
      exp(0.00031, 8) // constantPrice
    ]
  );

  const COMPConstantPriceFeed = await deploymentManager.deploy(
    'COMP:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,        // decimals
      exp(0.02, 8) // constantPrice
    ]
  );

  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    [
      '0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007',
      '0x4200000000000000000000000000000000000007',
    ],
    'unichain-sepolia'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    [
      '0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010',
      '0x4200000000000000000000000000000000000010',
    ],
    'unichain-sepolia'
  );

  const fauceteer = await deploymentManager.existing(
    'fauceteer',
    FAUCETEER,
    'unichain-sepolia'
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
      30 * DAY,   // maxiumum delay
    ]
  );

  // Initialize OptimismBridgeReceiver
  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        SEPOLIA_TIMELOCK,     // govTimelock
        localTimelock.address // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;
  const signer = await deploymentManager.getSigner();

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
    fauceteer,
    l2CrossDomainMessenger,
    l2StandardBridge,
    bulker,
    COMP,
  };
}
