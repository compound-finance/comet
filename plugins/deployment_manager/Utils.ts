import * as fs from 'fs/promises';
import { ABI, BuildFile, ContractMetadata } from './Types';

type InputOrOutput = {
  name: string;
  type: string;
}

type ABIEntry = {
  type: string;
  name?: string;
  inputs?: InputOrOutput[];
  outputs?: InputOrOutput[];
  stateMutability?: string;
}

export function debug(...args: any[]) {
  if (process.env['DEBUG']) {
    if (typeof args[0] === 'function') {
      console.log(...args[0]());
    } else {
      console.log(...args);
    }
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.stat(path);
    return true;
  } catch (e) {
    return false;
  }
}

export function getPrimaryContract(buildFile: BuildFile): [string, ContractMetadata] {
  let targetContract = buildFile.contract;
  if (!targetContract) {
    throw new Error(`Missing target contract in build file. This is a new requirement.`);
  }

  let contractEntries = Object.entries(buildFile.contracts);
  let contracts = Object.fromEntries(
    contractEntries
      .map(([key, value]) => {
        if (key.includes(':')) {
          let [source, contractName] = key.split(':');
          return [[contractName, { ...value, source } as ContractMetadata]];
        } else {
          return Object.entries(value).map(([contractName, v]) => [contractName, { ...v, key }]);
        }
      })
      .flat()
  );

  let contractMetadata = contracts[targetContract];
  if (contractMetadata === undefined) {
    throw new Error(
      `Could not find contract ${targetContract} in buildFile with contracts: ${JSON.stringify(
        Object.keys(contracts)
      )}`
    );
  }

  return [targetContract, contractMetadata];
}

// merge two ABIs
// conflicting entries (like constructors) will defer to the second abi
// ("abi1"); duplicate entires are removed
export function mergeABI(abi0: ABI, abi1: ABI): ABIEntry[] {
  let parsedABI0: ABIEntry[] = typeof abi0 === 'string' ? JSON.parse(abi0) : abi0;
  let parsedABI1: ABIEntry[] = typeof abi1 === 'string' ? JSON.parse(abi1) : abi1;

  const mergedABI = [...parsedABI0, ...parsedABI1];

  const entries = {}

  for (const abiEntry of mergedABI) {
    // only allow one constructor or one unique entry
    const key = abiEntry.type == "constructor" ? "constructor" : JSON.stringify(abiEntry);

    entries[key] = abiEntry;
  }

  return Object.values(entries);
}

export function objectToMap<V>(obj: object | { [k: string]: V }): Map<string, V> {
  if (obj === undefined) {
    return new Map();
  } else {
    return new Map(Object.entries(obj));
  }
}

export function objectFromMap<V>(map: Map<string, V>): { [k: string]: V } {
  return Object.fromEntries(map.entries());
}

export function mapValues<V, W>(o: { string: V }, f: (V) => W): { [k: string]: W } {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
}

export function cross<A, B>(as: A[], bs: B[]): [A, B][] {
  return as.map<[A, B][]>((a) => {
    return bs.map<[A, B]>((b) => {
      return [a, b];
    });
  }).flat();
}

export function asArray<A>(v: A | A[]): A[] {
  if (Array.isArray(v)) {
    return v;
  } else {
    if (v === undefined) {
      return []
    } else {
      return [v];
    }
  }
}
