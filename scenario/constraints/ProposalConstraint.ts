import { Constraint, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { IGovernorBravo } from '../../build/types';
import { fetchQuery } from '../utils';


function debug(...args: any[]) {
  console.log(`[ProposalConstraint]`, ...args);
}

type PendingProposal = { proposalId: number, startBlock: number, endBlock: number };

async function getAllPendingProposals(world: World, governor: string, admin: string): Promise<PendingProposal[]> {
  const adminSigner = await world.impersonateAddress(admin);
  const governorAsAdmin = await world.hre.ethers.getContractAt(
    'IGovernorBravo',
    governor,
    adminSigner
  ) as IGovernorBravo;
  const votingDelay = (await governorAsAdmin.votingDelay()).toNumber();
  const votingPeriod = (await governorAsAdmin.votingPeriod()).toNumber();
  const block = await world.hre.ethers.provider.getBlockNumber();
  let filter = governorAsAdmin.filters.ProposalCreated();
  let { recentLogs } = await fetchQuery(
    governorAsAdmin,
    filter,
    block - (votingDelay + votingPeriod),
    block,
    block
  );

  const pendingProposals: PendingProposal[] = [];
  if (recentLogs) {
    for (let log of recentLogs) {
      const [proposalId, , , , , , startBlock, endBlock] = log.args;
      const state = await governorAsAdmin.state(proposalId);
      // Save only pending proposals
      if (state == 0) {
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
    let solutions: Solution<T>[] = [];

    // Only run migration for mainnet scenarios
    if (await world.chainId() != 1) {
      return null;
    }

    const governor = await context.getGovernor();
    // COMP biggest whales
    const voters = [
      '0xea6c3db2e7fca00ea9d7211a03e83f568fc13bf7',
      '0x61258f12c459984f32b83c86a6cc10aa339396de',
      '0x9aa835bc7b8ce13b9b0c9764a52fbf71ac62ccf1',
      '0x683a4f9915d6216f73d6df50151725036bd26c02',
      '0xa1b61405791170833070c0ea61ed28728a840241',
      '0x88fb3d509fc49b515bfeb04e23f53ba339563981',
      '0x8169522c2c57883e8ef80c498aab7820da539806'
    ];

    // XXX pull all pending proposals for the associated gov (chain)
    // produce all the subsets and queue/execute each batch of them
    // to form each solution
    const pendingProposals = await getAllPendingProposals(world, governor.address, voters[0]);

    for (let proposal of pendingProposals) {
      solutions.push(async function (context: T): Promise<T> {
        try {
          // XXX if gov chain is not local chain, simulate bridge
          debug(`Processing pending proposal ${proposal.proposalId}`);
          const { proposalId, startBlock, endBlock } = proposal;

          await context.executePendingProposal(proposalId, startBlock, endBlock, voters);

          debug(`Pending proposal ${proposalId} was executed`);
          return context;
        } catch (err) {
          debug(`Failed with error ${err}`);
          return context;
        }
      });
    }

    return solutions;
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}