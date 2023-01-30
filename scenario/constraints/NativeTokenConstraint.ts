import { Constraint } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { Requirements } from './Requirements';
import { exp } from '../../test/helpers';

export class NativeTokenConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(_requirements: R, _context: T) {
    return [
      async function (ctx: T): Promise<T> {
        for (const symbol in ctx.assets) {
          const contract = await ctx.world.deploymentManager.contract(symbol);
          if (contract.deposit) {
            const whales = await ctx.getWhales();
            const amount = exp(200_000, await contract.decimals());
            // can make this more sophisticated as needed...
            await contract.deposit({ value: amount });
            await contract.transfer(whales[0], amount);
          }
        }
        return ctx;
      }
    ];
  }

  async check(_requirements: R, _context: T) {
    // ...
  }
}
