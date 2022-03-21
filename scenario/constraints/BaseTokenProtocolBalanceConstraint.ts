import { Constraint, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { expect } from 'chai';
import { Requirements } from './Requirements';

export class BaseTokenProtocolBalanceConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    const baseTokenRequirements = requirements.baseToken;
    if (!baseTokenRequirements) {
      return null;
    }
    if (typeof baseTokenRequirements['balance'] !== 'undefined') {
      return async (context: CometContext) => {
        let comet = await context.getComet();
        const amount = baseTokenRequirements['balance'];
        const baseToken = context.getAssetByAddress(await comet.baseToken());

        await context.sourceTokens(world, amount, baseToken, comet.address);
      };
    }
  }

  async check(requirements: R, context: T, world: World) {
    const baseTokenRequirements = requirements.baseToken;
    if (!baseTokenRequirements) {
      return null;
    }
    if (typeof baseTokenRequirements['balance'] !== 'undefined') {
      const amount = baseTokenRequirements['balance'];
      let comet = await context.getComet();

      const baseToken = context.getAssetByAddress(await comet.baseToken());

      expect(await baseToken.balanceOf(comet.address)).to.equal(BigInt(amount));
    }
  }
}
