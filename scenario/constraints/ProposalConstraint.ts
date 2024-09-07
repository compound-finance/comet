import { StaticConstraint, debug } from '../../plugins/scenario';
import { IGovernorBravo, ProposalState, OpenProposal } from '../context/Gov';
import { CometContext } from '../context/CometContext';
import { fetchLogs } from '../utils';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { isBridgedDeployment, executeOpenProposal, executeOpenProposalAndRelay } from '../utils';
import { getOpenBridgedProposals, executeBridgedProposal } from '../utils/bridgeProposal';

async function getOpenProposals(deploymentManager: DeploymentManager, governor: IGovernorBravo): Promise<OpenProposal[]> {
  const timelockBuf = 30000; // XXX this should be timelock.delay + timelock.GRACE_PERIOD
  const votingDelay = (await governor.votingDelay()).toNumber();
  const votingPeriod = (await governor.votingPeriod()).toNumber();
  const searchBlocks = votingDelay + votingPeriod + timelockBuf;
  const block = await deploymentManager.hre.ethers.provider.getBlockNumber();
  const filter = governor.filters.ProposalCreated();
  const logs = await fetchLogs(governor, filter, block - searchBlocks, block);
  const proposals: OpenProposal[] = [];
  if (logs) {
    for (let log of logs) {
      if (log.args === undefined) continue;
      const [id, , , , , , startBlock, endBlock] = log.args;
      const state = await governor.state(id);
      if ([
        ProposalState.Pending,
        ProposalState.Active,
        ProposalState.Succeeded,
        ProposalState.Queued,
      ].includes(state)) {
        proposals.push({ id, startBlock, endBlock });
      }
    }
  }
  return proposals;
}

export class ProposalConstraint<T extends CometContext> implements StaticConstraint<T> {
  async solve() {
    return async function (ctx: T): Promise<T> {
      const govDeploymentManager = ctx.world.auxiliaryDeploymentManager || ctx.world.deploymentManager;
      const isBridged = isBridgedDeployment(ctx);
      const label = isBridged ?
        `[${ctx.world.base.auxiliaryBase} -> ${ctx.world.base.name}] {ProposalConstraint}`
        : `[${ctx.world.base.name}] {ProposalConstraint}`;

      const deploymentManager = ctx.world.deploymentManager;
      if (isBridged) {
        for (const proposal of await getOpenBridgedProposals(deploymentManager)) {
          debug(`${label} Processing pending bridged proposal ${proposal.id}`);
          await executeBridgedProposal(deploymentManager, proposal);
        }
      }

      const governanceDeploymentManager = ctx.world.auxiliaryDeploymentManager || deploymentManager;
      const governor = await governanceDeploymentManager.contract('governor') as IGovernorBravo;
      const proposals = await getOpenProposals(governanceDeploymentManager, governor);
      for (const proposal of proposals) {
        const preExecutionBlockNumber = await ctx.world.deploymentManager.hre.ethers.provider.getBlockNumber();
        let migrationData;
        if (ctx.migrations !== undefined) {
          migrationData = ctx.migrations.find(
            migrationData => migrationData.lastProposal === proposal.id.toNumber()
          );
        }

        try {
          // Execute the proposal
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
        } catch (err) {
          debug(`${label} Failed to execute proposal ${proposal.id}`, err.message);
          throw err;
        }

        try {
          // If there is a migration associated with this proposal, verify the migration
          if (migrationData) {
            await migrationData.migration.actions.verify(
              ctx.world.deploymentManager,
              govDeploymentManager,
              preExecutionBlockNumber
            );
            migrationData.verified = true;
            debug(`${label} Verified migration "${migrationData.migration.name}"`);
          }
        } catch (err) {
          debug(`${label} Failed to verify migration "${migrationData.migration.name}"`, err.message);
          throw err;
        }
      }

      // Verify all unverified migrations (e.g. ones that are not tied to proposals)
      if (ctx.migrations) {
        for (const migrationData of ctx.migrations) {
          if (migrationData.verified === true || migrationData.skipVerify === true) continue;
          await migrationData.migration.actions.verify(
            ctx.world.deploymentManager,
            govDeploymentManager,
            migrationData.preMigrationBlockNumber
          );
          migrationData.verified = true;
        }
      }

      // Re-set the assets in case they were updated via a proposal
      await ctx.setAssets();

      return ctx;
    };
  }

  async check() {
    return; // XXX
  }
}
