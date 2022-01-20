import { CometConfigurationOverrides } from '../../src/deploy';

export enum FuzzType {
  INT64,
  UINT64
}

export interface FuzzConfig {
  type: FuzzType,
  min?: any,
  max?: any
}

interface KV {
  key: string,
  value: string
}

function isFuzzConfig(object: unknown): object is FuzzConfig {
  return Object.prototype.hasOwnProperty.call(object, 'type');
}

function* combos(choices: object[][]) {
  if (choices.length == 0) {
    yield [];
  } else {
    for (const option of choices[0])
      for (const combo of combos(choices.slice(1))) yield [option, ...combo];
  }
}

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

function createCometConfigOverrides(keyValues: KV[]): CometConfigurationOverrides {
  let config: CometConfigurationOverrides = {};
  for (let kv of keyValues) {
    config[kv.key] = kv.value;
  }
  return config;
}

export function getFuzzedConfigs(cometConfig: CometConfigurationOverrides): CometConfigurationOverrides[] {
  let cometConfigs = [];
  let keyValues: KV[][] = [];
  for (let key in cometConfig) {
    let desiredValue = cometConfig[key];
    if (isFuzzConfig(desiredValue)) {
      switch (desiredValue.type) {
        case FuzzType.UINT64: {
          let [min, max] = getMinMaxForBits(64);
          if (desiredValue.min) {
            min = desiredValue.min;
          }
          if (desiredValue.max) {
            max = desiredValue.max;
          }
          // TODO: Also generate a random bigint between min and max.
          keyValues.push([{ key, value: min.toString() }, { key, value: max.toString() }]);
          break;
        }
        case FuzzType.INT64: {
          let [min, max] = getMinMaxForBits(64, true);
          if (desiredValue.min) {
            min = desiredValue.min;
          }
          if (desiredValue.max) {
            max = desiredValue.max;
          }
          // TODO: Also generate a random bigint between min and max.
          keyValues.push([{ key, value: min.toString() }, { key, value: max.toString() }]);
          break;
        }
        default:
          throw new Error(`Not a valid FuzzType: ${desiredValue.type}`);
      }
    }
    else {
      keyValues.push([{ key, value: desiredValue }])
    }
  }

  for (let combo of combos(keyValues)) {
    let config = createCometConfigOverrides(combo);
    cometConfigs.push(config);
  }

  return cometConfigs;
}
