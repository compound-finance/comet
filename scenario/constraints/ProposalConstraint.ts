import { Constraint, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { IGovernorBravo } from '../../build/types';
import { fetchQuery } from '../../plugins/scenario/utils/TokenSourcer';
import CometActor from '../context/CometActor';

function* subsets<T>(array: T[], offset = 0): Generator<T[]> {
  while (offset < array.length) {
    let first = array[offset++];
    for (let subset of subsets(array, offset)) {
      subset.push(first);
      yield subset;
    }
  }
  yield [];
}

function debug(...args: any[]) {
  console.log(`[ProposalConstraint]`, ...args);
}

async function mineBlocks(world: World, blockNumber: number) {
  while (blockNumber > 0) {
    blockNumber--;
    await world.hre.network.provider.request({
      method: 'evm_mine',
      params: [],
    });
  }
}

async function setNextBlockTimestamp(world: World, timestamp: number) {
  await world.hre.ethers.provider.send('evm_setNextBlockTimestamp', [timestamp]);
}

// Fund voters account with eth for sending transactions
async function fundVoters(world: World, voters: string[], actor: CometActor) {
  const nativeTokenAmount = world.base.allocation ?? 1.0;
  await actor.sendEth(voters[0], nativeTokenAmount);
  await actor.sendEth(voters[1], nativeTokenAmount);
}

async function getAllPendingProposals(world: World, governor: string, admin: string) {
  const adminSigner = await world.impersonateAddress(admin);
  const governorAsAdmin = await world.hre.ethers.getContractAt(
    'IGovernorBravo',
    governor,
    // governor.address,
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

  const pendingProposals = [];
  if (recentLogs) {
    for (let log of recentLogs) {
      const [proposalId, , , , , , startBlock, endBlock] = log.args;
      const state = await governorAsAdmin.state(proposalId);
      // Not a pending proposal
      if (state == 0) {
        pendingProposals.push({ proposalId, startBlock, endBlock });
      }
    }
  }

  return pendingProposals;
}

export class ProposalConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    let solutions: Solution<T>[] = [];

    console.log("INSIDE PROPOSAL CONSTRAINT ====>>");

    const governor = await context.getGovernor();

    // Fund voters account with eth for sending transactions
    const voters = [
      '0xea6c3db2e7fca00ea9d7211a03e83f568fc13bf7',
      '0x61258f12c459984f32b83c86a6cc10aa339396de'
    ];
    await fundVoters(world, voters, context.primaryActor());
    const pendingProposals = await getAllPendingProposals(world, governor.address, voters[0]);

    for (let proposal of pendingProposals) {
      solutions.push(async function (context: T): Promise<T> {
        // XXX queue/execute each proposal in the list
        // XXX if gov chain is not local chain, simulate bridge
        const { proposalId, startBlock, endBlock } = proposal;
        /// XXX what if it's already started
        const blockNow = await world.hre.ethers.provider.getBlockNumber();
        const blocksUntilStart = startBlock - blockNow;
        const blocksFromStartToEnd = endBlock - Math.max(startBlock, blockNow);
        console.log("Block until start = ", blocksUntilStart);
        if (blocksUntilStart > 0) {
          await mineBlocks(world, blocksUntilStart);
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
        await mineBlocks(world, blocksFromStartToEnd);

        const adminSigner = await world.impersonateAddress(voters[0]);
        const governorAsAdmin = await world.hre.ethers.getContractAt(
          'IGovernorBravo',
          governor.address,
          adminSigner
        ) as IGovernorBravo;

        const queueTxn = await (await governorAsAdmin.queue(proposalId)).wait();
        const queueEvent = queueTxn.events.find(event => event.event === 'ProposalQueued');
        let [proposalId_, eta] = queueEvent.args;


        await setNextBlockTimestamp(world, eta.toNumber());
        await governorAsAdmin.execute(proposalId);

        debug(`XXX...`);
        return context;
      });
    }

    //return null; // XXX
    return solutions;
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}