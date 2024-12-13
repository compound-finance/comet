import { Contract } from 'ethers';
import { HardhatRuntimeEnvironment as HRE } from 'hardhat/types';

import { Cache } from './Cache';
import {
  Ctx,
  AliasRender,
  RelationConfigMap,
  RelationConfig,
  RelationInnerConfig,
  aliasTemplateKey,
  getFieldKey,
  readAlias,
  readField,
} from './RelationConfig';
import { Address, Alias, BuildFile, TraceFn } from './Types';
import { Aliases } from './Aliases';
import { ContractMap } from './ContractMap';
import { Roots } from './Roots';
import { asArray, debug, getEthersContract, mergeContracts } from './Utils';
import { fetchAndCacheContract, readContract } from './Import';

export interface Spider {
  roots: Roots;
  aliases: Aliases;
  contracts: ContractMap;
}

interface Build {
  buildFile: BuildFile;
  contract: Contract;
}

interface DiscoverNode {
  address: Address;
  aliasRender: AliasRender;
  path: Contract[];
}

function maybeStore(alias: Alias, address: Address, into: Aliases): boolean {
  const maybeExists = into.get(alias);
  if (maybeExists) {
    if (maybeExists === address) {
      return false;
    } else {
      throw new Error(`Had ${alias} -> ${maybeExists}, not ${address}`);
    }
  } else {
    into.set(alias, address);
    return true;
  }
}

async function discoverNodes(
  path: Contract[],
  contract: Contract,
  context: Ctx,
  config: RelationInnerConfig,
  defaultKeyAndTemplate: string
): Promise<DiscoverNode[]> {
  const addresses = await readField(contract, getFieldKey(config, defaultKeyAndTemplate), context);
  const templates = config.alias ? asArray(config.alias) : [defaultKeyAndTemplate];
  return addresses.map((address, i) => ({
    address,
    aliasRender: { template: templates[i % templates.length], i },
    path: [contract].concat(path),
  }));
}

async function isContract(hre: HRE, address: string) {
  return await hre.ethers.provider.getCode(address) !== '0x';
}

async function localBuild(cache: Cache, hre: HRE, artifact: string, network: string, address: Address): Promise<Build> {
  const buildFile = await readContract(cache, hre, artifact, network, address, !cache);
  const contract = getEthersContract(address, buildFile, hre);
  return { buildFile, contract };
}

async function remoteBuild(cache: Cache, hre: HRE, network: string, address: Address): Promise<Build> {
  const buildFile = await fetchAndCacheContract(cache, network, address);
  const contract = getEthersContract(address, buildFile, hre);
  return { buildFile, contract };
}

