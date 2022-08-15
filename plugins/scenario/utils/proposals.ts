
import { fetchQuery } from '../utils/fetchQuery';
import { IGovernorBravo } from '../../../build/types/IGovernorBravo';
import { World } from '../World';
import { network } from 'hardhat';

// TODO: can we import the enum from IGovernorBravo?
// States of proposals that need to be executed
const PENDING_PROPOSAL_STATE = 0;
const ACTIVE_PROPOSAL_STATE = 1;

type PendingProposal = { proposalId: number, startBlock: number, endBlock: number };

async function getGovernor(world: World): Promise<IGovernorBravo> {
  return world.deploymentManager.contract('governor');
}

export function getProposalCacheId(network): string {
  return `proposals_${network}`;
}

export async function getAllPendingProposals(world: World): Promise<PendingProposal[]> {
  const governor = await getGovernor(world);
  const votingDelay = (await governor.votingDelay()).toNumber();
  const votingPeriod = (await governor.votingPeriod()).toNumber();
  const block = await world.hre.ethers.provider.getBlockNumber();
  const filter = governor.filters.ProposalCreated();
  const { recentLogs } = await fetchQuery(
    governor,
    filter,
    block - (votingDelay + votingPeriod),
    block,
    block
  );

  const pendingProposals = [];
  if (recentLogs) {
    for (let log of recentLogs) {
      const [proposalId, , , , , , startBlock, endBlock] = log.args;
      const state = await governor.state(proposalId);
      // Save only pending proposals
      if (state == PENDING_PROPOSAL_STATE || state == ACTIVE_PROPOSAL_STATE) {
        pendingProposals.push({
          proposalId: proposalId.toNumber(),
          startBlock: startBlock.toNumber(),
          endBlock: endBlock.toNumber()
        });
      }
    }
  }

  return pendingProposals;
}