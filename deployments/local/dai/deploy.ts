import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  // Set verification strategy to none to skip contract verification
  deploymentManager.setVerificationStrategy('none');

  // Load infrastructure contracts from the _infrastructure deployment
  const infrastructureSpider = await deploymentManager.spiderOther('local', '_infrastructure');
  
  // Add infrastructure contracts to the current deployment's contract map
  for (const [alias, contract] of infrastructureSpider.contracts) {
    await deploymentManager.putAlias(alias, contract);
  }

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);

  // Mint rewards tokens to the rewards contract
  const { rewards } = deployed;
  const COMP = await deploymentManager.getContractOrThrow('COMP');
  const signer = await deploymentManager.getSigner();
  const trace = deploymentManager.tracer();

  await deploymentManager.idempotent(
    async () => (await COMP.balanceOf(rewards.address)).eq(0),
    async () => {
      trace(`Sending some COMP to CometRewards`);
      const amount = 1000000e8; // 1 million COMP tokens
      trace(await COMP.connect(signer).transfer(rewards.address, amount));
      trace(`COMP.balanceOf(${rewards.address}): ${await COMP.balanceOf(rewards.address)}`);
    }
  );

  return { ...deployed };
}
