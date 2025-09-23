import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';
import { getExistingTokens, setupPriceFeeds } from '../helpers';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  // Set verification strategy to none to skip contract verification
  deploymentManager.setVerificationStrategy('none');

  // Load infrastructure contracts from the _infrastructure deployment
  const infrastructureSpider = await deploymentManager.spiderOther('bdag-primordial', '_infrastructure');
  
  // Add infrastructure contracts to the current deployment's contract map
  for (const [alias, contract] of infrastructureSpider.contracts) {
    await deploymentManager.putAlias(alias, contract);
  }

  // Get existing test tokens using helper function
  await getExistingTokens(deploymentManager);

  // Setup price feeds from configuration using helper function
  await setupPriceFeeds(deploymentManager);

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);

  return { 
    ...deployed
  };
}
