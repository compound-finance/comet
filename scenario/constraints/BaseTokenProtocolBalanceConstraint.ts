import { Constraint, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';

export class BaseTokenProtocolBalanceConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    const baseTokenRequirements = requirements['baseToken'];
    if (!baseTokenRequirements) {
      return null;
    }
    if (typeof baseTokenRequirements['balance'] !== 'undefined') {
      return async (context: CometContext) => {
        const { comet, baseToken} = context;
        const amount = baseTokenRequirements['balance'];
        await baseToken.allocateTo(comet.address, amount);
      };
    }
  }

  async check(requirements: object, context: T, world: World) {
    const baseTokenRequirements = requirements['baseToken'];
    if (!baseTokenRequirements) {
      return null;
    }
    if (typeof baseTokenRequirements['balance'] !== 'undefined') {
      const amount = baseTokenRequirements['balance'];
      const { comet, baseToken} = context;

      expect(await baseToken.balanceOf(comet.address)).to.be.equals(amount);
    }
  }
}
