import { Constraint, Scenario, Solution, World } from '../../plugins/scenario';
import { CometContext } from '../context/CometContext';
import { CometConfigurationOverrides, deployComet } from '../../src/deploy';
import CometAsset from '../context/CometAsset';
import { Contract } from 'ethers';

export enum FuzzType {
  INT64,
  UINT64
}

export interface FuzzConfig {
  type: FuzzType,
  min?: any,
  max?: any
}

export interface KV {
  key: string,
  value: string
}

interface ModernConfig {
  upgrade: boolean;
  cometConfigs: CometConfigurationOverrides[];
}

function* combos(choices: object[][]) {
  if (choices.length == 0) {
    yield [];
  } else {
    for (const option of choices[0])
      for (const combo of combos(choices.slice(1))) yield [option, ...combo];
  }
}

// TODO: Move fuzzing logic to its own file.
function getMinMaxForBits(bits: number, isSigned: boolean = false): [bigint, bigint] {
  let min;
  let max;
  if (isSigned) {
    min = 2n ** (BigInt(bits / 2)) * -1n;
    max = 2n ** (BigInt(bits / 2)) - 1n;
  } else {
    min = 0n;
    max = 2n ** (BigInt(bits)) - 1n
  }
  return [min, max];
}

function createConfig(keyValues: KV[]): CometConfigurationOverrides {
  let config: CometConfigurationOverrides = {};
  for (let kv of keyValues) {
    config[kv.key] = kv.value;
  }
  return config;
}

function getFuzzedConfigs(cometConfig: CometConfigurationOverrides): CometConfigurationOverrides[] {
  let cometConfigs = [];
  let keyValues: KV[][] = [];
  for (let key in cometConfig) {
    let desiredValue = cometConfig[key];
    console.log('checking key: ', key)
    console.log('value is ', desiredValue)
    console.log('type is ', typeof desiredValue)
    if (typeof desiredValue === 'object') {
      console.log('type of is OBJECT')
      // TODO: Check that this conforms Fuzz type
      if (desiredValue.type == FuzzType.UINT64) { // IS THIS A SAFE CHECK? NEED TO BE TYPESAFE
        console.log('IS A UINT64 FUZZTYPE');
        let [min, max] = getMinMaxForBits(64)
        if (desiredValue.min) {
          min = desiredValue.min;
        }
        if (desiredValue.max) {
          max = desiredValue.max;
        }
        // TODO: Also generate a random bigint between min and max.
        keyValues.push([{ key, value: min.toString() }, { key, value: max.toString() }]);
      }
    }
    else {
      keyValues.push([{ key, value: desiredValue }])
    }
  }

  for (let combo of combos(keyValues)) {
    console.log(combo)
    let configCombo = createConfig(combo);
    console.log(configCombo)
    cometConfigs.push(configCombo);
  }

  return cometConfigs;
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
      console.log('Comet configs to upgrade with are: ', cometConfigs);
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
