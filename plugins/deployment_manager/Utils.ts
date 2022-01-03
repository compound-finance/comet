import * as fs from 'fs/promises';

import { Contract } from 'ethers';
import { Address, BuildFile, ContractMap, ContractMetadata } from './Types';

async function asAddresses(
  contract: Contract,
  fnName: string
): Promise<Address[]> {
  let fn = contract.functions[fnName];
  if (!fn) {
    // TODO: `contract.name` is undefined. Find a better way to log this error.
    throw new Error(
      `Cannot find contract function ${contract.name}.${fnName}()`
    );
  }
  let val = (await fn())[0]; // Return val is always stored as first item in array

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

export function getPrimaryContract(buildFile: BuildFile): ContractMetadata {
  // TODO: Handle multiple files
  return Object.values(buildFile.contracts)[0];
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
export async function getRelations(
  contract: Contract,
  relationFnName: string
): Promise<Address[]> {
  return await asAddresses(contract, relationFnName);
}

export function mergeContracts(a: ContractMap, b: ContractMap): ContractMap {
  return {
    ...a,
    ...b,
  };
}
