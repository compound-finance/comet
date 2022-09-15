import { TransactionResponse } from '@ethersproject/abstract-provider';

export type ABI = string | any[];
export type Address = string;
export type Alias = string;

export interface BuildFile {
  contract: string;
  contracts: {
    [fileContractName: string]: ContractMetadata | { [contractName: string]: ContractMetadata };
  };
  version: string;
}

export interface ContractMetadata {
  network?: string;
  address: Address;
  name: string;
  abi: ABI;
  bin: string;
  metadata: string;
  source?: string;
  constructorArgs: string;
}

export type TraceArg = string | TransactionResponse;
export type TraceFn = (TraceArg, ...any) => void;
