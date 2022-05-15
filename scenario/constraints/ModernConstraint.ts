import { Constraint, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { ProtocolConfiguration } from '../../src/deploy';
import { getFuzzedRequirements } from './Fuzzing';
import { Requirements } from './Requirements';
import { upgradeComet } from '../utils';

interface ModernConfig {
  upgrade: boolean;
  cometConfig: ProtocolConfiguration;
}

function getModernConfigs(requirements: Requirements): ModernConfig[] | null {
  let fuzzedConfigs = getFuzzedRequirements(requirements).map((r) => ({
    upgrade: r.upgrade,
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
      if (config.upgrade) {
        solutions.push(async function solution(context: T): Promise<T> {
          return await upgradeComet(world, context, config.cometConfig) as T; // It's been modified
        });
      }
    }

    return solutions.length > 0 ? solutions : null;
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}
