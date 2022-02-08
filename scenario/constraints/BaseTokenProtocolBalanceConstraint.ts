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
        const { comet } = context;
        const amount = baseTokenRequirements['balance'];
        const baseToken = context.getAssetByAddress(await comet.baseToken());

        await context.sourceTokens(world, amount, baseToken, comet.address);
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
      const { comet } = context;

      const baseToken = context.getAssetByAddress(await comet.baseToken());

      expect(await baseToken.balanceOf(comet.address)).to.equal(BigInt(amount));
    }
  }
}
