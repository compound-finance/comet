import * as fs from 'fs/promises';

import { Contract, utils } from 'ethers';
import { Address, BuildFile, ContractMap, ContractMetadata } from './Types';

async function asAddresses(contract: Contract, fnName: string): Promise<Address[]> {
  if (fnName.startsWith('%')) { // Read from slot
    let slot = fnName.slice(1);
    let addressRaw = await contract.provider.getStorageAt(contract.address, slot)
    let address = utils.getAddress("0x" + addressRaw.substring(26))
    return [address];
  }

  let fn = contract.callStatic[fnName];
  if (!fn) {
    // TODO: `contract.name` is undefined. Find a better way to log this error.
    throw new Error(`Cannot find contract function ${contract.name}.${fnName}()`);
  }
  let val = (await fn());

  if (typeof val === 'string') {
    return [val];
  } else if (Array.isArray(val)) {
    if (val.every((x) => typeof x === 'string')) {
      return val;
    }
  }

  throw new Error(
    `Unable to coerce contract value ${contract.name}.${fnName}()=\`${val}\` to address`
  );
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch (e) {
    return false;
  }
}

export function readAddressFromFilename(fileName: string): Address {
  const {
    groups: { address },
  } = /.*(?<address>0x[0-9a-fA-F]{40}).json/.exec(fileName);
  if (!address) {
    throw new Error(`Invalid cache file: ${fileName}`);
  }

  return address;
}

export function getPrimaryContract(buildFile: BuildFile): [string, ContractMetadata] {
  let targetContract = buildFile.contract;
  if (!targetContract) {
    throw new Error(`Missing target contract in build file. This is a new requirement.`);
  }

  let contractEntries = Object.entries(buildFile.contracts);
  let contracts = Object.fromEntries(contractEntries.map(([key, value]) => {
    if (key.includes(':')) {
      let [source, contractName] = key.split(':');
      return [[contractName, { ...value, source } as ContractMetadata]];
    } else {
      return Object.entries(value).map(([contractName, v]) => [contractName, { ...v, key }]);
    }
  }).flat());

  let contractMetadata = contracts[targetContract];
  if (contractMetadata === undefined) {
    throw new Error(`Could not find contract ${targetContract} in buildFile with contracts: ${JSON.stringify(Object.keys(contracts))}`);
  }

  return [targetContract, contractMetadata];
}

export async function getAlias(
  contract: Contract,
  contractMetadata: ContractMetadata,
  aliasRule: string | undefined
): Promise<string> {
  if (!aliasRule) {
    return contractMetadata.name;
  }
  const tokens = aliasRule.split('+');
  const names = await Promise.all(
    tokens.map(async (token) => {
      if (token[0] == '@') {
        return (await contract.functions[token.slice(1)]())[0];
      } else {
        return token;
      }
    })
  );
  return names.join('');
}

// TODO: Should this raise or do something more interesting if it fails?
export async function getRelations(contract: Contract, relationFnName: string): Promise<Address[]> {
  return await asAddresses(contract, relationFnName);
}

export function mergeContracts(a: ContractMap, b: ContractMap): ContractMap {
  return {
    ...a,
    ...b,
  };
}

export function objectToMap<V>(obj: {[k: string]: V}): Map<string, V> {
  return new Map(Object.entries(obj));
}

export function objectFromMap<V>(map: Map<string, V>): {[k: string]: V} {
  return Object.fromEntries(map.entries());
}

export function mapValues<V, W>(o: {string: V}, f: (V) => W): {[k: string]: W} {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
}
