import { DeploymentManager } from '../../plugins/deployment_manager';
import { OpenProposal } from '../context/Gov';

export async function isBridgeProposal(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  openProposal: OpenProposal
) {
  const bridgeNetwork = bridgeDeploymentManager.network;
  switch (bridgeNetwork) {
    case 'arbitrum':
    case 'arbitrum-goerli': {
      const governor = await governanceDeploymentManager.getContractOrThrow('governor');
      const inbox = await governanceDeploymentManager.getContractOrThrow('arbitrumInbox');
      const l1GatewayRouter = await governanceDeploymentManager.getContractOrThrow('arbitrumL1GatewayRouter');
      const { targets } = await governor.getActions(openProposal.id);
      return targets.includes(inbox.address) || targets.includes(l1GatewayRouter.address);
    }
    case 'mumbai':
    case 'polygon': {
      const governor = await governanceDeploymentManager.getContractOrThrow('governor');
      const fxRoot = await governanceDeploymentManager.getContractOrThrow('fxRoot');
      const { targets } = await governor.getActions(openProposal.id);
      return targets.map((x: string) => x.toLowerCase()).includes(fxRoot.address.toLowerCase());
    }
    case 'optimism': {
      const governor = await governanceDeploymentManager.getContractOrThrow('governor');
      const optimismL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow('optimismL1CrossDomainMessenger');
      const { targets } = await governor.getActions(openProposal.id);
      return targets.includes(optimismL1CrossDomainMessenger.address);
    }
    default: {
      const tag = `[${bridgeNetwork} -> ${governanceDeploymentManager.network}]`;
      throw new Error(`${tag} Unable to determine whether to relay Proposal ${openProposal.id}`);
    }
  }
}
