import { StaticConstraint } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { exp } from '../../test/helpers';

export class NativeTokenConstraint<T extends CometContext> implements StaticConstraint<T> {
  async solve() {
    return [
      async function (ctx: T): Promise<T> {
        for (const symbol in ctx.assets) {
          const contract = await ctx.world.deploymentManager.contract(symbol);
          if (contract && contract['deposit()']) {
            const [whale]= await ctx.getWhales();
            if (!whale) {
              throw new Error(`NativeTokenConstraint: no whale found for ${ctx.world.deploymentManager.network}`);
            }
            const amount = exp(200_000, await contract.decimals());
            // can make this more sophisticated as needed...
            await contract.deposit({ value: amount });
            await contract.transfer(whale, amount);
          }
        }
        return ctx;
      }
    ];
  }

  async check() {
    // ...
  }
}
