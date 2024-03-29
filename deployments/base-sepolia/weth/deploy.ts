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
  const trace = deploymentManager.tracer();

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
  // XXX There is no cbETH / ETH pricefeed on testnet. Remember to change this for mainnet.
  // const cbETHScalingPriceFeed = await deploymentManager.deploy(
  //   'cbETH:priceFeed',
  //   'ScalingPriceFeed.sol',
  //   [
  //     '0xcD2A119bD1F7DF95d706DE6F2057fDD45A0503E2', // cbETH / ETH price feed
  //     8                                             // decimals
  //   ]
  // );
  const cbETHConstantPriceFeed = await deploymentManager.deploy(
    'cbETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  const COMP = await deploymentManager.existing(
    'COMP',
    '0x2f535da74048c0874400f0371Fba20DF983A56e2',
    'base-sepolia',
    'contracts/ERC20.sol:ERC20'
  );

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'base-sepolia', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'base-sepolia', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'base-sepolia', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'base-sepolia', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'base-sepolia', 'usdc');
  const bulker = await deploymentManager.fromDep('bulker', 'base-sepolia', 'usdc');
  const fauceteer = await deploymentManager.fromDep('fauceteer', 'base-sepolia', 'usdc');
  const l2CrossDomainMessenger = await deploymentManager.fromDep('l2CrossDomainMessenger', 'base-sepolia', 'usdc');
  const l2StandardBridge = await deploymentManager.fromDep('l2StandardBridge', 'base-sepolia', 'usdc');
  const localTimelock = await deploymentManager.fromDep('timelock', 'base-sepolia', 'usdc');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'base-sepolia', 'usdc');

  // Deploy Comet
  const deployed = await deployComet(deploymentManager, deploySpec);

  // XXX We will need to deploy a new bulker only if need to support wstETH

  return {
    ...deployed,
    bridgeReceiver,
    l2CrossDomainMessenger,
    l2StandardBridge,
    bulker,
    fauceteer
  };
}
