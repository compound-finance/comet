import { Constraint, Solution, World, debug } from '../../plugins/scenario';
import { IGovernorBravo, ProposalState, OpenProposal } from '../context/Gov';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { fetchLogs } from '../utils';

async function getOpenProposals(world: World, governor: IGovernorBravo): Promise<OpenProposal[]> {
  const timelockBuf = 30000; // XXX this should be timelock.delay + timelock.GRACE_PERIOD
  const votingDelay = (await governor.votingDelay()).toNumber();
  const votingPeriod = (await governor.votingPeriod()).toNumber();
  const searchBlocks = votingDelay + votingPeriod + timelockBuf;
  const block = await world.hre.ethers.provider.getBlockNumber();
  const filter = governor.filters.ProposalCreated();
  const logs = await fetchLogs(governor, filter, block - searchBlocks, block);
  const proposals = [];
  if (logs) {
    for (let log of logs) {
      const [id, , , , , , startBlock, endBlock] = log.args;
      const state = await governor.state(id);
      if ([ProposalState.Pending,
           ProposalState.Active,
           ProposalState.Succeeded,
           ProposalState.Queued].includes(state)) {
        proposals.push({ id, startBlock, endBlock });
      }
    }
  }
  return proposals;
}

export class ProposalConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    const label = `[${world.base.name}] {ProposalConstraint}`;
    return async function (ctx: T): Promise<T> {
      const governor = await ctx.getGovernor();
      const proposals = await getOpenProposals(ctx.world, governor);
      for (const proposal of proposals) {
        try {
          // XXX if gov chain is not local chain, simulate bridge
          debug(`${label} Processing pending proposal ${proposal.id}`);
          await ctx.executeOpenProposal(proposal);
          debug(`${label} Open proposal ${proposal.id} was executed`);
        } catch(err) {
          debug(`${label} Failed to execute proposal ${proposal.id}`, err.message);
          throw(err);
        }
      }
      return ctx;
    };
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}