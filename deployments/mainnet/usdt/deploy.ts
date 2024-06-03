import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { debug, DeploySpec, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const USDT = await deploymentManager.existing('USDT', '0xdAC17F958D2ee523a2206206994597C13D831ec7');
  const WBTC = await deploymentManager.existing('WBTC', '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599');
  const WETH = await deploymentManager.existing('WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
  const COMP = await deploymentManager.existing('COMP', '0xc00e94cb662c3520282e6f5717214004a7f26888');
  const LINK = await deploymentManager.existing('LINK', '0x514910771af9ca656af840dff83e8264ecf986ca');
  const UNI = await deploymentManager.existing('UNI', '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984');
  const stETH = await deploymentManager.existing('stETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0');
  const wstETH = await deploymentManager.existing('wstETH', '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0');

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'mainnet', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'mainnet', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'mainnet', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'mainnet', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'mainnet', 'usdc');

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/MainnetBulker.sol',
    [
      await comet.governor(),  // admin_
      await comet.baseToken(), // weth_
      wstETH.address           // wsteth_
    ]
  );
  
  return { ...deployed, bulker };
}
