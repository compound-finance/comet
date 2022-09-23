import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  // XXX both price feeds are stETH not wstETH or cbETH
  // XXX configuration params for assets are just placeholders

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Get a handle to the WETH contract for bulker
  const WETH = await deploymentManager.existing('WETH', await comet.baseToken());

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'Bulker.sol',
    [await comet.governor(), WETH.address]
  );

  return { ...deployed, bulker };
}
