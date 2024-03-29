import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp } from '../../../src/deploy';

const SECONDS_PER_DAY = 24 * 60 * 60;

const SEPOLIA_TIMELOCK = '0x54a06047087927D9B0fb21c1cf0ebd792764dDB8';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;

  // Pull in existing assets
  const WETH = await deploymentManager.existing(
    'WETH',
    '0x4200000000000000000000000000000000000006',
    'base-sepolia'
  );

  const cbETH = await deploymentManager.existing(
    'cbETH',
    '0x774eD9EDB0C5202dF9A86183804b5D9E99dC6CA3',
    'base-sepolia',
    'contracts/ERC20.sol:ERC20'
  );

  const USDC = await deploymentManager.existing(
    'USDC',
    '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    'base-sepolia'
  );

  const COMP = await deploymentManager.existing(
    'COMP',
    '0x2f535da74048c0874400f0371Fba20DF983A56e2',
    'base-sepolia',
    'contracts/ERC20.sol:ERC20'
  );

  const l2CrossDomainMessenger = await deploymentManager.existing(
    'l2CrossDomainMessenger',
    ['0xC0d3c0d3c0D3c0D3C0d3C0D3C0D3c0d3c0d30007', '0x4200000000000000000000000000000000000007'],
    'base-sepolia'
  );

  const l2StandardBridge = await deploymentManager.existing(
    'l2StandardBridge',
    ['0xC0d3c0d3c0D3c0d3C0D3c0D3C0d3C0D3C0D30010', '0x4200000000000000000000000000000000000010'],
    'base-sepolia'
  );

  // Deploy constant price feed for USDC
  const usdcConstantPriceFeed = await deploymentManager.deploy(
    'USDC:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,        // decimals
      exp(1, 8) // constantPrice
    ]
  );

  // Deploy ETH / USD SimplePriceFeed
  const ethToUSDPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'test/SimplePriceFeed.sol',
    [
      exp(3477.28, 8), // Latest answer on mainnet at block 19463076
      8
    ]
  );

  const cbethToUSDPriceFeed = await deploymentManager.deploy(
    'cbETH:priceFeed',
    'test/SimplePriceFeed.sol',
    [
      exp(3477.28, 8), // Latest answer on mainnet at block 19463076
      8
    ]
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
      10 * 60,                // delay
      14 * SECONDS_PER_DAY,   // grace period
      10 * 60,                // minimum delay
      30 * SECONDS_PER_DAY    // maximum delay
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

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/BaseBulker.sol',
    [
      await comet.governor(), // admin
      WETH.address            // weth
    ]
  );

  // Deploy fauceteer
  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger,
    l2StandardBridge,
    bulker,
    fauceteer
  };
}
