import { Contract, utils } from 'ethers';
import { DeploymentManagerConfig } from './type-extensions';
import { Address, Alias } from './Types';

export type Ctx = { [aliasTemplate: string]: Contract[] };

export type AliasFunction = (contract: Contract, context: Ctx, i: number, path: Contract[]) => Promise<string>;
export type AliasTemplate = string | AliasFunction;
export type AliasRender = { template: AliasTemplate, i: number };

export type FieldFunction = (parent: Contract, context: Ctx) => Promise<string | string[]>;
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
  artifact?: string; // NB: only applies if for an aliasTemplate key
  delegates?: RelationInnerConfig; // XXX map to default suffix?
  relations?: { [aliasTemplate: string]: RelationInnerConfig };
}

export type RelationConfigMap = { [aliasTemplateOrContractName: string]: RelationConfig };

// Read relation configuration
export function getRelationConfig(
  deploymentManagerConfig: DeploymentManagerConfig,
  network: string,
  deployment: string,
): RelationConfigMap {
  let relRelationConfigMap = deploymentManagerConfig?.networks?.[network]?.[deployment];
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

export function getFieldKey(config: RelationInnerConfig, defaultKey?: string): FieldKey {
  if (typeof config.field === 'string') {
    return { key: config.field };
  } else if (typeof config.field === 'function') {
    return { getter: config.field };
  } else if (config.field) {
    return config.field;
  } else {
    return { key: defaultKey };
  }
}

function asAddressArray(val: any, msg: string): string[] {
  if (val === null) {
    return [];
  } else if (typeof val === 'string') {
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

export async function readField(contract: Contract, fieldKey: FieldKey, context: Ctx): Promise<Address[]> {
  if (fieldKey.slot) {
    // Read from slot
    let addressRaw = await contract.provider.getStorageAt(contract.address, fieldKey.slot);
    let address = utils.getAddress('0x' + addressRaw.substring(26));
    return [address];
  } else if (fieldKey.key) {
    let val = await readKey(contract, fieldKey.key);
    return asAddressArray(val, fieldKey.key);
  } else if (fieldKey.getter) {
    return asAddressArray(await fieldKey.getter(contract, context), 'custom function');
  } else {
    throw new Error(`Unknown or invalid field key ${JSON.stringify(fieldKey)}`);
  }
}

export async function readAlias(
  contract: Contract,
  aliasRender: AliasRender,
  context: Ctx,
  path: Contract[],
): Promise<Alias> {
  const { template: aliasTemplate, i } = aliasRender;
  if (typeof aliasTemplate === 'string') {
    if (aliasTemplate.startsWith('.')) {
      return await readKey(contract, aliasTemplate.slice(1));
    } else {
      return aliasTemplate;
    }
  } else if (typeof aliasTemplate === 'function') {
    return await aliasTemplate(contract, context, i, path);
  } else {
    throw new Error(`Invalid alias template: ${JSON.stringify(aliasTemplate)}`);
  }
}

export function aliasTemplateKey(aliasTemplate: AliasTemplate): string | undefined {
  if (typeof aliasTemplate === 'string') {
    return aliasTemplate;
  } else if (aliasTemplate.name && aliasTemplate.name !== 'alias') {
    return aliasTemplate.name;
  }
}
