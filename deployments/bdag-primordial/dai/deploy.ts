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

  // Pull in existing assets from bdag-primordial network
  const DAI = await deploymentManager.existing('DAI', '0xC6F11e6124D8c4864951229652497c782EC17e38', 'bdag-primordial');
  const WETH = await deploymentManager.existing('WETH', '0x76b6383fB0bAeE78fF330Ae4E5674cF60798f651', 'bdag-primordial');
  const WBTC = await deploymentManager.existing('WBTC', '0xf24B549f81c9de7a99e5247Bc29328B4CAf44dF3', 'bdag-primordial');
  const LINK = await deploymentManager.existing('LINK', '0x9ff3e5E11BAec69594a14392791F4689f1d4c7f4', 'bdag-primordial');
  const UNI = await deploymentManager.existing('UNI', '0x2F6884Bd5AEb852b4557B72B63c62471183E3c2f', 'bdag-primordial');
  
  // Note: USDC needs to be deployed in bdag-primordial network first
  // For now, we'll add it as a placeholder that needs to be updated
  const USDC = await deploymentManager.existing('USDC', '0x0000000000000000000000000000000000000000', 'bdag-primordial');

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
