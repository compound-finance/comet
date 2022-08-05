import { Contract } from 'ethers';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

import { Cache } from './Cache';
import {
  AliasTemplate,
  AliasRender,
  RelationConfigMap,
  RelationInnerConfig,
  aliasTemplateFromAlias,
  getFieldKey,
  readAlias,
  readField,
} from './RelationConfig';
import { Address, Alias, BuildFile, Ctx } from './Types';
import { Aliases } from './Aliases';
import { Proxies } from './Proxies';
import { Roots } from './Roots';
import { asArray, debug, getPrimaryContract, mergeABI } from './Utils';
import { fetchAndCacheContract } from './Import';

function isValidAddress(address: Address): boolean {
  return address !== '0x0000000000000000000000000000000000000000';
}

async function getDiscoverNodes(
  contract: Contract,
  context: Ctx,
  relationConfig: RelationInnerConfig,
  alias: Alias
): Promise<[Address, AliasRender, Alias, Ctx][]> {
  let addresses: string[] = await readField(contract, getFieldKey(alias, relationConfig), context);
  let aliasTemplates: AliasTemplate[] = relationConfig.alias
    ? asArray<AliasTemplate>(relationConfig.alias)
    : [aliasTemplateFromAlias(alias)];

  return addresses.map((a, i) => [a, { template: aliasTemplates[i] || aliasTemplates[0], i }, alias, context]);
}

interface VisitedNode {
  name: string;
  buildFile: BuildFile;
  contract: Contract;
  context: Ctx;
  aliasRenders: AliasRender[];
  implAddress?: Address;
}

// Tail-call optimized version of spider method, which crawls a dependency graph gathering contract data
async function runSpider(
  cache: Cache,
  network: string,
  hre: HardhatRuntimeEnvironment,
  relationConfigMap: RelationConfigMap, // For base relations (??)
  discovered: [Address, AliasRender, Alias, Ctx][],
  visited: Map<Address, VisitedNode>,
  importRetries?: number,
  importRetryDelay?: number
): Promise<Map<Address, VisitedNode>> {
  if (discovered.length === 0) {
    // We have no more unvisited nodes; that means we're done.
    return visited;
  }

  // Let's spider over the next unvisited node in our list
  let [address, aliasRender, alias, context] = discovered.shift();
  debug(`Spidering ${address}...`, aliasRender);

  // Skip visited nodes (and invalid addresses)
  if (isValidAddress(address)) {
    // Fetch the build file from Etherscan
    // TODO: Cache?
    if (visited.has(address)) {
      let { buildFile, contract, aliasRenders, ...rest } = visited.get(address);
      visited.set(address, {
        buildFile,
        contract,
        aliasRenders: [...aliasRenders, aliasRender],
        ...rest,
      });
    } else {
      const aliasTemplate = aliasRender.template;
      const buildFile = await fetchAndCacheContract(
        cache,
        network,
        address,
        importRetries,
        importRetryDelay
      );

      const [contractName, contractMetadata] = getPrimaryContract(buildFile);
      const name = contractMetadata.name || contractMetadata['key'];

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
          context,
          relationConfig.proxy,
          `${defaultAlias}:implementation`
        );

        if (implDiscovered.length > 0) {
          [implAddress] = implDiscovered.map(([address]) => address);

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

          let { buildFile: proxyBuildFile } = visited.get(implAddress);
          if (!proxyBuildFile) {
            throw new Error(
              `Failed to spider implementation for ${defaultAlias} at ${implAddress}`
            );
          }
          const [_proxyContractName, proxyContractMetadata] = getPrimaryContract(proxyBuildFile);

          // duplicate entries (like constructor) defer to contractMetadata.abi
          const mergedABI = mergeABI(proxyContractMetadata.abi, contractMetadata.abi);

          contract = new hre.ethers.Contract(
            address,
            mergedABI,
            hre.ethers.provider
          );
        }
      }
      debug(`Spidered ${address}:`, name);

      // Add the alias in place to the context
      if (context[alias]) {
        context[alias].push(contract);
      } else {
        context[alias] = [contract];
      }

      // Store the build file. This is the primary result of spidering: a huge list
      // of `address -> build file`, which is the contract cache.
      visited.set(address, {
        name,
        buildFile,
        contract,
        context,
        aliasRenders: [aliasRender],
        implAddress,
      });

      for (let [subAlias, relationInnerConfig] of Object.entries(relationConfig.relations)) {
        let newDiscovered = await getDiscoverNodes(
          contract,
          context,
          relationInnerConfig,
          subAlias
        );
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
): Promise<{ cache: Cache, aliases: Aliases, proxies: Proxies }> {
  let discovered: [Address, AliasRender, Alias, Ctx][] = [...roots.entries()].map(([alias, address]) => {
    return [address, { template: aliasTemplateFromAlias(alias), i: 0 }, alias, {}];
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
  for (let [address, { name, contract, context, aliasRenders, implAddress }] of visited.entries()) {
    for (let aliasRender of aliasRenders) {
      let alias = await readAlias(contract, aliasRender, context);
      aliases.set(alias, address);
      if (implAddress) {
        proxies.set(alias, implAddress);
      }
    }
  }

  return { cache, aliases, proxies };
}
