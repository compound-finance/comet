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

/**
 * Normalizes all address keys in a RelationConfigMap to lowercase.
 * This ensures case-insensitive address matching when looking up relations.
 * Ethereum addresses are case-insensitive (though checksums use case),
 * so we normalize to lowercase for consistent lookups.
 */
function normalizeRelationConfigKeys(relationConfigMap: RelationConfigMap): RelationConfigMap {
  const normalized: RelationConfigMap = {};
  for (const [key, value] of Object.entries(relationConfigMap)) {
    // Check if the key looks like an Ethereum address (0x followed by 40 hex characters)
    if (utils.isAddress(key)) {
      // Normalize address keys to lowercase for case-insensitive matching
      normalized[key.toLowerCase()] = value;
    } else {
      // Keep non-address keys (like contract names) as-is
      normalized[key] = value;
    }
  }
  return normalized;
}

// Read relation configuration
export function getRelationConfig(
  deploymentManagerConfig: DeploymentManagerConfig,
  network: string,
  deployment: string,
): RelationConfigMap {
  let relRelationConfigMap = deploymentManagerConfig?.networks?.[network]?.[deployment];
  if (relRelationConfigMap) {
    return normalizeRelationConfigKeys(relRelationConfigMap);
  }
  let baseRelationConfigMap = deploymentManagerConfig?.relationConfigMap;
  if (baseRelationConfigMap) {
    return normalizeRelationConfigKeys(baseRelationConfigMap);
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
  } else if (defaultKey) {
    return { key: defaultKey };
  } else {
    throw new Error('No field key specified');
  }
}

export function aliasTemplateKey(aliasTemplate: AliasTemplate): string {
  if (typeof aliasTemplate === 'string') {
    return aliasTemplate;
  } else {
    throw new Error('Cannot get alias template key for function');
  }
}

export async function readAlias(
  contract: Contract,
  aliasRender: AliasRender,
  context: Ctx,
  path: Contract[]
): Promise<Alias> {
  const { template, i } = aliasRender;
  if (typeof template === 'string') {
    return template;
  } else {
    return await template(contract, context, i, path);
  }
}

export async function readField(
  contract: Contract,
  fieldKey: FieldKey,
  context: Ctx
): Promise<Address[]> {
  if (fieldKey.getter) {
    const result = await fieldKey.getter(contract, context);
    if (typeof result === 'string') {
      return [result];
    } else {
      return result;
    }
  } else if (fieldKey.key) {
    return [await contract[fieldKey.key]()];
  } else if (fieldKey.slot) {
    const raw = await contract.provider.getStorageAt(contract.address, fieldKey.slot);
    // Remove leading zeros and pad to 20 bytes
    return ['0x' + raw.slice(26)];
  } else {
    throw new Error('No field getter specified');
  }
}
