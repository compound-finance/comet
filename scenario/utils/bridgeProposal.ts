import { DeploymentManager } from '../../plugins/deployment_manager';
import { BridgedProposalState, OpenBridgedProposal } from '../context/Gov';
import { fetchLogs } from '../utils';
import { setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';

export async function getOpenBridgedProposals(
  deploymentManager: DeploymentManager,
): Promise<OpenBridgedProposal[]> {
  const receiver = await deploymentManager.contract('bridgeReceiver');
  if (receiver === undefined) return [];
  const timelockBuf = 500_000; // XXX using a high value because Arbitrum has fast block times
  const searchBlocks = timelockBuf;
  const block = await deploymentManager.hre.ethers.provider.getBlockNumber();
  const filter = receiver.filters.ProposalCreated();
  const logs = await fetchLogs(receiver, filter, block - searchBlocks, block);
  const proposals: OpenBridgedProposal[] = [];
  if (logs) {
    for (let log of logs) {
      if (log.args === undefined) continue;
      const [, id, , , , , eta] = log.args;
      const state = await receiver.state(id);
      if ([BridgedProposalState.Queued].includes(state)) {
        proposals.push({ id, eta });
      }
    }
  }
  return proposals;
}

export async function executeBridgedProposal(
  deploymentManager: DeploymentManager,
  proposal: OpenBridgedProposal,
) {
  const receiver = await deploymentManager.getContractOrThrow('bridgeReceiver');
  const { id, eta } = proposal;

  // fast forward l2 time
  await setNextBlockTimestamp(deploymentManager, eta.toNumber() + 1);

  // execute queued proposal
  await setNextBaseFeeToZero(deploymentManager);
  await receiver.executeProposal(id, { gasPrice: 0 });
}
