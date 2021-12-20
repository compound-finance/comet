import * as fs from 'fs/promises';

import { Contract } from 'ethers';
import { Address, BuildFile, ContractMetadata } from './Types';

async function asAddress(contract: Contract, fnName: string): Promise<Address> {
  let fn = contract.functions[fnName];
  if (!fn) {
    throw new Error(`Cannot find contract function ${contract.name}.${fnName}()`);
  }
  let val = await fn();

  if (typeof(val) === 'string') {
    return val;
  } else if (Array.isArray(val)) {
    if (typeof(val[0]) === 'string') {
      return val[0];
    }
  }

  throw new Error(`Unable to coerce contract value ${contract.name}.${fnName}()=\`${val}\` to address`);
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
  const { groups: { address } } = /.*(?<address>0x[0-9a-fA-F]{40}).json/.exec(fileName);
  if (!address) {
    throw new Error(`Invalid cache file: ${fileName}`);
  }

  return address;
}

export function getPrimaryContract(buildFile: BuildFile): ContractMetadata {
  // TODO: Handle multiple files
  return Object.values(buildFile.contracts)[0];
}

// TODO: Should this raise or do something more interesting if it fails?
export async function getRelation(contract: Contract, relation: string): Promise<string> {
  return await asAddress(contract, relation);
}
