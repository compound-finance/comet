import { Constraint, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { IGovernorBravo } from '../../build/types';
import { fetchQuery } from '../utils';
import CometActor from '../context/CometActor';


function debug(...args: any[]) {
  console.log(`[ProposalConstraint]`, ...args);
}

// Fund voters account with eth for sending transactions
async function fundVoters(world: World, voters: string[], actor: CometActor) {
  const nativeTokenAmount = world.base.allocation ?? 1.0;
  for (let voter of voters) {
    await actor.sendEth(voter, nativeTokenAmount);
  }
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
    // Fund voters account with eth for sending transactions
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
    await fundVoters(world, voters, context.primaryActor());
    const pendingProposals = await getAllPendingProposals(world, governor.address, voters[0]);

    for (let proposal of pendingProposals) {
      solutions.push(async function (context: T): Promise<T> {
        try {
          // XXX if gov chain is not local chain, simulate bridge
          debug(`Processing pending proposal ${proposal.proposalId}`);
          const { proposalId, startBlock, endBlock } = proposal;
          const blockNow = await world.hre.ethers.provider.getBlockNumber();
          const blocksUntilStart = startBlock - blockNow;
          const blocksFromStartToEnd = endBlock - Math.max(startBlock, blockNow);
          if (blocksUntilStart > 0) {
            await context.mineBlocks(blocksUntilStart);
          }

          for (const voter of voters) {
            try {
              // Voting can fail if voter has already voted
              const voterSigner = await world.impersonateAddress(voter);
              const govAsVoter = await world.hre.ethers.getContractAt(
                'IGovernorBravo',
                governor.address,
                voterSigner
              ) as IGovernorBravo;
              await govAsVoter.castVote(proposalId, 1);
            } catch (err) {
              debug(`Error while voting ${err}`);
            }
          }
          await context.mineBlocks(blocksFromStartToEnd);

          const adminSigner = await world.impersonateAddress(voters[0]);
          const governorAsAdmin = await world.hre.ethers.getContractAt(
            'IGovernorBravo',
            governor.address,
            adminSigner
          ) as IGovernorBravo;

          // Queue proposal
          const queueTxn = await (await governorAsAdmin.queue(proposalId)).wait();
          const queueEvent = queueTxn.events?.find(event => event.event === 'ProposalQueued');
          await context.setNextBlockTimestamp(queueEvent?.args?.eta.toNumber());

          // Execute proposal
          await governorAsAdmin.execute(proposalId);

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