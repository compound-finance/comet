import { DeploymentManager } from '../../plugins/deployment_manager';
import { OpenProposal } from '../context/Gov';

export async function isBridgeProposal(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  openProposal: OpenProposal
) {
  const bridgeNetwork = bridgeDeploymentManager.network;
  switch (bridgeNetwork) {
    case 'mumbai':
    case 'polygon': {
      const governor = await governanceDeploymentManager.getContractOrThrow('governor');
      const fxRoot = await governanceDeploymentManager.getContractOrThrow('fxRoot');
      const { targets } = await governor.getActions(openProposal.id);
      return targets.map((x: string) => x.toLowerCase()).includes(fxRoot.address.toLowerCase());
    }
    default: {
      const tag = `[${bridgeNetwork} -> ${governanceDeploymentManager.network}]`;
      throw new Error(`${tag} Unable to determine whether to relay Proposal ${openProposal.id}`);
    }
  }
}
