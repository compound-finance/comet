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

function getMinValForBits(bits: number, isSigned: boolean = false): bigint {
  let min;
  if (isSigned) {
    min = 2n ** (BigInt(bits / 2)) * -1n;
  } else {
    min = 0n;
  }
  return min;
}

function getMaxValForBits(bits: number, isSigned: boolean = false): bigint {
  let max;
  if (isSigned) {
    max = 2n ** (BigInt(bits / 2)) - 1n;
  } else {
    max = 2n ** (BigInt(bits)) - 1n
  }
  return max;
}

function createCometConfigOverrides(keyValues: KV[]): CometConfigurationOverrides {
  let config: CometConfigurationOverrides = {};
  for (let kv of keyValues) {
    config[kv.key] = kv.value;
  }
  return config;
}

export function fuzzUint64(min = getMinValForBits(64), max = getMaxValForBits(64)): bigint[] {
  // TODO: Also generate a random bigint between min and max.
  return [min, max];
}

export function fuzzInt64(min = getMinValForBits(64, true), max = getMaxValForBits(64, true)): bigint[] {
  // TODO: Also generate a random bigint between min and max.
  return [min, max];
}

export function getFuzzedValues(fuzzConfig: FuzzConfig): any[] {
  switch (fuzzConfig.type) {
    case FuzzType.UINT64: {
      return fuzzUint64(fuzzConfig.min, fuzzConfig.max);
    }
    case FuzzType.INT64: {
      return fuzzInt64(fuzzConfig.min, fuzzConfig.max);
    }
    default:
      throw new Error(`Not a valid FuzzType: ${fuzzConfig.type}`);
  }
}

export function getFuzzedCometConfigs(cometConfig: CometConfigurationOverrides): CometConfigurationOverrides[] {
  let cometConfigs = [];
  let keyValues: KV[][] = [];
  // Create a list of fuzzed values for each key that needs to be fuzzed.
  for (let key in cometConfig) {
    let desiredValue = cometConfig[key];
    if (isFuzzConfig(desiredValue)) {
      let fuzzedValues = getFuzzedValues(desiredValue);
      keyValues.push(fuzzedValues.map(v => ({ key, value: v.toString() })));
    } else {
      keyValues.push([{ key, value: desiredValue }])
    }
  }

  // Create all combinations for the comet configuration.
  for (let combo of combos(keyValues)) {
    let config = createCometConfigOverrides(combo);
    cometConfigs.push(config);
  }

  return cometConfigs;
}
