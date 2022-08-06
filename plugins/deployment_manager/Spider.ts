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
import { fetchAndCacheContract, readAndCacheContract } from './Import';

export interface Spider {
  aliases: Aliases;
  proxies: Proxies;
}

interface DiscoverNode {
  address: Address;
  aliasRender: AliasRender;
  alias: Alias;
}

interface VisitedNode {
  name: string;
  contract: Contract;
  aliasRenders: AliasRender[];
  implAddress?: Address;
}

function isContractAddress(address: Address): boolean {
  return address !== '0x0000000000000000000000000000000000000000';
}

async function getDiscoverNodes(
  contract: Contract,
  context: Ctx,
  relationConfig: RelationInnerConfig,
  alias: Alias
): Promise<DiscoverNode[]> {
  let addresses: string[] = await readField(contract, getFieldKey(alias, relationConfig), context);
  let aliasTemplates: AliasTemplate[] = relationConfig.alias
    ? asArray<AliasTemplate>(relationConfig.alias)
    : [aliasTemplateFromAlias(alias)];

  return addresses.map((address, i) => ({
    address,
    aliasRender: { template: aliasTemplates[i] || aliasTemplates[0], i },
    alias,
  }));
}

// Tail-call optimized version of spider method, which crawls a dependency graph gathering contract data
async function runSpider(
  cache: Cache,
  network: string,
  hre: HardhatRuntimeEnvironment,
  relationConfigMap: RelationConfigMap, // For base relations (??)
  context: Ctx,
  discovered: DiscoverNode[],
  visited: Map<Address, VisitedNode>,
  importRetries?: number,
  importRetryDelay?: number
): Promise<void> {
  if (discovered.length === 0) {
    // We have no more unvisited nodes; that means we're done.
    return;
  }

  // Let's spider over the next unvisited node in our list
  const { address, aliasRender, alias } = discovered.shift();
  debug(`Spidering ${address}...`, alias, aliasRender);

  if (!isContractAddress(address)) {
    debug(`Not a contract, skipping...`);
  } else {
    if (visited.has(address)) {
      // If the address has been visited, just add an alias
      const { aliasRenders, ...rest } = visited.get(address);
      visited.set(address, { aliasRenders: [...aliasRenders, aliasRender], ...rest });
      debug(`Already visited ${address}`, alias);
    } else {
      // Otherwise visit it
      const { template: aliasTemplate } = aliasRender;
      let relationConfig, name, contract, implAddress;
      if (typeof aliasTemplate === 'string') {
        relationConfig = relationConfigMap[aliasTemplate];
      }

      if (relationConfig && relationConfig.artifact) {
        // If the relation specifies the name of an artifact, we use that instead of importing.
        // This is useful for things not verified or deployed from a factory on-chain,
        //  since these can't necessarily be imported, especially not locally.

        const buildFile = await readAndCacheContract(cache, hre, relationConfig.artifact, address);
        const [contractName, contractMetadata] = getPrimaryContract(buildFile);
        name = relationConfig.artifact;
        contract = new hre.ethers.Contract(address, contractMetadata.abi, hre.ethers.provider);
      } else {
        // Otherwise fetch a build file from Etherscan
        const buildFile = await fetchAndCacheContract(
          cache,
          network,
          address,
          importRetries,
          importRetryDelay
        );
        const [contractName, contractMetadata] = getPrimaryContract(buildFile);
        relationConfig = relationConfig ?? relationConfigMap[contractName] ?? {};
        name = contractMetadata.name || contractMetadata['key'];
        contract = new hre.ethers.Contract(address, contractMetadata.abi, hre.ethers.provider);
      }

      if (relationConfig.proxy) {
        // If its a proxy, step into it
        const defaultAlias = typeof aliasTemplate === 'string' ? aliasTemplate : address;
        const implNodes = await getDiscoverNodes(
          contract,
          context,
          relationConfig.proxy,
          `${defaultAlias}:implementation`
        );

        if (implNodes.length > 0) {
          [implAddress] = implNodes.map(({ address }) => address);

          // Recurse a single step to get implementation
          await runSpider(
            cache,
            network,
            hre,
            relationConfigMap,
            context,
            implNodes,
            visited,
            importRetries,
            importRetryDelay
          );

          const proxyNode = visited.get(implAddress);
          if (!proxyNode) {
            throw new Error(`Failed to spider implementation for ${defaultAlias} at ${implAddress}`);
          }

          // Merge & defer duplicate entries (like constructor) to previous abi
          contract = new hre.ethers.Contract(
            address,
            mergeABI(proxyNode.contract.interface.format('json'), contract.interface.format('json')),
            hre.ethers.provider
          );
        }
      }

      // Add the alias in place to the context
      if (context[alias]) {
        context[alias].push(contract);
      } else {
        context[alias] = [contract];
      }

      // Store the visited node for the address
      visited.set(address, {
        name,
        contract,
        aliasRenders: [aliasRender],
        implAddress,
      });

      for (const [subAlias, innerConfig] of Object.entries(relationConfig.relations ?? {})) {
        const nodes = await getDiscoverNodes(contract, context, innerConfig, subAlias);
        discovered.unshift(...nodes);
      }

      debug(`Spidered ${address}:`, alias, name);
    }
  }

  return runSpider(
    cache,
    network,
    hre,
    relationConfigMap,
    context,
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
): Promise<Spider> {
  const context = {};
  const discovered: DiscoverNode[] = [...roots.entries()].map(([alias, address]) => ({
    address,
    aliasRender: { template: aliasTemplateFromAlias(alias), i: 0 },
    alias,
  }));
  const visited = new Map();

  await runSpider(
    cache,
    network,
    hre,
    relationConfigMap,
    context,
    discovered,
    visited,
    importRetries,
    importRetryDelay
  );

  // TODO: Consider parallelizing these reads
  const proxies: Proxies = new Map();
  const aliases: Aliases = new Map();
  for (const [address, { name, contract, aliasRenders, implAddress }] of visited.entries()) {
    for (const aliasRender of aliasRenders) {
      const alias = await readAlias(contract, aliasRender, context);
      aliases.set(alias, address);
      if (implAddress) {
        proxies.set(alias, implAddress);
      }
    }
  }

  return { aliases, proxies };
}
