import { DeploymentManager } from '../../plugins/deployment_manager';
import relayPolygonMessage from './relayPolygonMessage';
import { relayArbitrumMessage, relayArbitrumCCTPMint } from './relayArbitrumMessage';
import relayBaseMessage from './relayBaseMessage';
import relayLineaMessage from './relayLineaMessage';
import relayOptimismMessage from './relayOptimismMessage';
import relayMantleMessage from './relayMantleMessage';
import { relayUnichainMessage, relayUnichainCCTPMint } from './relayUnichainMessage';
import relayScrollMessage from './relayScrollMessage';
import relayRoninMessage from './relayRoninMessage';

export default async function relayMessage(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  startingBlockNumber: number,
) {
  const bridgeNetwork = bridgeDeploymentManager.network;
  let proposal;
  switch (bridgeNetwork) {
    case 'base':
      return await relayBaseMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
    case 'optimism':
      return await relayOptimismMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
    case 'mantle':
      return await relayMantleMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
    case 'unichain':
      proposal = await relayUnichainMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
      await relayUnichainCCTPMint(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
      return proposal;
    case 'polygon':
      return await relayPolygonMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
    case 'arbitrum':
      proposal = await relayArbitrumMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
      await relayArbitrumCCTPMint(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
      return proposal;
    case 'linea':
      return await relayLineaMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
    case 'scroll':
      return await relayScrollMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
    case 'ronin':
      return await relayRoninMessage(
        governanceDeploymentManager,
        bridgeDeploymentManager,
        startingBlockNumber,
      );
    default:
      throw new Error(
        `No message relay implementation from ${bridgeNetwork} -> ${governanceDeploymentManager.network}`
      );
  }
}
