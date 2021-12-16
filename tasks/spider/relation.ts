import { Contract } from 'ethers';
import fs from 'fs';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import * as path from 'path';

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
  relations?: (contract: Contract) => Promise<Address[]>;
  implementation?: (contract: Contract) => Promise<Address>;
}

export interface Relations {
  [contractName: string]: Relation;
}

// TODO: Consider abstracting this even more (Hardhat plugin?) so separate relations
// can be defined in one repo. (e.g. different relations on each chain)
export async function createRelations(network: string) {
  const outdir = path.join(__dirname, "..", "..", "deployments", network);
  const outfile = path.join(outdir, `relations.json`);
  const relationsData = JSON.parse(
    await fs.promises.readFile(outfile, "utf-8")
  );

  let relationsOutput: Relations = {};

  for (const contract in relationsData) {
    const contractRelations = relationsData[contract].relations;
    const contractImplementation = relationsData[contract].implementation;

    let implementationValue;
    if (contractImplementation) {
      implementationValue = async (contract: Contract) => {
          return (await contract.functions[contractImplementation]())[0];
        };
    }

    let relationsValue;
    if (contractRelations) {
      relationsValue = async (contract: Contract) => {
        const toFlatten =  await Promise.all(contractRelations.map(async (relation) => {
          const res = await contract.functions[relation]();
          return res[0];
        }));
        return toFlatten.flat();
      }
    }

    relationsOutput[contract] = {
      relations: relationsValue,
      implementation: implementationValue
    }
  }

  return relationsOutput;
}