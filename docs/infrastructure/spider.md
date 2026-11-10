# Spider - Guide

A step-by-step guide to spider: the contract discovery mechanism inside the [Deployment Manager](deployment-manager.md) plugin.

---

## 0. Introduction

### Definition

Spider is a crawler over deployed contracts. Given a small set of committed root addresses and a set of relation rules, it reads getters and storage slots on-chain, follows every address it finds, and produces the complete map of a market's contracts, keyed by readable alias.

### Purpose

A market's contract set is large, chain-specific and changes over time: the Comet proxy and its implementation, the extension delegate, the asset list factory, the configurator and its admin, the timelock, the governor, COMP, the base token with its own proxy and admin, every collateral asset, a price feed per asset, rewards, bulker, and on L2s the bridge receiver and messengers. Mainnet USDC alone resolves to 97 aliases from 28 roots.

Maintaining that set by hand across ~28 markets on ~10 networks is not viable: every collateral addition, price feed swap or implementation upgrade would have to be mirrored into config files, and any missed edit turns into a test or a migration running against a stale address.

Spider inverts the problem. The repo commits only what cannot be derived - a few root addresses and the rules for walking between contracts - and the true state is read from the chain on every run. Consequences:

- **The chain is the source of truth.** An upgrade or a new collateral is picked up by the next crawl, with no repo change.
- **Consumers address contracts by name.** `dm.contract('comet')`, `dm.contract('WETH:priceFeed')`. No addresses appear in scenarios, migrations or scripts.
- **The same code works on every market.** Network-specific differences live in relation rules, not in the consuming code.

### Position in the system

Spider is one layer of the Deployment Manager, not a standalone tool. `DeploymentManager.spider()` prepares the inputs (archive cache, relation config, roots), calls the crawler and persists the outputs. Everything else - deploys, migrations, scenarios, scripts - consumes the alias map it produces.

```
   roots.json ─────────┐
   relations.ts ───────┤
                       ▼
   chain (RPC) ──▶  spider()  ──▶  aliases.json      (alias → address)
   explorer ─────▶  crawl()   ──▶  in-memory map     (alias → ethers Contract)
   archive ──────┘             └─▶  roots.json       (rewritten)
```

---

## 1. Key notes

| Term | Meaning |
| --- | --- |
| **root** | An alias → address pair the crawl starts from. Committed in `roots.json`. |
| **alias** | The name a contract is stored under: `comet`, `comet:implementation`, `USDC`, `WETH:priceFeed`. Unique within a market. |
| **alias template** | The rule producing an alias: a fixed string, a `.getter` reference, or a function. Also the key used to look up relation config. |
| **relation config** | `RelationConfigMap`: per contract, how to reach its implementation (`delegates`), which contracts it points to (`relations`), and which ABI to use (`artifact`). |
| **field** | Where an address is read from: a getter name, a storage `slot`, or a custom function. |
| **build file** | ABI, bytecode, source and compiler metadata for one address, from an explorer or a local artifact. |
| **context** (`ctx`) | Contracts discovered so far, grouped by alias template. Available to relation functions as they run. |
| **node** | One unit of work in the crawl: an address, its alias template, and the path of parents that led to it. |

---

## 2. Files

