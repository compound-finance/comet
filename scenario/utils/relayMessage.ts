import { DeploymentManager } from '../../plugins/deployment_manager';
import relayPolygonMessage from './relayPolygonMessage';

export default async function relayMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const bridgeNetwork = bridgeDeploymentManager.network;
  switch (bridgeNetwork) {
    case 'mumbai':
    case 'polygon':
      await relayPolygonMessage(governanceDeploymentManager, bridgeDeploymentManager, startingBlockNumber);
      break;
    default:
      throw new Error(`No message relay implementation from ${bridgeNetwork} -> ${governanceDeploymentManager.network}`);
  }
}
