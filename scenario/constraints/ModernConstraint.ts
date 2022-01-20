import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { CometConfigurationOverrides, deployComet } from '../../src/deploy';
import { getFuzzedConfigs } from './Fuzzing';
import CometAsset from '../context/CometAsset';
import { Contract } from 'ethers';

interface ModernConfig {
  upgrade: boolean;
  cometConfigs: CometConfigurationOverrides[];
}

function getModernConfig(requirements: object): ModernConfig | null {
  let upgrade = requirements['upgrade'];
  let cometConfig = requirements['cometConfig'];

  let fuzzedCometConfigs = getFuzzedConfigs(cometConfig);

  return {
    upgrade: !!upgrade,
    cometConfigs: fuzzedCometConfigs,
  };
}

export class ModernConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    let { upgrade, cometConfigs } = getModernConfig(requirements);

    let solutions = [];
    if (upgrade) {
      console.log("Comet config overrides to upgrade with are: ", cometConfigs);
      for (let config of cometConfigs) {
        solutions.push(async function solution(context: T): Promise<T> {
          console.log("Upgrading to modern...");
          // TODO: Make this deployment script less ridiculous, e.g. since it redeploys tokens right now
          let { comet: newComet, tokens } = await deployComet(context.deploymentManager, false, config);
          let initializer: string | undefined = undefined;
          if (!context.comet.totalsBasic || (await context.comet.totalsBasic()).lastAccrualTime === 0) {
            initializer = (await newComet.populateTransaction.XXX_REMOVEME_XXX_initialize()).data
          }
    
          await context.upgradeTo(newComet, world, initializer);
          await context.setAssets();
  
          console.log("Upgraded to modern...");

          return context; // It's been modified
        });
      };
    } else {
      return null;
    }
    return solutions;
  }

  async check(requirements: object, context: T, world: World) {
    return; // XXX
  }
}