| File | Role |
| --- | --- |
| [`plugins/deployment_manager/Spider.ts`](../../plugins/deployment_manager/Spider.ts) | The crawler: `spider()`, `crawl()`, `maybeStore()`, `discoverNodes()`. |
| [`plugins/deployment_manager/RelationConfig.ts`](../../plugins/deployment_manager/RelationConfig.ts) | Config types, config lookup, `readField()`, `readAlias()`. |
| [`plugins/deployment_manager/DeploymentManager.ts`](../../plugins/deployment_manager/DeploymentManager.ts) | `spider()` wrapper: archive seeding, roots, persistence. `spiderOther()`, `fromDep()`. |
| [`plugins/deployment_manager/Import.ts`](../../plugins/deployment_manager/Import.ts) | Build files from Blockscout/Etherscan or local artifacts. |
| [`plugins/deployment_manager/ContractMap.ts`](../../plugins/deployment_manager/ContractMap.ts) | Build-file cache and archive seeding. |
| [`plugins/deployment_manager/Aliases.ts`](../../plugins/deployment_manager/Aliases.ts), [`Roots.ts`](../../plugins/deployment_manager/Roots.ts) | `aliases.json` and `roots.json`. |
| [`plugins/deployment_manager/Utils.ts`](../../plugins/deployment_manager/Utils.ts) | `mergeABI`, `mergeContracts`, `getEthersContract`. |
| [`tasks/spider/task.ts`](../../tasks/spider/task.ts) | The `spider` Hardhat task, and `--clean`. |
| [`tasks/scenario/task.ts`](../../tasks/scenario/task.ts) | The `scenario:spider` task (many bases, concurrently). |
| [`deployments/relations.ts`](../../deployments/relations.ts) | Base relation rules, shared by every market. |
| `deployments/<net>/<mkt>/relations.ts` | Per-market rules; spreads the base map and overrides it. |
| `deployments/<net>/<mkt>/roots.json` | Committed starting addresses. |
| [`hardhat.config.ts`](../../hardhat.config.ts) | `deploymentManager.networks.<net>.<mkt>` → relation map. |
| [`plugins/deployment_manager/test/SpiderTest.ts`](../../plugins/deployment_manager/test/SpiderTest.ts) | Unit test: a proxied `Dog` contract with two "pups". |

Outputs (both gitignored): `deployments/<net>/<mkt>/aliases.json` and `deployments/<net>/.contracts/<address>.json`.

---

## 3. Step 1 - Inputs

### Roots

`roots.json` holds the alias → address pairs the crawl starts from. Mainnet USDC has 28 (Comet, configurator, rewards, bulker and every L1 bridge endpoint used to reach L2 markets); a typical L2 market has 7 to 11 (Comet, configurator, rewards, bridge receiver, messengers, bulker).

Roots are written back on every run, so a root that the crawl also reaches through a relation stays consistent, and contracts passed to `spider(deployed)` are added permanently. This is how a deploy records its new addresses.

### Relation rules

Rules live in `deployments/relations.ts` (shared) and `deployments/<net>/<mkt>/relations.ts` (per market). Each per-market file spreads the base map and overrides individual keys:

```ts
import baseRelationConfig from '../../relations';

export default {
  ...baseRelationConfig,
  governor: { artifact: 'contracts/bridges/optimism/OptimismBridgeReceiver.sol:OptimismBridgeReceiver' },
  OssifiableProxy: { artifact: 'contracts/interfaces/ERC20.sol:ERC20', delegates: { field: { slot: '0x3608…' } } },
};
```

`getRelationConfig` returns the per-market map when one is registered in `hardhat.config.ts`, otherwise the base map. The two are never merged at runtime - the spread in the market's own file is what combines them.

### Config shape

```ts
{
  [aliasTemplateOrContractNameOrAddress]: {
    artifact?: string,                 // use this local ABI instead of the explorer's
    delegates?: RelationInnerConfig,   // where the implementation address lives
    relations?: {                      // contracts reachable from this one
      [aliasTemplate: string]: {
        field?: string | { key } | { slot } | { getter },
        alias?: string | function | (string | function)[],
      },
    },
  },
}
```

A relation with no `field` calls a getter named after the relation key itself. A relation with no `alias` uses the relation key as the alias.

---

## 4. Step 2 - Invocation

```bash
npx hardhat spider --network mainnet --deployment usdc   # one market
yarn hardhat scenario:spider --bases mainnet,base-usdc    # several, concurrently
yarn hardhat scenario:spider                              # every configured base
npx hardhat spider --clean                                # delete aliases.json + build-file caches
```

In code:

```ts
const dm = new DeploymentManager('base', 'usdc', hre, { writeCacheToDisk: true });
await dm.spider();                       // crawl and persist
await dm.spider(deployedContracts);      // crawl, adding fresh deploys as roots
const other = await dm.spiderOther('mainnet', 'usdc');   // another market
```

