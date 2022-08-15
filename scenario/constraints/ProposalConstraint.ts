import { Constraint, World, debug } from '../../plugins/scenario';
import { getAllPendingProposals, getProposalCacheId } from '../../plugins/scenario/utils/proposals';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';

type PendingProposal = { proposalId: number, startBlock: number, endBlock: number };

export class ProposalConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    const label = `[${world.base.name}] {ProposalConstraint}`;
    return async function (ctx: T): Promise<T> {
      const cacheId = getProposalCacheId(world.base.network);
      const proposals: PendingProposal[] = await world.deploymentManager.cache.readCache(cacheId);
      for (const proposal of proposals) {
        try {
          // XXX if gov chain is not local chain, simulate bridge
          debug(`${label} Processing pending proposal ${proposal.proposalId}`);
          const { proposalId, startBlock, endBlock } = proposal;
          await ctx.executePendingProposal(proposalId, startBlock, endBlock);
          debug(`${label} Pending proposal ${proposalId} was executed`);
          return ctx;
        } catch (err) {
          debug(`${label} Failed with error ${err}`);
          return ctx;
        }
      }
    };
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}