async function crawl(
  cache: Cache,
  network: string,
  hre: HRE,
  relations: RelationConfigMap,
  node: DiscoverNode,
  context: Ctx,
  aliases: Aliases,
  contracts: ContractMap,
  trace: TraceFn
): Promise<Alias> {
  const { aliasRender, address, path } = node;
  const { template: aliasTemplate } = aliasRender;
  //trace(`Crawling ${address}`, aliasRender);

  async function maybeProcess(alias: Alias, build: Build, config: RelationConfig): Promise<Alias> {
    if (maybeStore(alias, address, aliases)) {
      //trace(`Processing ${address}: ${alias} using ${build.buildFile.contract} ...`);
      let contract = build.contract;

      if (config.delegates) {
        const implAliasTemplate = `${alias}:implementation`;
        const implNodes = await discoverNodes(path, contract, context, config.delegates, implAliasTemplate);
        for (const implNode of implNodes) {
          const implAlias = await crawl(
            cache,
            network,
            hre,
            relations,
            implNode,
            context,
            aliases,
            contracts,
            trace
          );
          const implContract = contracts.get(implAlias);
          if (!implContract) {
            throw new Error(`Failed to crawl ${implAlias} at ${implNode.address}`);
          }

          // Extend the contract ABI w/ the delegate
          //trace(`Merging ${address} <- ${implNode.address} (${alias} <- ${implAlias})`);
          contract = mergeContracts(address, [implContract, contract], hre);

          // Add the alias in place to the relative context
          (context[implAlias] = context[implAlias] || []).push(implContract);
        }
      }

      // Add the alias in place to the absolute contracts
      contracts.set(alias, contract);

      if (config.relations) {
        for (const [subKey, subConfig] of Object.entries(config.relations)) {
          const subNodes = await discoverNodes(path, contract, context, subConfig, subKey);
          for (const subNode of subNodes) {
            const subAlias = await crawl(
              cache,
              network,
              hre,
              relations,
              subNode,
              context,
              aliases,
              contracts,
              trace
            );

            // Add the aliasTemplate in place to the relative context
            (context[subKey] = context[subKey] || []).push(contracts.get(subAlias));
          }
        }
      }

      trace(`Crawled ${address}: ${alias}`);
    } else {
      trace(`Visited ${address}: ${alias} already, skipping`);
    }
    return alias;
  }

  const addressConfig = relations[address.toLowerCase()];
  if (addressConfig) {
    //trace(` ... has an address config (${address})`);
    if (addressConfig.artifact) {
      //trace(`  ... has artifact specified (${addressConfig.artifact})`);
      const build = await localBuild(null, hre, addressConfig.artifact, network, address);
      const alias = await readAlias(build.contract, aliasRender, context, path);
      return maybeProcess(alias, build, addressConfig);
    } else {
      //trace('  ... no artifact specified');
      const build = await remoteBuild(cache, hre, network, address);
      const alias = await readAlias(build.contract, aliasRender, context, path);
      return maybeProcess(alias, build, addressConfig);
    }
  }

  const aliasTemplateConfig = relations[aliasTemplateKey(aliasTemplate)];
  if (aliasTemplateConfig) {
    //trace(' ... has alias template config');
    // Note: skipping this check, since it adds a brittle network call and isn't strictly necessary
    // if (!await isContract(hre, address)) {
    //   throw new Error(`Found config for '${aliasTemplate}' but no contract at ${address}`);
    // }
    if (aliasTemplateConfig.artifact) {
      //trace(`  ... has artifact specified (${aliasTemplateConfig.artifact})`);
      const build = await localBuild(null, hre, aliasTemplateConfig.artifact, network, address);
      const alias = await readAlias(build.contract, aliasRender, context, path);
      return maybeProcess(alias, build, aliasTemplateConfig);
    } else {
      //trace('  ... no artifact specified');
      const build = await remoteBuild(cache, hre, network, address);
      const alias = await readAlias(build.contract, aliasRender, context, path);
      return maybeProcess(alias, build, aliasTemplateConfig);
    }
  } else {
    //trace(' ... no alias template config');
    if (await isContract(hre, address)) {
      //trace('  ... is a contract');
      const build = await remoteBuild(cache, hre, network, address);
      const contractConfig = relations[build.buildFile.contract];
      if (contractConfig) {
        //trace(`   ... has contract config (${build.buildFile.contract})`);
        if (contractConfig.artifact) {
          //trace(`    ... has artifact specified (${contractConfig.artifact})`);
          const build_ = await localBuild(null, hre, contractConfig.artifact, network, address);
          const alias = await readAlias(build_.contract, aliasRender, context, path);
          return maybeProcess(alias, build_, contractConfig);
        } else {
          //trace('    ... no artifact specified');
          const alias = await readAlias(build.contract, aliasRender, context, path);
          return maybeProcess(alias, build, contractConfig);
        }
      } else {
        //trace(`   ... no contract config (${build.buildFile.contract})`);
        const alias = await readAlias(build.contract, aliasRender, context, path);
        const aliasConfig = relations[alias];
        if (aliasConfig) {
          //trace(`    ... has alias config (${alias})`);
          return maybeProcess(alias, build, aliasConfig);
        } else {
          //trace(`    ... no alias config (${alias})`);
          return maybeProcess(alias, build, {});
        }
      }
    } else {
      //trace('  ... is not a contract');
      const alias = await readAlias(undefined, aliasRender, context, path);
      return maybeStore(alias, address, aliases), alias;
    }
  }
}

export async function spider(
  cache: Cache,
  network: string,
  hre: HRE,
  relations: RelationConfigMap,
  roots: Roots,
  trace: TraceFn = debug
): Promise<Spider> {
  const context = {};
  const aliases = new Map();
  const contracts = new Map();

  for (const [alias, address] of roots) {
    await crawl(
      cache,
      network,
      hre,
      relations,
      { aliasRender: { template: alias, i: 0 }, address, path: [] },
      context,
      aliases,
      contracts,
      trace
    );

    // Add the aliasTemplate in place to the relative context
    (context[alias] = context[alias] || []).push(contracts.get(alias));
  }

  for (const [alias, address] of roots) {
    // Ensure roots are aliased, after we are done crawling (so as not to short circuit)
    maybeStore(alias, address, aliases);
  }

  return { roots, aliases, contracts };
}
