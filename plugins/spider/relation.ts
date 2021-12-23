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
  canonicalName?: (contract: Contract) => Promise<string>,
  relations?: (contract: Contract) => Promise<Address[]>;
  implementation?: (contract: Contract) => Promise<Address>;
}

export interface Relations {
  [contractName: string]: Relation;
}

export async function createRelations(network: string): Promise<Relations> {
  const dir = path.join(__dirname, "..", "..", "deployments", network);
  const file = path.join(dir, `relations.json`);
  const relationsData = JSON.parse(
    await fs.promises.readFile(file, "utf-8")
  );

  let relationsOutput: Relations = {};

  for (const contract in relationsData) {
    const contractRelations = relationsData[contract].relations;
    const contractImplementation = relationsData[contract].implementation;
    const canonicalName = relationsData[contract].canonicalName;

    let implementationValue;
    if (contractImplementation) {
      implementationValue = async (contract: Contract) => {
          return (await contract.functions[contractImplementation]())[0];
        };
    }

    let relationsValue;
    if (contractRelations) {
      relationsValue = async (contract: Contract) => {
        const toFlatten = await Promise.all(contractRelations.map(async (relation) => {
          const res = await contract.functions[relation]();
          return res[0];
        }));
        return toFlatten.flat();
      }
    }

    let nameValue;
    if (canonicalName) {
      nameValue = async (contract: Contract) => {
        const tokens = canonicalName.split('+');
        const names = await Promise.all(tokens.map(async (token) => {
          if (token[0] == '@') {
            return (await contract.functions[token.slice(1)]())[0];
          } else {
            return token;
          }
        }));
        return names.join('');
      }
    }

    relationsOutput[contract] = {
      canonicalName: nameValue,
      relations: relationsValue,
      implementation: implementationValue
    }
  }

  return relationsOutput;
}