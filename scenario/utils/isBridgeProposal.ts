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
      const fxChild = await bridgeDeploymentManager.getContractOrThrow('fxChild');
      const { targets } = await governor.getActions(openProposal.id);
      return targets.includes(fxChild.address);
    }
    default: {
      const tag = `[${bridgeNetwork} -> ${governanceDeploymentManager.network}]`;
      throw new Error(`${tag} Unable to determine whether to relay Proposal ${openProposal.id}`);
    }
  }
}
