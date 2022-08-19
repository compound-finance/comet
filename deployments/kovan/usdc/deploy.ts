import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const contracts = await deploymentManager.contracts();
  const timelock = contracts.get('timelock');
  const WETH = contracts.get('WETH');

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'Bulker.sol',
    [timelock.address, WETH.address]
  );

  return { bulker };
}