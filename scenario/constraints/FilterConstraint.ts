import { expect } from 'chai';
import { Constraint, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';

export class FilterConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T) {
    const filterFn = requirements.filter;
    if (!filterFn) {
      return null;
    }

    if (await filterFn(context)) {
      return null;
    } else {
      return []; // filter out this solution
    }
    // // XXX need to return either null, solution, or empty list of solution
    // // we want empty list, but ONLY if filter fails in solution run
    // return async function solution(ctx: T): Promise<T> {
    //   if (await filterFn(context)) {
    //     return null;
    //   } else {
    //     return []; // filter out this solution
    //   }
    // }
  }

  async check(requirements: R, context: T, world: World) {
    const filterFn = requirements.filter;
    if (!filterFn) {
      return;
    }

    expect(await filterFn(context)).to.be.equals(true);
  }
}
