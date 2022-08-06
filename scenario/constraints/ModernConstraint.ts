import { Constraint, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { deployComet, ProtocolConfiguration } from '../../src/deploy';
import { getFuzzedRequirements } from './Fuzzing';
import { Requirements } from './Requirements';

interface ModernConfig {
  // Toggle true to upgrade Comet
  upgrade: boolean; // XXX maybe rename to upgrade Comet?
  // Toggle true to upgrade all contracts
  upgradeAll: boolean;
  // Comet config overrides to use for the new deployment
  cometConfig: ProtocolConfiguration;
}

async function getModernConfigs(context: CometContext, requirements: Requirements): Promise<ModernConfig[]> {
  const oldConfig = await context.getConfiguration();
  const fuzzedConfigs = getFuzzedRequirements(requirements).map((r) => ({
    upgrade: r.upgrade,
    upgradeAll: r.upgradeAll,
    cometConfig: Object.assign({}, oldConfig, r.cometConfig),
  }));

  return fuzzedConfigs;
}

export class ModernConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T) {
    const modernConfigs = await getModernConfigs(context, requirements);
    const solutions = [];
    for (const config of modernConfigs) {
      if (config.upgradeAll) {
        solutions.push(async function solution(ctx: T): Promise<T> {
          const deploymentManager = ctx.deploymentManager;
          await deployComet(deploymentManager, { all: true }, config.cometConfig);
          await deploymentManager.spider();
          await ctx.setActors();
          return ctx;
        });
      } else if (config.upgrade) {
        solutions.push(async function solution(ctx: T): Promise<T> {
          return await ctx.upgrade(config.cometConfig) as T; // It's been modified
        });
      }
    }
    return solutions.length > 0 ? solutions : null;
  }

  async check(requirements: R, context: T) {
    return; // XXX
  }
}
