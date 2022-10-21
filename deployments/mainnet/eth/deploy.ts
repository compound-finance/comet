import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';
import { getConfiguration, NetworkConfiguration } from '../../../src/deploy/NetworkConfiguration';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  // Deploy WstETHPriceFeed
  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETHPriceFeed',
    'WstETHPriceFeed.sol',
    [
      '0xcfe54b5cd566ab89272946f602d76ea879cab4a8', // stETHtoUSDPriceFeed
      '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0'  // wstETH
    ]
  );

  const config = await deploymentManager.readConfig<NetworkConfiguration>();
  const wstETHaddress = config.assets.wstETH.address;

  let { assetConfigs } = await getConfiguration(deploymentManager);
  assetConfigs = (assetConfigs || []).map(ac => {
    return ac.asset === wstETHaddress ? { ...ac, ...{ priceFeed: wstETHPriceFeed.address } } : ac;
  });

  // Deploy all Comet-related contracts
  const deployed = await deployComet(
    deploymentManager,
    deploySpec,
    { assetConfigs }
  );
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'Bulker.sol',
    [await comet.governor(), await comet.baseToken()]
  );

  return { ...deployed, bulker };
}
