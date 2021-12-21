import { Constraint, Scenario, Solution, World } from '../plugins/scenario'
import { CometContext } from './CometContext'

export class BalanceConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    console.log('xxxx', requirements)
    const solutions = [];
    solutions.push(async (ctx: T, world: World) => ctx); // XXXX temp identity
    const assetsByActor = requirements['balance'];
    if (assetsByActor) {
      // XXX not meaningful right now, needs a strategy with the impl per block
      const actorsByAsset = Object.entries(assetsByActor)
        .reduce((a, [actor, assets]) => {
          return Object.entries(assets)
            .reduce((a, [asset, amount]) => {
              const v = a[asset] || {};
              a[asset] = { [actor]: amount, ...v };
              return a;
            }, a);
        }, {});
      solutions.push(async (ctx: T, world: World) => {
        for (const assetName in Object.keys(actorsByAsset)) {
          const asset = ctx.assets[assetName];
        }
        return ctx; // XXX
      });
    }
    return solutions;
  }

  async check(requirements: object, context: T, world: World) {
    return; // XXX
  }
}
