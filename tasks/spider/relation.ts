import { Contract } from 'ethers';

/**
 * Types, interfaces, and functions used to define relationships between contracts.
 * 
 * The relations defined are used by the Spider script to crawl contracts and pull
 * their configs directly from the blockchain. The relations can be modified in the
 * `creatRelations()` function.
 * 
 */

export type Address = string;

export interface Relation {
    // TODO: What if proxy's contract name is non-unique?
    proxy?: string; // contract name of proxy, if one exists.
    relations: (contract: Contract) => Promise<Address[]>;
}

export interface Relations {
    [contractName: string]: Relation;
}

// TODO: Consider abstracting this even more (Hardhat plugin?) so separate relations
// can be defined in one repo. (e.g. different relations on each chain)
export function createRelations(): Relations {
    let relations: Relations = {
        'CErc20Delegator': {
            relations: async (contract: Contract) => {
                return [
                    await contract.implementation(),
                    await contract.underlying(),
                ];
            },
        },
        'Unitroller': {
            relations: async (contract: Contract) => {
                return [
                    await contract.comptrollerImplementation(),
                ];
            },
        },
        'Comptroller': {
            proxy: 'Unitroller',
            relations: async (contract: Contract) => {
                return [
                    ...(await contract.getAllMarkets()),
                    await contract.oracle(),
                    await contract.admin(),
                ];
            },
        },
    };
    return relations;
}