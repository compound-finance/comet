import { Constraint, World } from '../../plugins/scenario';
import { CometContext, getActors } from '../context/CometContext';
import { deployComet, ProtocolConfiguration } from '../../src/deploy';
import { getFuzzedRequirements } from './Fuzzing';
import { Requirements } from './Requirements';
import { upgradeComet } from '../utils';

interface ModernConfig {
  // Toggle true to upgrade Comet
  upgrade: boolean; // XXX maybe rename to upgrade Comet?
  // Toggle true to upgrade all contracts
  upgradeAll: boolean;
  // Comet config overrides to use for the new deployment
  cometConfig: ProtocolConfiguration;
}

function getModernConfigs(requirements: Requirements): ModernConfig[] | null {
  let fuzzedConfigs = getFuzzedRequirements(requirements).map((r) => ({
    upgrade: r.upgrade,
    upgradeAll: r.upgradeAll,
    cometConfig: r.cometConfig,
  }));

  return fuzzedConfigs;
}

export class ModernConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T, world: World) {
    let modernConfigs = getModernConfigs(requirements);

    let solutions = [];
    // XXX Inefficient log. Can be removed later
    console.log(
      'Comet config overrides to upgrade with are: ',
      modernConfigs.map((c) => c.cometConfig)
    );
    for (let config of modernConfigs) {
      if (config.upgradeAll) {
        solutions.push(async function solution(ctx: T): Promise<T> {
          const deploymentManager = ctx.deploymentManager;
          await deployComet(
            deploymentManager,
            { configurationOverrides: config.cometConfig },
          );
          await deploymentManager.spider();
          ctx.actors = await getActors(ctx, world);
          return ctx;
        });
      } else if (config.upgrade) {
        solutions.push(async function solution(ctx: T): Promise<T> {
          return await upgradeComet(world, ctx, config.cometConfig) as T; // It's been modified
        });
      }
    }

    return solutions.length > 0 ? solutions : null;
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}