`scenario:spider` runs bases through `Promise.allSettled`, so one base failing (a flaky RPC, an explorer returning 500s) does not abandon the others; the task fails at the end, naming each base that failed. Concurrent runs are safe because cache writes go to a temp file and are then renamed.

---

## 5. Step 3 - The `DeploymentManager.spider()` entry point

1. **Seed the build-file cache** - `seedArchiveCache(cache, network)` copies every archived build file for the network out of the `plugins/import/contracts-archive` submodule into `deployments/<net>/.contracts/`, skipping addresses already cached. Most ABIs are then local before the crawl starts.
2. **Resolve the relation config** for this network/deployment.
3. **Assemble roots** - `roots.json` merged with any `deployed` contracts passed in.
4. **Crawl** - `spider(cache, network, hre, relations, roots, trace)`.
5. **Persist** - write `roots.json` and `aliases.json`, keep the contract map in memory as `contractsCache`.

---

## 6. Step 4 - The crawl

### Traversal

`spider()` iterates roots in file order. Each root becomes a node (`{ address, aliasRender, path: [] }`) and is passed to `crawl()`, which is recursive and fully sequential: one contract at a time, depth first. After each root finishes, its contract is added to the context under its own alias.

Once all roots are crawled, every root alias is stored again, so a root that was reached under a different name still ends up recorded.

### Resolving config for an address

`crawl()` tries, in order:

| # | Lookup | Example |
| --- | --- | --- |
| 1 | by **address** (lowercased) | `'0xaf88d065…': { artifact: 'ERC20', delegates: {…} }` on Arbitrum |
| 2 | by **alias template** | `comet`, `governor`, `COMP` |
| 3 | by **verified contract name** (requires fetching the build file first) | `FiatTokenProxy`, `TransparentUpgradeableProxy`, `OssifiableProxy` |
| 4 | by **resolved alias** | `wstETH`, after `symbol()` has been read |
| 5 | none - record the contract, do not recurse | any unremarkable token |

Step 3 only happens for addresses with code; `isContract()` checks `getCode(address) !== '0x'`. An address with no code (an EOA such as an admin or a guardian) is recorded as an alias and never crawled.

When a matched config carries `artifact`, the ABI comes from a local Hardhat artifact instead of the explorer, and it is always read fresh (never from the build-file cache).

### Processing a contract

`maybeProcess()` runs only when the alias is new:

1. **Delegates.** If `delegates` is set, read the implementation address, crawl it under `<alias>:implementation`, then merge the two ABIs with `mergeContracts` so the proxy exposes both. The implementation is also added to the context.
2. **Store** the resulting contract under its alias.
3. **Relations.** For each entry in `relations`, read its addresses, crawl each one, and add the results to the context under the relation key.

If the alias was already seen, the whole subtree is skipped (`Visited <address>: <alias> already, skipping`). Deduplication is by alias, not address, so one contract reachable under two aliases is crawled twice.

### Reading addresses (`readField`)

| Form | Behaviour |
| --- | --- |
| `field: 'someGetter'` or `{ key: 'someGetter' }` | Static call to a no-argument getter. |
| `field: { slot: '0x…' }` | `getStorageAt`, taking the last 20 bytes as an address. |
| `field: async (contract, ctx) => …` | Custom logic. May return one address, an array, or `null` for none. |
| no `field` | The relation key is used as the getter name. |

Returned values pass through `asAddressArray`, so a single address, an array, or `null` are all valid; anything else throws.

The storage slots in use across the repo:

| Slot | Meaning | Uses |
| --- | --- | --- |
| `0x360894a1…` | EIP-1967 implementation | 91 |
| `0xb5312768…` | EIP-1967 admin | 2 |
| `0x10d6a54a…` | legacy/OZ admin | 2 |
| `0xbaab7dbf…`, `0xa3f0ad74…`, `0x7050c9e0…` | token-specific implementation/admin slots | 1-2 each |

### Producing aliases (`readAlias`)

