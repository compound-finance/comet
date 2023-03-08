import { Constraint } from '../../plugins/scenario';
import { Solution } from '../../plugins/scenario/Scenario';
import { CometContext } from '../context/CometContext';
import { getFuzzedRequirements } from './Fuzzing';
import { Requirements } from './Requirements';

export class ModernConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, _context: T) {
    const fuzzed = await getFuzzedRequirements(requirements);
    const solutions: Solution<T>[] = [];
    for (const req of fuzzed) {
      if (req.upgrade) {
        solutions.push(async function solution(ctx: T): Promise<T> {
          const current = await ctx.getConfiguration();
          const upgrade = Object.assign({}, current, req.upgrade);
          return await ctx.upgrade(upgrade) as T; // It's been modified
        });
      }
    }
    return solutions.length > 0 ? solutions : null;
  }

  async check(_requirements: R, _context: T) {
    return; // XXX
  }
}
