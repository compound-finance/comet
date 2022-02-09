export interface ContractMetadata {
  address: Address;
  name: string;
  abi: string;
  bin: string;
  metadata: string;
  source?: string;
  constructorArgs: string;
}

export interface BuildFile {
  contract: string;
  contracts: {
    [fileContractName: string]: ContractMetadata | { [contractName: string]: ContractMetadata };
  };
  version: string;
}

export type Address = string;
export type Alias = string;
