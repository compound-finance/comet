import * as fs from 'fs/promises';
import { HardhatRuntimeEnvironment as HRE } from 'hardhat/types';
import { Contract } from 'ethers';
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

export function getEthersContract<C extends Contract>(address: string, buildFile: BuildFile, hre: HRE): C {
  const [_, metadata] = getPrimaryContract(buildFile);
  return new hre.ethers.Contract(address, metadata.abi, hre.ethers.provider) as C;
}

// merge two ABIs, duplicate entries are removed
// conflicting entries (like constructors) will defer to the second abi (`abi1`)
export function mergeABI(abi0: ABI, abi1: ABI): ABIEntry[] {
  const parsedABI0: ABIEntry[] = typeof abi0 === 'string' ? JSON.parse(abi0) : abi0;
  const parsedABI1: ABIEntry[] = typeof abi1 === 'string' ? JSON.parse(abi1) : abi1;
  const entries = {};
  for (const abiEntry of parsedABI0.concat(parsedABI1)) {
    const { type, name, inputs } = abiEntry;
    const normalizedEntry = { type, name, inputs: inputs && inputs.map(i => ({ type: i.type })) };
    const key = type === 'constructor' ? 'constructor' : JSON.stringify(normalizedEntry);
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

export function asArray<A>(v: A | A[]): A[] {
  if (Array.isArray(v)) {
    return v;
  } else {
    if (v === undefined) {
      return [];
    } else {
      return [v];
    }
  }
}

export function txCost({ cumulativeGasUsed, effectiveGasPrice }): bigint {
  return cumulativeGasUsed.mul(effectiveGasPrice).toBigInt();
}

/**
 * Call an async function with a maximum time limit (in milliseconds) for the timeout
 * @param asyncPromise an async promise to resolve
 * @param timeLimit time limit before timeout in milliseconds. Default is 2 min
 */
export async function asyncCallWithTimeout(asyncPromise: Promise<any>, timeLimit: number = 120_000) {
  let timeoutHandle;

  const timeoutPromise = new Promise((_resolve, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('Async call timeout limit reached')),
      timeLimit
    );
  });

  return Promise.race([asyncPromise, timeoutPromise]).then(result => {
    clearTimeout(timeoutHandle);
    return result;
  });
}
