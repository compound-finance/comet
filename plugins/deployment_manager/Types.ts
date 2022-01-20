import { Contract } from 'ethers';
import { Comet } from '../../build/types';

export type Address = string;

export interface ContractMetadata {
  address: Address;
  name: string;
  abi: string;
  bin: string;
  metadata: string;
  source: string;
  constructorArgs: string;
}

export interface BuildFile {
  contract: string;
  contracts: {
    [fileContractName: string]: ContractMetadata | { [contractName: string]: ContractMetadata };
  };
  version: string;
}

export type ContractMap = {
  Comet?: Comet;
  [name: string]: Contract;
};

export type PointersMap = Map<string, Address>;

export type BuildMap = Map<Address, BuildFile>;

export type AliasesMap = Map<Address, string[]>;

export type ProxiesMap = Map<Address, Address>;
