import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

const stETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
const wstETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  // Deploy WstETHPriceFeed
  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'WstETHPriceFeed.sol',
    [
      '0xcfe54b5cd566ab89272946f602d76ea879cab4a8', // stETHtoUSDPriceFeed
      wstETH                                        // wstETH
    ]
  );

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
      stETH,                   // steth_
      wstETH                   // wsteth_
    ]
  );

  return { ...deployed, bulker };
}
