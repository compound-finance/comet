import {Constraint, Scenario, Solution, World} from './Scenario'

export class CometActor {

}

export class CometAsset {

}

export class CometContext {
  actors: { [name: string]: CometActor};
  assets: { [name: string]: CometAsset};

  constructor(world: World) {
    // XXX wrap assets from world
    // XXX wrap actors from world
  }
}

export class BalanceConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    const solutions = [];
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
