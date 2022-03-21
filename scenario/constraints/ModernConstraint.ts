import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { ProtocolConfiguration, deployComet } from '../../src/deploy';
import { getFuzzedRequirements } from './Fuzzing';
import CometAsset from '../context/CometAsset';
import { Contract } from 'ethers';

interface ModernConfig {
  upgrade: boolean;
  cometConfig: ProtocolConfiguration;
}

function getModernConfigs(requirements: object): ModernConfig[] | null {
  let fuzzedConfigs = getFuzzedRequirements(requirements).map((r) => ({
    upgrade: r['upgrade'],
    cometConfig: r['cometConfig'],
  }));

  return fuzzedConfigs;
}

export async function upgradeComet(context: CometContext, world: World, cometConfig: ProtocolConfiguration) {
  console.log('Upgrading comet to modern...');

  let { comet: newComet, configurationStruct } = await deployComet(
    context.deploymentManager,
    false,
    cometConfig
  );

  const data = (await newComet.populateTransaction.initializeStorage(configurationStruct)).data;

  await context.upgradeTo(newComet, world, data);
  await context.setAssets();
  await context.spider();

  console.log('Upgraded to modern...');
}

export class ModernConstraint<T extends CometContext> implements Constraint<T> {
  async solve(requirements: object, context: T, world: World) {
    let modernConfigs = getModernConfigs(requirements);

    let solutions = [];
    // XXX Inefficient log. Can be removed later
    console.log(
      'Comet config overrides to upgrade with are: ',
      modernConfigs.map((c) => c['cometConfig'])
    );
    for (let config of modernConfigs) {
      if (config.upgrade) {
        solutions.push(async function solution(context: T): Promise<T> {
          await upgradeComet(context, world, config.cometConfig);
          return context; // It's been modified
        });
      }
    }

    return solutions.length > 0 ? solutions : null;
  }

  async check(requirements: object, context: T, world: World) {
    return; // XXX
  }
}
