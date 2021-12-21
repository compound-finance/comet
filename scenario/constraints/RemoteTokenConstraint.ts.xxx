import { Constraint, Scenario, Solution, World } from '../plugins/scenario'
import { CometContext } from './Context'

interface RemoteTokenConfig {
  network: string;
  address: string;
}

function requireString(o: object, key: string, err: string): string {
  let value: unknown = o[key];
  if (value === undefined) {
    throw new Error(err);
  }
  if (typeof(value) !== 'string') {
    throw new Error(err + ' [value required to be string type]');
  }
  return value;
}

function getRemoteTokenConfig(requirements: object): RemoteTokenConfig | null {
  let remoteToken = requirements.remote_token;
  if (!remoteToken) {
    return null;
  }
  return {
    network: requireString(remoteToken, 'network', 'network required in remote token config'),
    address: requireString(remoteToken, 'address', 'address required in remote token config'),
  };
}

export class RemoteTokenConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    let remoteTokenAddress = requirements
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
