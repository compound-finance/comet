import { Constraint } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { ProtocolConfiguration } from '../../src/deploy';
import { getFuzzedRequirements } from './Fuzzing';
import { Requirements } from './Requirements';

interface ModernConfig {
  // Whether to upgrade or Comet config overrides to use for an upgrade
  upgrade: ProtocolConfiguration;
}

async function getModernConfigs(context: CometContext, requirements: Requirements): Promise<ModernConfig[]> {
  const currentConfig = await context.getConfiguration();
  const fuzzedConfigs = getFuzzedRequirements(requirements).map((r) => ({
    upgrade: r.upgrade && Object.assign({}, currentConfig, r.upgrade),
  }));
  return fuzzedConfigs;
}

export class ModernConstraint<T extends CometContext, R extends Requirements> implements Constraint<T, R> {
  async solve(requirements: R, context: T) {
    const configs = await getModernConfigs(context, requirements);
    const solutions = [];
    for (const config of configs) {
      if (config.upgrade) {
        solutions.push(async function solution(ctx: T): Promise<T> {
          return await ctx.upgrade(config.upgrade) as T; // It's been modified
        });
      }
    }
    return solutions.length > 0 ? solutions : null;
  }

  async check(_requirements: R, _context: T) {
    return; // XXX
  }
}
