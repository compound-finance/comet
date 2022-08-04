import { Constraint, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { IGovernorBravo } from '../../build/types';
import { fetchQuery } from '../utils';

function debug(...args: any[]) {
  console.log(`[ProposalConstraint]`, ...args);
}

// TODO: can we import the enum from IGovernorBravo?
// States of proposals that need to be executed
const PENDING_PROPOSAL_STATE = 0;
const ACTIVE_PROPOSAL_STATE = 1;

type PendingProposal = { proposalId: number, startBlock: number, endBlock: number };

async function getAllPendingProposals(world: World, governor: IGovernorBravo): Promise<PendingProposal[]> {
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

export class ProposalConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    // Only run migration for mainnet scenarios
    // TODO: should we add to testnet or its too slow? would be supported now...
    if (await world.chainId() != 1) {
      return null;
    }

    return async function (ctx: T): Promise<T> {
      const governor = await ctx.getGovernor();
      const proposals = await getAllPendingProposals(ctx.world, governor);
      for (const proposal of proposals) {
        try {
          // XXX if gov chain is not local chain, simulate bridge
          debug(`Processing pending proposal ${proposal.proposalId}`);
          const { proposalId, startBlock, endBlock } = proposal;
          await ctx.executePendingProposal(proposalId, startBlock, endBlock);
          debug(`Pending proposal ${proposalId} was executed`);
          return ctx;
        } catch (err) {
          debug(`Failed with error ${err}`);
          return ctx;
        }
      }
    };
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}