import { DeploymentManager } from '../../plugins/deployment_manager';
import relayPolygonMessage from './relayPolygonMessage';
import { relayArbitrumMessage, relayCCTPMint } from './relayArbitrumMessage';
import relayBaseMessage from './relayBaseMessage';
import relayLineaMessage from './relayLineaMessage';
import relayOptimismMessage from './relayOptimismMessage';
import relayMantleMessage from './relayMantleMessage';
import relayScrollMessage from './relayScrollMessage';
import relayRoninSaigonMessage from './relayRoninSaigonMessage';

export default async function relayMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number
) {
  const bridgeNetwork = bridgeDeploymentManager.network;
  switch (bridgeNetwork) {
    case 'base':
    case 'base-goerli':
      await relayBaseMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber
      );
      break;
    case 'optimism':
      await relayOptimismMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber
      );
      break;
    case 'mantle':
      await relayMantleMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber
      );
      break;
    case 'mumbai':
    case 'polygon':
      await relayPolygonMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber
      );
      break;
    case 'arbitrum':
    case 'arbitrum-goerli':
      await relayArbitrumMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber
      );
      await relayCCTPMint(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber
      );
      break;
    case 'linea-goerli':
      await relayLineaMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber
      );
      break;
    case 'scroll':
    case 'scroll-goerli':
      await relayScrollMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber
      );
      break;
    case 'ronin-saigon':
      await relayRoninSaigonMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber
      );
    default:
      throw new Error(
        `No message relay implementation from ${bridgeNetwork} -> ${governanceDeploymentManager.network}`
      );
  }
}