| Form | Behaviour |
| --- | --- |
| `alias: 'name'` | Fixed string. |
| `alias: '.symbol'` | Calls that getter on the contract and uses the result. |
| `alias: async (contract, ctx, i, path) => …` | Custom. `i` is the index within a multi-address relation; `path` is the chain of parent contracts. |
| array of the above | Applied per index (`templates[i % templates.length]`). |
| no `alias` | The relation key. |

Examples from the base rules: `baseToken` is named by its own `symbol()`; `assetPriceFeeds[i]` is named `` `${await assets[i].symbol()}:priceFeed` `` from the context; `fiatTokenAdmin` is named `` `${await token.symbol()}:admin` `` from `path[0]`.

### Context and ordering

`ctx` maps an alias template to the contracts discovered under it (`ctx.comet[0]`, `ctx.assets[i]`). It is filled as the crawl proceeds, so a rule can only use what has already been crawled. Two consequences:

- **Key order inside `relations` matters.** `baseTokenPriceFeed`'s alias reads `baseToken` from the context, so `baseToken` must be listed first.
- **Root order matters.** `configurator.cometFactory` calls `configurator.factory(ctx.comet[0].address)`, so `comet` must appear before `configurator` in `roots.json`.

### Alias conflicts

`maybeStore` enforces uniqueness:

- same alias, same address → no-op, subtree skipped;
- alias currently zero address, new address non-zero → overwritten;
- same alias, different non-zero address → `Error: Had <alias> -> <a>, not <b>`.

---

## 7. Step 5 - ABI sources

For each address that needs an ABI, in order:

1. **Local build-file cache** - `deployments/<net>/.contracts/<address>.json`, pre-seeded from the archive submodule.
2. **Explorer** - Blockscout for `mainnet`, `unichain`, `scroll`, `optimism`, `base`, `arbitrum`, `ronin`; Etherscan V2 for the rest (`polygon`, `linea`, `mantle`). Retries with doubling delay capped at 10s; `Contract source code not verified` fails immediately. Results are written back to the cache.
3. **Local artifact** - when the matched config sets `artifact`.

Spider therefore depends on contracts being verified. This is why the deploy task verifies eagerly, and why the archive submodule exists: it removes most explorer traffic and survives outages. See [contract import](../contract-import.md) and [contracts archive](../contracts-archive.md).

`artifact` overrides in use: 88 entries pointing at `ERC20` (tokens whose own ABI is a proxy), plus bridge receivers per chain, `IWstETH`, `IProxy`, `IGovernorBravo`, `IComp`, and the two Comet ones - `CometWithExtendedAssetList` for `comet:implementation` and `CometExt` for `comet:implementation:implementation`, so every market exposes the current interface even where the deployed implementation predates it.

---

## 8. Step 6 - The discovered contract set

From the base rules:

```
comptrollerV2 ──delegates→ comptrollerV2:implementation

comet ──delegates(1967 slot)→ comet:implementation ──delegates→ comet:implementation:implementation
  ├ baseToken            alias = symbol()          → <SYM>:implementation, <SYM>:admin (FiatTokenProxy)
  ├ cometExt, assetListFactory
  ├ baseTokenPriceFeed   alias = '<SYM>:priceFeed'
  ├ assets[i]            alias = symbol()          (loops getAssetInfo(i))
  ├ assetPriceFeeds[i]   alias = '<asset>:priceFeed'
  └ cometAdmin (admin slot) → timelock (owner) → governor (admin) → COMP

configurator ──delegates→ configurator:implementation
  ├ configuratorAdmin (admin slot)
  └ cometFactory        configurator.factory(comet)

rewards → rewardToken   alias = symbol(), skipped while unset (zero address)
```

Per-market files add: bridge endpoints (`fxRoot` → `stateSender`, L1/L2 messengers and gateways), proxy types for collateral tokens (`UUPSProxy`, `OssifiableProxy`, `AdminUpgradableProxy`, `ClonableBeaconProxy`, `ERC1967Proxy`, `AppProxyUpgradeable`), `wstETH` → `stETH`, and on L2s a `governor` that is the chain's bridge receiver rather than Governor Bravo.

---

## 9. Step 7 - Consuming the output

