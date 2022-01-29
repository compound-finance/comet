import { Contract, utils } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { DeploymentManagerConfig } from './type-extensions';
import { Address, Alias } from './Types';
import { Cache } from './Cache';

export type AliasFunction = (contract: Contract) => Promise<string>;
export type AliasTemplateString = string;
export type AliasTemplate = AliasTemplateString | AliasFunction;

export type FieldFunction = (c: Contract) => Promise<string | string[]>;
export interface FieldKey {
  key?: string;
  slot?: string;
  getter?: FieldFunction;
}

export interface RelationInnerConfig {
  alias?: AliasTemplate | AliasTemplate[];
  field?: string | FieldFunction | FieldKey;
}

export interface RelationConfig {
  proxy?: RelationInnerConfig;
  relations: { [alias: string]: RelationInnerConfig };
}

export type RelationConfigMap = { [alias: Alias]: RelationConfig };

// Read relation configuration
export function getRelationConfig(
  deploymentManagerConfig: DeploymentManagerConfig,
  deployment: string
): RelationConfigMap {
  let relRelationConfigMap = deploymentManagerConfig?.networks?.[deployment];
  if (relRelationConfigMap) {
    return relRelationConfigMap;
  }
  let baseRelationConfigMap = deploymentManagerConfig?.relationConfigMap;
  if (baseRelationConfigMap) {
    return baseRelationConfigMap;
  }
  throw new Error(
     `Must set \`relationConfigMap\` key of \`deploymentManager\` in Hardhat config to use spider.`
  );
}

export function getFieldKey(alias: Alias, config: RelationInnerConfig): FieldKey {
  if (typeof config.field === 'string') {
    return { key: config.field };
  } else if (typeof config.field === 'function') {
    return { getter: config.field };
  } else if (config.field) {
    return config.field;
  } else {
    return { key: alias };
  }
}

function asAddressArray(val: any, msg: string): string[] {
  if (typeof val === 'string') {
    return [val];
  } else if (Array.isArray(val)) {
    if (val.every((x) => typeof x === 'string')) {
      return val;
    } else {
      throw new Error(`Received invalid value in spider array calling ${msg}, expected all strings, got: ${JSON.stringify(val)}`);
    }
  } else {
    throw new Error(`Received invalid value in spider array calling ${msg}, expected string, got: ${JSON.stringify(val)}`);
  }
}

async function readKey(contract: Contract, fnName: string): Promise<any> {
  let fn = contract.callStatic[fnName];
  if (!fn) {
    throw new Error(`Cannot find contract function ${await contract.address}.${fnName}()`);
  }
  return await fn();
}

export async function readField(contract: Contract, fieldKey: FieldKey): Promise<Address[]> {
  if (fieldKey.slot) {
    // Read from slot
    let addressRaw = await contract.provider.getStorageAt(contract.address, fieldKey.slot);
    let address = utils.getAddress('0x' + addressRaw.substring(26));
    return [address];
  } else if (fieldKey.key) {
    let val = await readKey(contract, fieldKey.key);
    return asAddressArray(val, fieldKey.key);
  } else if (fieldKey.getter) {
    return asAddressArray(await fieldKey.getter(contract), "custom function");
  } else {
    throw new Error(`Unknown or invalid field key ${JSON.stringify(fieldKey)}`);
  }
}

export async function readAlias(
  contract: Contract,
  aliasTemplate: AliasTemplate
): Promise<Alias> {
  if (typeof aliasTemplate === 'string') {
    if (aliasTemplate.startsWith('.')) {
      return await readKey(contract, aliasTemplate.slice(1));
    } else {
      return aliasTemplate;
    }
  } else if (typeof aliasTemplate === 'function') {
    return await aliasTemplate(contract);
  } else {
    throw new Error(`Invalid alias template: ${JSON.stringify(aliasTemplate)}`);
  }
}

export function aliasTemplateFromAlias(alias: Alias): AliasTemplate {
  return alias;
}
