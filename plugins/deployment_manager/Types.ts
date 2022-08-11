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
  address: Address;
  name: string;
  abi: ABI;
  bin: string;
  metadata: string;
  source?: string;
  constructorArgs: string;
}
