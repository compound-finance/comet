import { Constraint, Solution } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';
import { Requirements } from './Requirements';
import { exp } from '../../test/helpers';
import { ComparisonOp, parseAmount, getToTransferAmount } from '../utils';

export class ReservesConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, _initialContext: T) {
    const reservesRequirement = requirements.reserves;
    if (reservesRequirement !== undefined) {
      const solutions: Solution<T>[] = [];
      solutions.push(async function barelyMeet(context: T) {
        const comet = await context.getComet();
        const baseToken = await comet.baseToken();
        const currentReserves = (await comet.getReserves()).toBigInt();
        const amount = parseAmount(reservesRequirement);
        const decimals = await comet.decimals();

        expect(amount.op).to.equal(ComparisonOp.GTE, `Operation ${amount.op} not supported (yet) by reserve cap constraint`);

        const amountToSource = getToTransferAmount(amount, currentReserves, decimals);
        // add buffer to adjust for interest accrual
        await context.sourceTokens(amountToSource * 105n / 100n, baseToken, comet.address);

        return context;
      });
      return solutions;
    } else {
      return null;
    }
  }

  async check(requirements: R, context: T) {
    const reservesRequirement = requirements.reserves;
    if (reservesRequirement !== undefined) {
      const comet = await context.getComet();
      const amount = parseAmount(reservesRequirement);
      const decimals = await comet.decimals();
      const currentReserves = (await comet.getReserves()).toBigInt();
      const expectedReserves = exp(amount.val, decimals);

      switch (amount.op) {
        case ComparisonOp.EQ:
          expect(currentReserves).to.equal(expectedReserves);
          break;
        case ComparisonOp.GTE:
          expect(currentReserves).to.be.at.least(expectedReserves);
          break;
        case ComparisonOp.LTE:
          expect(currentReserves).to.be.at.most(expectedReserves);
          break;
        case ComparisonOp.GT:
          expect(currentReserves).to.be.above(expectedReserves);
          break;
        case ComparisonOp.LT:
          expect(currentReserves).to.be.below(expectedReserves);
          break;
      }
    }
  }
}