`aliases.json` is a flat name → address map; the in-memory map holds one ethers `Contract` per alias, proxies already merged with their implementations.

```ts
const comet = await dm.contract('comet');
const feed  = await dm.contract('WETH:priceFeed');
const all   = await dm.getContracts();
```

Callers of spider across the repo:

| Caller | Purpose |
| --- | --- |
| `tasks/spider/task.ts` | The `spider` task. |
| `tasks/scenario/task.ts` | `scenario:spider`, and `scenario --spider`. |
| `tasks/deployment_manager/task.ts` | `deploy`, `migrate`, `deploy_and_migrate` spider the market and, for L2s, the mainnet governance market. |
| `DeploymentManager.runDeployScript` | Crawls before and after the deploy script to produce the address diff. |
| `DeploymentManager.contracts()` | Crawls implicitly if nothing is loaded. |
| `plugins/scenario/Runner.ts` | Crawls the auxiliary (governance) deployment. |
| `scenario/context/CometContext.upgrade()` | Re-crawls after deploying a new Comet. |
| `scenario/utils/index.ts` | Crawls the Tenderly virtual-testnet deployments. |
| ~14 `*_configurate_and_ens.ts` migrations | Re-crawl after reward config is set, to pick up the L2 COMP. |
| `scripts/` | Liquidation bot, `vote-queue-execute`, fork seeding, multistream cache warming. |
| `.github/workflows/run-scenarios.yaml` | Crawls mainnet (always) and, under multistream, every selected base. |
| `.github/workflows/sync-contracts-archive.yaml` | Crawls every market, then commits newly fetched build files into the archive. |

Mainnet is always crawled first, because every L2 scenario depends on it as `auxiliaryBase`.

---

## 10. Step 8 - Extending the rules

### A new collateral is not picked up correctly

The asset itself needs no rule - `comet.assets` finds it and `symbol()` names it. Rules are needed when its ABI is wrong or its proxy hides the implementation.

| Symptom | Fix |
| --- | --- |
| Methods missing, or the price feed's ABI looks like a proxy | Add a rule keyed by the verified contract name: `MyProxy: { artifact: 'contracts/interfaces/ERC20.sol:ERC20', delegates: { field: { slot: '0x3608…' } } }`. |
| `Contract source code not verified` | Add `artifact:` so no explorer ABI is needed, or get the contract verified. |
| The contract name is too generic to key on (`Proxy`, `TransparentUpgradeableProxy` used by several tokens with different needs) | Key the rule by address instead, as the Arbitrum market does. |
| `Had <alias> -> <a>, not <b>` | Two contracts resolve to the same alias; give one an explicit distinct `alias`. |
| `symbol()` reverts on a fork | Follow the existing fallbacks in `deployments/relations.ts` and `RelationConfig.readKey`, which map specific addresses to known symbols. |

### A new contract should be reachable

Add it to `relations` on whichever contract points at it, with the field it is read from and the alias it should take. Place the entry after anything its alias or field function reads from the context. If nothing on-chain points at it, add it to `roots.json` instead.

### Verifying a change

```bash
DEBUG=1 npx hardhat spider --network <net> --deployment <mkt>
git diff --stat deployments/<net>/<mkt>/roots.json    # should usually be empty
```

`aliases.json` is gitignored, so inspect it directly rather than through git. With `DEBUG` set, each visit logs `Crawled <address>: <alias>` or `Visited … already, skipping`.

---

## 11. Operational notes

- **Cost.** The crawl is sequential, one contract at a time; concurrency exists only across bases in `scenario:spider`. A cold mainnet USDC run touches ~97 contracts. The archive removes most explorer calls; RPC calls remain.
- **Fork stability.** Rules run against whatever provider the `hre` points at. Some proxies that work on a live network revert under a Hardhat fork, which is why the symbol fallbacks exist.
- **`roots.json` churn.** Any crawl rewrites the file. Deployments deliberately add entries; unrelated diffs there are worth a second look before committing.
- **Uncached cross-market crawls.** `spiderOther` and `fromDep` build a new Deployment Manager and crawl the other market on every call. A deploy script pulling ten contracts with `fromDep` crawls that market ten times.
- **`--clean` is blunt.** It removes every `aliases.json` and every `.contracts` cache, so the next run re-fetches everything not in the archive. It also fails if no `aliases.json` matches the glob.
- **Stale docs.** The spider section in the root [`README.md`](../../README.md) predates the current implementation: it describes `relations.json`, `pointers.json` and an `@`/`+` alias syntax. The code uses `relations.ts`, `aliases.json` and the alias forms in section 6.

