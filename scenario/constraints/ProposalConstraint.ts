import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';

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

export class ProposalConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    let solutions: Solution<T>[] = [];

    // XXX pull all pending proposals for the associated gov (chain)
    //  produce all the subsets and queue/execute each batch of them
    //   to form each solution
    let pendingProposals = [];

    for (let proposalList of subsets(pendingProposals)) {
      solutions.push(async function (context: T): Promise<T> {
        // XXX queue/execute each proposal in the list
        // XXX if gov chain is not local chain, simulate bridge
        debug(`XXX...`);
        return context;
      });
    }

    return null; // XXX
    return solutions;
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}
