import { Constraint } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';
import { Requirements } from './Requirements';
import { ComparisonOp, parseAmount } from '../utils';

export class TargetReservesConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, _initialContext: T) {
    const targetReserves = requirements.targetReserves;
    if (targetReserves !== undefined) {
      const solutions = [];
      solutions.push(async function barelyMeet(context: T) {
        const amount = parseAmount(targetReserves);
        expect(amount.op).to.equal(ComparisonOp.GTE, `Operation ${amount.op} not supported (yet) by supply cap constraint`);
        await context.bumpTargetReserves(amount.val);
        return context;

      });
      return solutions;
    }
  }

  async check(requirements: R, context: T) {
    const targetReserves = requirements.targetReserves;
    if (targetReserves !== undefined) {
      const comet = await context.getComet();

      const baseScale = await comet.baseScale();

      const amount = parseAmount(targetReserves);
      const actualTargetReserves = await comet.targetReserves();
      const expectedTargetReserves = baseScale.mul(amount.val);

      switch (amount.op) {
        case ComparisonOp.EQ:
          expect(actualTargetReserves).to.equal(expectedTargetReserves);
          break;
        case ComparisonOp.GTE:
          expect(actualTargetReserves).to.be.at.least(expectedTargetReserves);
          break;
        case ComparisonOp.LTE:
          expect(actualTargetReserves).to.be.at.most(expectedTargetReserves);
          break;
        case ComparisonOp.GT:
          expect(actualTargetReserves).to.be.above(expectedTargetReserves);
          break;
        case ComparisonOp.LT:
          expect(actualTargetReserves).to.be.below(expectedTargetReserves);
          break;
      }
    }
  }
}