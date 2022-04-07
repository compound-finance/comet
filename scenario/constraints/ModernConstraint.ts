import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { ProtocolConfiguration, deployComet } from '../../src/deploy';
import { getFuzzedRequirements } from './Fuzzing';
import CometAsset from '../context/CometAsset';
import { Contract } from 'ethers';
import { Requirements } from './Requirements';

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
          console.log('Upgrading to modern...');
          // TODO: Make this deployment script less ridiculous, e.g. since it redeploys tokens right now
          let oldComet = await context.getComet();
          let timelock = await context.getTimelock();
          let cometConfig = { governor: timelock.address, ...config.cometConfig } // Use old timelock as governor
          let { comet: newComet } = await deployComet(
            context.deploymentManager,
            false,
            cometConfig
          );
          let initializer: string | undefined;
          if (!oldComet.totalsBasic || (await oldComet.totalsBasic()).lastAccrualTime === 0) {
            initializer = (await newComet.populateTransaction.initializeStorage()).data;
          }

          await context.upgradeTo(newComet, world, initializer);
          await context.setAssets();
          await context.spider();

          console.log('Upgraded to modern...');

          return context; // It's been modified
        });
      }
    }

    return solutions.length > 0 ? solutions : null;
  }

  async check(requirements: R, context: T, world: World) {
    return; // XXX
  }
}