---

## 12. Function reference

### `Spider.ts`

| Function | What it does |
| --- | --- |
| `spider(cache, network, hre, relations, roots, trace)` | Entry point. Crawls each root in order, adds each root's contract to the context, re-stores every root alias afterwards, and returns `{ roots, aliases, contracts }`. |
| `crawl(...)` *(internal)* | Visits one node: resolves its config (address → alias template → contract name → resolved alias), builds its contract from a local artifact or an explorer build file, derives its alias, and hands off to `maybeProcess`. Addresses with no code are recorded only. |
| `maybeProcess(alias, build, config)` *(internal, inside `crawl`)* | For a new alias: crawls and merges the delegate, stores the contract, then crawls each relation and records the results in the context. Skips everything for an alias already seen. |
| `maybeStore(alias, address, into)` *(internal)* | Records alias → address. Returns `false` for an exact repeat, overwrites a zero address, throws on a real conflict. |
| `discoverNodes(path, contract, context, config, defaultKeyAndTemplate)` *(internal)* | Reads a relation's addresses and pairs each with its alias template (by index) and the parent path. |
| `isContract(hre, address)` *(internal)* | Whether the address has code. |
| `localBuild(cache, hre, artifact, network, address)` *(internal)* | Build file from a local Hardhat artifact, bypassing the cache. |
| `remoteBuild(cache, hre, network, address)` *(internal)* | Build file from the cache or an explorer. |

### `RelationConfig.ts`

| Function | What it does |
| --- | --- |
| `getRelationConfig(dmConfig, network, deployment)` | The market's relation map, falling back to the base map; throws if neither is configured. |
| `getFieldKey(config, defaultKey?)` | Normalises `field` into `{ key }`, `{ slot }` or `{ getter }`, defaulting to the relation's own name as a getter. |
| `readField(contract, fieldKey, context)` | Resolves a field to an address array: storage read, static call, or custom function. |
| `readAlias(contract, aliasRender, context, path)` | Resolves an alias: fixed string, `.getter` call, or custom function. |
| `aliasTemplateKey(template)` | The config-lookup key for an alias template: the string, or a named function's name. |
| `asAddressArray(val, msg)` *(internal)* | Normalises `null` / string / string[] into an address array; throws otherwise. |
| `readKey(contract, fnName)` *(internal)* | Static call to a no-argument getter, with a hardcoded `tETH` symbol fallback for one address that reverts on forks. |

### Deployment Manager entry points

| Method | What it does |
| --- | --- |
| `spider(deployed = {})` | Seeds the archive cache, resolves config and roots, crawls, persists `roots.json` and `aliases.json`, caches contracts in memory. |
| `spiderOther(network, deployment)` | Crawls another market through a fresh Deployment Manager. Not cached. |
| `fromDep(alias, network, deployment, otherAlias)` | Crawls another market and adopts one of its contracts under an alias here. |
| `contracts()` | Returns the alias → contract map, crawling first if nothing is loaded. |

---

## 13. Related docs

- [Deployment Manager](deployment-manager.md) - the plugin spider is part of.
- [`docs/contract-import.md`](../contract-import.md) - explorer import details and Blockscout flakiness.
- [`docs/contracts-archive.md`](../contracts-archive.md) - the build-file archive submodule and its sync workflow.
- [`SCENARIO.md`](../../SCENARIO.md) - how scenarios use spider, including `scenario:spider` and multistream.
- The code: [`plugins/deployment_manager/Spider.ts`](../../plugins/deployment_manager/Spider.ts).
