import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  // Set verification strategy to none to skip contract verification
  deploymentManager.setVerificationStrategy('none');

  // Load infrastructure contracts from the _infrastructure deployment
  const infrastructureSpider = await deploymentManager.spiderOther('bdag-primordial', '_infrastructure');
  
  // Add infrastructure contracts to the current deployment's contract map
  for (const [alias, contract] of infrastructureSpider.contracts) {
    await deploymentManager.putAlias(alias, contract);
  }

  // Pull in existing assets from bdag-primordial network (using deployed addresses)
  const DAI = await deploymentManager.existing('DAI', '0xeF4555a8ee300250DeFa1f929FEfa2A3a9af628a', 'bdag-primordial');
  const WETH = await deploymentManager.existing('WETH', '0xf5aD60F3B4F86D1Ef076fB4e26b4A4FeDbE7a93b', 'bdag-primordial');
  const WBTC = await deploymentManager.existing('WBTC', '0x7c9Dfdc92A707937C4CfD1C21B3BBA5220D4f3A2', 'bdag-primordial');
  const LINK = await deploymentManager.existing('LINK', '0x4686A8C76a095584112AC3Fd0362Cb65f7C11b8B', 'bdag-primordial');
  const UNI = await deploymentManager.existing('UNI', '0xc1031Cfd04d0c68505B0Fc3dFdfC41DF391Cf6A6', 'bdag-primordial');
  const USDC = await deploymentManager.existing('USDC', '0x27E8e32f076e1B4cc45bdcA4dbA5D9D8505Bab43', 'bdag-primordial');

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);

  return { 
    ...deployed,
    DAI,
    WETH,
    WBTC,
    LINK,
    UNI,
    USDC
  };
}
