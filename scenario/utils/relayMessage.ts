import { DeploymentManager } from '../../plugins/deployment_manager';
import relayPolygonMessage from './relayPolygonMessage';
import relayOptimismMessage from './relayOptimismMessage';

export default async function relayMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager
) {
  const bridgeNetwork = bridgeDeploymentManager.network;
  switch (bridgeNetwork) {
    case 'optimism':
      await relayOptimismMessage(governanceDeploymentManager, bridgeDeploymentManager);
      break;
    case 'mumbai':
    case 'polygon':
      await relayPolygonMessage(governanceDeploymentManager, bridgeDeploymentManager);
      break;
    default:
      throw new Error(`No message relay implementation from ${bridgeNetwork} -> ${governanceDeploymentManager.network}`);
  }
}
