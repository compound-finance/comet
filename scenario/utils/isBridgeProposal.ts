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
      const {
        governor,
        fxRoot,
        RootChainManager,
      } = await governanceDeploymentManager.getContracts();
      const bridgeAddresses = [fxRoot, RootChainManager].filter(x => x).map(x => x.address.toLowerCase());
      const { targets } = await governor.getActions(openProposal.id);
      return targets.some(t => bridgeAddresses.includes(t.toLowerCase()));
    }
    case 'optimism':
    case 'optimism-goerli': {
      const governor = await governanceDeploymentManager.getContractOrThrow('governor');
      const optimismL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow('optimismL1CrossDomainMessenger');
      const optimismL1StandardBridge = await governanceDeploymentManager.getContractOrThrow('optimismL1StandardBridge');
      const { targets } = await governor.getActions(openProposal.id);
      const bridgeContracts = [optimismL1CrossDomainMessenger.address, optimismL1StandardBridge.address];
      return targets.some(t => bridgeContracts.includes(t));
    }
    default: {
      const tag = `[${bridgeNetwork} -> ${governanceDeploymentManager.network}]`;
      throw new Error(`${tag} Unable to determine whether to relay Proposal ${openProposal.id}`);
    }
  }
}
