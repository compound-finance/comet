import { Constraint, World, debug } from '../../plugins/scenario';
import { IGovernorBravo, ProposalState, OpenProposal } from '../context/Gov';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { fetchLogs } from '../utils';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { isBridgedDeployment, executeOpenProposal, executeOpenProposalAndRelay } from '../utils';

async function getOpenProposals(deploymentManager: DeploymentManager, governor: IGovernorBravo): Promise<OpenProposal[]> {
  const timelockBuf = 30000; // XXX this should be timelock.delay + timelock.GRACE_PERIOD
  const votingDelay = (await governor.votingDelay()).toNumber();
  const votingPeriod = (await governor.votingPeriod()).toNumber();
  const searchBlocks = votingDelay + votingPeriod + timelockBuf;
  const block = await deploymentManager.hre.ethers.provider.getBlockNumber();
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
    return async function (ctx: T): Promise<T> {
      const isBridged = isBridgedDeployment(ctx);
      const label = isBridged ?
        `[${world.base.auxiliaryBase} -> ${world.base.name}] {ProposalConstraint}`
        : `[${world.base.name}] {ProposalConstraint}`;

      const governanceDeploymentManager = ctx.world.auxiliaryDeploymentManager || ctx.world.deploymentManager;
      const governor = await governanceDeploymentManager.contract('governor') as IGovernorBravo;
      const proposals = await getOpenProposals(governanceDeploymentManager, governor);

      for (const proposal of proposals) {
        try {
          debug(`${label} Processing pending proposal ${proposal.id}`);
          if (isBridged) {
            await executeOpenProposalAndRelay(
              governanceDeploymentManager,
              ctx.world.deploymentManager,
              proposal
            );
          } else {
            await executeOpenProposal(governanceDeploymentManager, proposal);
          }
          debug(`${label} Open proposal ${proposal.id} was executed`);
        } catch(err) {
          debug(`${label} Failed to execute proposal ${proposal.id}`, err.message);
          throw(err);
        }
      }
      return ctx;
    };
  }

  async check(_requirements: R, _context: T, _world: World) {
    return; // XXX
  }
}