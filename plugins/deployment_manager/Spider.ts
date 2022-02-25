import { Contract } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { Cache } from './Cache';
import {
  AliasTemplate,
  RelationConfigMap,
  RelationInnerConfig,
  aliasTemplateFromAlias,
  getFieldKey,
  readAlias,
  readField,
} from './RelationConfig';
import { Address, Alias, BuildFile, ContractMetadata } from './Types';
import { Aliases } from './Aliases';
import { Proxies } from './Proxies';
import { Roots } from './Roots';
import { asArray, cross, getPrimaryContract, objectFromMap } from './Utils';
import { fetchAndCacheContract } from './Import';

function isValidAddress(address: Address): boolean {
  return address !== '0x0000000000000000000000000000000000000000';
}

async function getDiscoverNodes(
  contract: Contract,
  relationConfig: RelationInnerConfig,
  alias: Alias
): Promise<[Address, AliasTemplate][]> {
  let addresses: string[] = await readField(contract, getFieldKey(alias, relationConfig));
  let aliasTemplates: AliasTemplate[] = relationConfig.alias
    ? asArray<AliasTemplate>(relationConfig.alias)
    : [aliasTemplateFromAlias(alias)];

  return cross(addresses, aliasTemplates);
}

interface VisitedNode {
  buildFile: BuildFile;
  contract: Contract;
  aliasTemplates: AliasTemplate[];
  implAddress?: Address;
}

// Tail-call optimized version of spider method, which crawls a dependency graph gathering contract data
async function runSpider(
  cache: Cache,
  network: string,
  hre: HardhatRuntimeEnvironment,
  relationConfigMap: RelationConfigMap, // For base relations (??)
  discovered: [Address, AliasTemplate][],
  visited: Map<Address, VisitedNode>,
  importRetries?: number,
  importRetryDelay?: number
): Promise<Map<Address, VisitedNode>> {
  if (discovered.length === 0) {
    // We have no more unvisited nodes; that means we're done.
    return visited;
  }

  // Let's spider over the next unvisited node in our list
  let [address, aliasTemplate] = discovered.shift();

  // Skip visited nodes (and invalid addresses)
  if (isValidAddress(address)) {
    // Fetch the build file from Etherscan
    // TODO: Cache?
    if (visited.has(address)) {
      let { buildFile, contract, aliasTemplates, ...rest } = visited.get(address);
      visited.set(address, {
        buildFile,
        contract,
        aliasTemplates: [...aliasTemplates, aliasTemplate],
        ...rest,
      });
    } else {
      const buildFile = await fetchAndCacheContract(
        cache,
        network,
        address,
        importRetries,
        importRetryDelay
      );

      const [contractName, contractMetadata] = getPrimaryContract(buildFile);

      let relationConfig = relationConfigMap[contractName] ??
        (typeof aliasTemplate === 'string' ? relationConfigMap[aliasTemplate] : undefined) ?? {
          relations: {},
        };

      // Relation Config tells us how to keep spidering from here, plus possibly
      // alternative aliases. If we don't have config, we can skip all of this.

      // Note: if this contract is a proxy, we'll need to grab the implementation
      // to get the current ABI.
      let contract = new hre.ethers.Contract(address, contractMetadata.abi, hre.ethers.provider);
      let implAddress;

      if (relationConfig.proxy) {
        let defaultAlias = typeof aliasTemplate === 'string' ? aliasTemplate : address;

        let implDiscovered = await getDiscoverNodes(
          contract,
          relationConfig.proxy,
          `${defaultAlias}:implementation`
        );
        [implAddress] = implDiscovered.map(([address, alias]) => address);
        if (!implAddress) {
          throw new Error(
            `Unknown or invalid implementation address: discovered: ${JSON.stringify(
              implDiscovered
            )}`
          );
        }

        // Recurse a single step to get implementation
        visited = await runSpider(
          cache,
          network,
          hre,
          relationConfigMap,
          implDiscovered,
          visited,
          importRetries,
          importRetryDelay
        );

        let { contract: proxyContract } = visited.get(implAddress);
        if (!proxyContract) {
          throw new Error(`Failed to spider implementation for ${defaultAlias} at ${implAddress}`);
        }

        contract = proxyContract.attach(address);
      }

      // Store the build file. This is the primary result of spidering: a huge list
      // of `address -> build file`, which is the contract cache.
      visited.set(address, {
        buildFile,
        contract,
        aliasTemplates: [aliasTemplate],
        implAddress,
      });

      for (let [alias, relationInnerConfig] of Object.entries(relationConfig.relations)) {
        let newDiscovered = await getDiscoverNodes(contract, relationInnerConfig, alias);
        discovered.push(...newDiscovered);
      }
    }
  }

  return await runSpider(
    cache,
    network,
    hre,
    relationConfigMap,
    discovered,
    visited,
    importRetries,
    importRetryDelay
  );
}

export async function spider(
  cache: Cache,
  network: string,
  hre: HardhatRuntimeEnvironment,
  relationConfigMap: RelationConfigMap,
  roots: Roots,
  importRetries?: number,
  importRetryDelay?: number
): Promise<{ cache: Cache; aliases: Aliases; proxies: Proxies }> {
  let discovered: [Address, AliasTemplate][] = [...roots.entries()].map(([alias, address]) => {
    return [address, aliasTemplateFromAlias(alias)];
  });

  let visited = await runSpider(
    cache,
    network,
    hre,
    relationConfigMap,
    discovered,
    new Map(),
    importRetries,
    importRetryDelay
  );

  // TODO: Consider parallelizing these reads
  let proxies: Proxies = new Map();
  let aliases: Aliases = new Map();
  for (let [address, { contract, aliasTemplates, implAddress }] of visited.entries()) {
    for (let aliasTemplate of aliasTemplates) {
      let alias = await readAlias(contract, aliasTemplate);
      aliases.set(alias, address);
      if (implAddress) {
        proxies.set(alias, implAddress);
      }
    }
  }

  return { cache, aliases, proxies };
}
