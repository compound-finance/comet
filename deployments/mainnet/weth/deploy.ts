import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const stETH = await deploymentManager.existing('stETH', '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84');
  const wstETH = await deploymentManager.existing('wstETH', '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0');

  // Deploy WstETHPriceFeed
  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'WstETHPriceFeed.sol',
    [
      '0x86392dC19c0b719886221c78AB11eb8Cf5c52812', // stETHtoETHPriceFeed
      wstETH.address                                // wstETH
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
      wstETH.address           // wsteth_
    ]
  );

  return { ...deployed, bulker };
}
