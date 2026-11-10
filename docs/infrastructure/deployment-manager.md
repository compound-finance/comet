# Deployment Manager - Guide

A step-by-step guide to the `plugins/deployment_manager` Hardhat plugin: its purpose, its parts, and how each of them is used in this repo.

---

## 0. Introduction

### Definition

The Deployment Manager (DM) is the access layer between the repo's tooling - deploy scripts, migrations, scenarios, scripts, CI - and the deployed protocol. One `DeploymentManager` instance represents exactly one market on one network (e.g. `base` / `usdc`) and provides:

- **the market's contract set** - discovered from the chain by the [spider](spider.md), not maintained by hand;
- **a usable handle per contract** - an ethers `Contract` whose ABI comes from a block explorer or a local artifact;
- **idempotent creation helpers** - deploy, clone and import operations that record everything they create;
- **a migration lifecycle** - governance proposals with a prepare → enact flow;
- **source verification** of what it deployed.

### Purpose

Compound III runs one Comet per base asset per chain (~28 markets across ~10 networks). Each market is a web of contracts: the Comet proxy and implementation, the extension delegate, the configurator, the admin, the timelock, the governor, COMP, the base token, every collateral asset, every price feed, rewards, bulker, and bridge contracts on L2s. Maintaining those addresses by hand would go stale with every upgrade, collateral addition or price feed swap.

The purpose of the plugin is to make that set derivable rather than declared. The repo commits only root addresses and relation rules; the DM reconstructs the full picture from the chain on every run, and consumers refer to contracts by name (`dm.contract('comet')`) instead of by address.

### Consumers


| Consumer                                         | How                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `tasks/deployment_manager/task.ts`               | `deploy`, `migrate`, `deploy_and_migrate`, `gen:migration`, `publish` Hardhat tasks |
| `tasks/spider/task.ts`, `tasks/scenario/task.ts` | `spider`, `scenario:spider`                                                         |
| `deployments/<network>/<market>/deploy.ts`       | Market deploy scripts receive a DM                                                  |
| `deployments/<network>/<market>/migrations/*.ts` | Governance migrations receive a market DM + governance DM                           |
| `src/deploy/`                                    | Shared `deployComet` / `deployNetworkComet` helpers built on DM methods             |
| `plugins/scenario/`, `scenario/`                 | Scenario world, `CometContext`, `MigrationConstraint`, Tenderly helpers             |
| `scripts/`                                       | Liquidation bot, `vote-queue-execute`, multistream, fork seeding                    |
| CI workflows                                     | `run-scenarios.yaml`, `sync-contracts-archive.yaml`, `deploy-market`                |




### Architecture

```
             committed in repo                         generated (gitignored)
  ┌──────────────────────────────────┐        ┌──────────────────────────────────┐
  │ deployments/<net>/<mkt>/          │        │ deployments/<net>/<mkt>/          │
  │   roots.json      (start points)  │──┐     │   aliases.json   (name → address) │
  │   relations.ts    (crawl rules)   │  │     │ deployments/<net>/.contracts/     │
  │   configuration.json (market cfg) │  │     │   <address>.json (ABI + source)   │
  │   deploy.ts       (deploy script) │  │     │   verify/args.json (lazy verify)  │
  │   migrations/*.ts (gov proposals) │  │     └──────────────────────────────────┘
  └──────────────────────────────────┘  │                     ▲
                                        ▼                     │
                              ┌──────────────────────┐        │
       block explorer ───────▶│  DeploymentManager   │────────┘
       (Etherscan/Blockscout) │  network + deployment│
       contracts-archive ────▶│  spider / deploy /   │──▶ ethers Contracts by alias
       RPC (chain state) ────▶│  migrate / verify    │
                              └──────────────────────┘
```

---



## 1. Key notes

Read this once; the rest of the guide uses these terms precisely.


| Term                        | Meaning                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **network**                 | Hardhat network name: `mainnet`, `base`, `arbitrum`, `optimism`, `polygon`, `scroll`, `linea`, `mantle`, `unichain`, `ronin`.                                     |
| **deployment**              | Market name within a network: `usdc`, `weth`, `usdc.e`, … Directory `deployments/<network>/<deployment>/`.                                                        |
| **alias**                   | Human name for a contract inside a deployment: `comet`, `comet:implementation`, `USDC`, `WETH:priceFeed`, `governor`.                                             |
| **root**                    | An alias → address pair the crawl starts from. Stored in `roots.json`.                                                                                            |
| **relation config**         | Rules telling the spider how to go from one contract to the next (getter, storage slot, custom function) and what to name it.                                     |
| **build file**              | JSON with a contract's ABI, bytecode, source and compiler metadata. Fetched from an explorer or built from a local Hardhat artifact.                              |
| **spider**                  | The crawler that turns roots + relations into the full alias → contract map.                                                                                      |
| **Deployed**                | `{ [alias]: Contract }` - what a deploy script returns. Those contracts become new roots.                                                                         |
| **migration**               | A script that changes the live protocol, usually by creating a governance proposal.                                                                               |
| **governance DM** (`govDm`) | The DM for the market that owns governance. For L2 markets this is the mainnet market named in the base's `auxiliaryBase`; for mainnet markets it is the same DM. |
| **artifact (migration)**    | JSON output of a migration's `prepare` step, stored so `enact` can run later.                                                                                     |
| **verify args**             | Everything needed to verify a deployed contract on the explorer later (lazy verification).                                                                        |

---



## 2. Files in this plugin

Ordered by how central each file is, not alphabetically.


| File                                           | Responsibility                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Core**                                       |                                                                                                                         |
| `DeploymentManager.ts`                         | The class every consumer touches. One instance = one market on one network. Everything else is a helper it calls.       |
| **Discovery** (finding the market's contracts) |                                                                                                                         |
| `Spider.ts`                                    | The crawler: roots + relations → the full alias → contract map.                                                         |
| `RelationConfig.ts`                            | Relation config types, lookup of the right config map, reading fields and aliases off contracts.                        |
| `Import.ts`                                    | Fetch a build file from Blockscout/Etherscan (with retries), or build one from a local Hardhat artifact.                |
| `ContractMap.ts`                               | Read/write build files in `deployments/<net>/.contracts/`, seed them from the contracts-archive submodule.              |
| `Aliases.ts`                                   | Read/write `aliases.json`, add a single alias, invert the map.                                                          |
| `Roots.ts`                                     | Read/write `roots.json`.                                                                                                |
| **Deploying and verifying**                    |                                                                                                                         |
| `Deploy.ts`                                    | Low-level deploy from a Hardhat artifact or from a build file, plus verification hook.                                  |
| `Verify.ts`                                    | Verification entry point and strategies (`none`, `eager`, `lazy`).                                                      |
| `ManualVerify.ts`                              | Explorer verification for contracts deployed from a build file (not compiled locally). Copied from `hardhat-etherscan`. |
| `VerifyArgs.ts`                                | Read/write the lazy-verification queue `verify/args.json`.                                                              |
| **Migrations**                                 |                                                                                                                         |
| `Migration.ts`                                 | `Migration` class, `migration()` constructor, loading migration files.                                                  |
| `Enacted.ts`                                   | Rewrites a migration file to add `enacted() { return true }` after it has been executed.                                |
| `MigrationTemplate.ts`                         | Template used by `gen:migration`.                                                                                       |
| **Infrastructure**                             |                                                                                                                         |
| `Cache.ts`                                     | Two-level (memory + disk) key/value store rooted at `deployments/`. Handles every file path the plugin touches.         |
| `NonceManager.ts`                              | ethers `NonceManager` subclass: adds EIP-712 signing and resets the nonce on a failed send.                             |
| `Utils.ts`                                     | ABI merging, build-file helpers, timeouts, `debug` logging, tx cost.                                                    |
| `DiffState.ts`                                 | Snapshot and diff a Comet's configuration between two blocks.                                                           |
| **Types, exports, tests**                      |                                                                                                                         |
| `Types.ts`                                     | Shared types (`BuildFile`, `Alias`, `Address`, `TraceFn`, …).                                                           |
| `type-extensions.ts`                           | Adds the `deploymentManager` key to Hardhat's config type (`relationConfigMap` + per-network/deployment maps).          |
| `index.ts`                                     | Public exports: `DeploymentManager`, `Deployed`, `Migration`, `migration`, `VerifyArgs`, `diffState`, `debug`.          |
| `test/`                                        | Unit tests for every module (run as part of `yarn test`).                                                               |


---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `index.ts`             | Public exports: `DeploymentManager`, `Deployed`, `Migration`, `migration`, `VerifyArgs`, `diffState`, `debug`.          |
| `type-extensions.ts`   | Adds the `deploymentManager` key to Hardhat's config type (`relationConfigMap` + per-network/deployment maps).          |
| `DeploymentManager.ts` | The class. Everything else is a helper it calls.                                                                        |
| `Cache.ts`             | Two-level (memory + disk) key/value store rooted at `deployments/`. Handles every file path the plugin touches.         |
| `Roots.ts`             | Read/write `roots.json`.                                                                                                |
| `Aliases.ts`           | Read/write `aliases.json`, add a single alias, invert the map.                                                          |
| `ContractMap.ts`       | Read/write build files in `deployments/<net>/.contracts/`, seed them from the contracts-archive submodule.              |
| `Import.ts`            | Fetch a build file from Blockscout/Etherscan (with retries), or build one from a local Hardhat artifact.                |
| `RelationConfig.ts`    | Relation config types, lookup of the right config map, reading fields and aliases off contracts.                        |
| `Spider.ts`            | The crawler.                                                                                                            |
| `Deploy.ts`            | Low-level deploy from a Hardhat artifact or from a build file, plus verification hook.                                  |
| `Verify.ts`            | Verification entry point and strategies (`none`, `eager`, `lazy`).                                                      |
| `ManualVerify.ts`      | Explorer verification for contracts deployed from a build file (not compiled locally). Copied from `hardhat-etherscan`. |
| `VerifyArgs.ts`        | Read/write the lazy-verification queue `verify/args.json`.                                                              |
| `Migration.ts`         | `Migration` class, `migration()` constructor, loading migration files.                                                  |
| `MigrationTemplate.ts` | Template used by `gen:migration`.                                                                                       |
| `Enacted.ts`           | Rewrites a migration file to add `enacted() { return true }` after it has been executed.                                |
| `NonceManager.ts`      | ethers `NonceManager` subclass: adds EIP-712 signing and resets the nonce on a failed send.                             |
| `DiffState.ts`         | Snapshot and diff a Comet's configuration between two blocks.                                                           |
| `Utils.ts`             | ABI merging, build-file helpers, timeouts, `debug` logging, tx cost.                                                    |
| `Types.ts`             | Shared types (`BuildFile`, `Alias`, `Address`, `TraceFn`, …).                                                           |
| `test/`                | Unit tests for every module (run as part of `yarn test`).                                                               |


---



## 3. Step 1 - Market file layout

Every market lives in `deployments/<network>/<deployment>/`:


| File                         | Committed?          | Who writes it           | Purpose                                                                                                    |
| ---------------------------- | ------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `roots.json`                 | yes                 | spider / deploy         | Starting addresses for the crawl. Rewritten on every spider run; a deploy adds its new contracts here.     |
| `relations.ts`               | yes                 | human                   | Market-specific crawl rules. Always spreads the shared `deployments/relations.ts` and adds overrides.      |
| `configuration.json`         | yes                 | human                   | Market parameters (rates, assets, caps). Read by `dm.readConfig()` → `src/deploy/NetworkConfiguration.ts`. |
| `deploy.ts`                  | yes                 | human                   | Default-exported deploy function, run by `dm.runDeployScript()`.                                           |
| `migrations/*.ts`            | yes                 | `gen:migration` + human | Governance changes.                                                                                        |
| `artifacts/<migration>.json` | **no** (gitignored) | `migrate --prepare`     | Output of a migration's `prepare` step.                                                                    |
| `aliases.json`               | **no** (gitignored) | spider                  | Full alias → address map.                                                                                  |
| `verify/args.json`           | no                  | lazy verification       | Queue of contracts waiting to be verified.                                                                 |


Shared per network: `deployments/<network>/.contracts/<address>.json` (gitignored) - the build-file cache every market on that network uses.

Shared per repo: `deployments/relations.ts` - the base relation rules. `hardhat.config.ts` (`deploymentManager` key, ~line 427) maps every network/deployment to its `relations.ts`.

> **Note:** `Cache` lowercases every path segment, so build files are stored as `.contracts/<lowercase address>.json`.

---



## 4. Step 2 - Instantiate a DeploymentManager

```ts
import { DeploymentManager } from '../../plugins/deployment_manager';

const dm = new DeploymentManager('base', 'usdc', hre, {
  writeCacheToDisk: true,          // persist aliases/roots/build files; false = memory only
  verificationStrategy: 'eager',   // 'none' | 'eager' | 'lazy'
  importRetries: 4,                // explorer fetch retries (default 4)
  importRetryDelay: 5_000,         // first retry delay in ms (default 5s, doubles, capped at 10s)
  saveBytecode: false,             // stash deploy bytecode for Tenderly simulations
  baseDir: undefined,              // defaults to <cwd>/deployments
});
```

What to pick:

- `writeCacheToDisk` - `true` for anything real (deploy, migrate, spider tasks, scenarios). The `deploy`/`migrate` tasks set it to `false` under `--simulate` (unless `--overwrite`), so a simulation never touches committed files.
- `verificationStrategy` - `eager` verifies right after each deploy; `lazy` only records verify args for later; `none` (or unset) does nothing. Tasks use `eager` for real runs and `lazy` for simulations.
- `hre` - pass the Hardhat runtime for the right network. For forks, the tasks build one with `hreForBase(base)` from `plugins/scenario/utils/hreForBase.ts`.

Creating the object does no I/O. Nothing is loaded until you ask for contracts.

---



## 5. Step 3 - Load the market's contracts

There are three ways to populate a DM, from slowest/most-correct to fastest:


| Call                                        | What it does                                                                                     | Network cost                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `await dm.spider()`                         | Full crawl from roots on the live chain. Rewrites `roots.json` and `aliases.json`.               | RPC calls + explorer fetches for anything not cached |
| `await dm.loadContractsFromExistingCache()` | Rebuilds contracts from existing `aliases.json` + `.contracts/` files. No crawl.                 | none                                                 |
| `await dm.contracts()`                      | Returns the in-memory map; **silently runs** `spider()` **the first time** if nothing is loaded. | depends                                              |


Then read contracts:

```ts
const comet = await dm.contract('comet');                  // undefined if missing
const comet = await dm.getContractOrThrow('comet');        // throws "<net>/<dep> deployment missing comet"
const { comet, configurator, USDC } = await dm.getContracts(); // all, as an object
```

Every returned contract is already connected to the DM's default signer (or the one you pass).

**Rule of thumb:** call `spider()` once at the start of anything that must reflect current chain state (tasks, migrations after they change state). Scenarios call `loadContractsFromExistingCache()` first, then spider during deploy.

---



## 6. Step 4 - Contract discovery (spider)

Discovery has its own guide: **[Spider](spider.md)**. The summary below covers what a caller of `dm.spider()` needs; the guide covers the relation rule syntax, the crawl itself, and how to extend the rules.

`dm.spider(deployed = {})` performs, in order:

1. **Seed the build-file cache** from the `plugins/import/contracts-archive/<network>/.contracts/` submodule (`seedArchiveCache`), so most ABIs are local before the crawl begins.
2. **Resolve the relation config** for this network/deployment (`getRelationConfig`): the per-market map when one is registered in `hardhat.config.ts`, otherwise the base `relationConfigMap`. They are not merged at runtime - each per-market `relations.ts` spreads the base itself.
3. **Assemble the roots**: `roots.json` plus every contract in `deployed`, which is how freshly deployed contracts become roots.
4. **Crawl** (`Spider.ts`), reading getters and storage slots to walk from each root through the market's contracts. Config for each address is matched by address, then alias template, then verified contract name, then resolved alias. Addresses without code are recorded but not followed.
5. **Persist** `roots.json` and `aliases.json`, and keep the alias → contract map in memory.

What the base rules produce for every market:

```
comet ─(EIP-1967 slot)→ comet:implementation ─→ comet:implementation:implementation (CometExt)
  ├ baseToken (alias = symbol) → <SYM>:implementation, <SYM>:admin for FiatTokenProxy
  ├ cometExt, assetListFactory
  ├ baseTokenPriceFeed → '<SYM>:priceFeed'
  ├ assets[i]          → '<asset symbol>'
  ├ assetPriceFeeds[i] → '<asset symbol>:priceFeed'
  └ cometAdmin (admin slot) → timelock → governor → COMP
configurator → configurator:implementation, configuratorAdmin, cometFactory
rewards → rewardToken
comptrollerV2 → comptrollerV2:implementation
```

Per-market files add bridges (`fxRoot`, L1/L2 messengers), token proxy types (`UUPSProxy`, `OssifiableProxy`, …) and, on L2s, replace `governor` with the bridge receiver.

Running it directly:

```bash
npx hardhat spider --network mainnet --deployment usdc   # one market
yarn hardhat scenario:spider --bases mainnet,base-usdc    # several, concurrently
yarn hardhat scenario:spider                              # every configured base
npx hardhat spider --clean                                # delete all aliases.json + .contracts caches
```

---



## 7. Step 5 - ABI sources (import)

Whenever the DM needs an ABI for an address it goes through `Import.ts`:

1. **Local cache** - `deployments/<net>/.contracts/<address>.json` (seeded from the archive submodule).
2. **Explorer** - Blockscout for `mainnet`, `unichain`, `scroll`, `optimism`, `base`, `arbitrum`, `ronin`; Etherscan V2 for everything else (`polygon`, `linea`, `mantle`, …). Retries with doubling delay capped at 10s. `Contract source code not verified` fails immediately.
3. The result is written back to the cache.

Alternatively, a relation with `artifact:` builds the build file from a local Hardhat artifact (`readContract`) - used for proxies whose explorer ABI is useless and for interfaces we want to force (e.g. `CometWithExtendedAssetList`, `CometExt`, `IGovernorBravo`).

Direct helpers on the DM:


| Method                                  | Use                                                    |
| --------------------------------------- | ------------------------------------------------------ |
| `dm.import(address, network)`           | Fetch + cache a build file.                            |
| `dm.cast(address, 'contracts/X.sol:X')` | Wrap an address with a local artifact ABI, no caching. |


Needs env keys: `ETHERSCAN_KEY` and the per-network RPC links (see `.env.example`).

---



## 8. Step 6 - Deploy contracts

All deploy helpers are **idempotent by alias**: if the alias already exists in the DM, nothing is deployed and the existing contract is returned (unless `force`).


| Method                                                                          | What it does                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dm.deploy(alias, 'path/under/contracts/X.sol', args, force?, retries?)`        | Compile-artifact deploy. Records the alias.                                                                                                                              |
| `dm.clone(alias, sourceAddress, args, fromNetwork='mainnet', force?, retries?)` | Import another chain's verified contract and deploy its bytecode here. Treats a zero-address alias as missing.                                                           |
| `dm.existing(alias, address | addresses[], network='mainnet', artifact?)`       | Register an already-deployed contract under an alias. Multiple addresses are merged into one proxy contract (implementation ABI + proxy ABI).                            |
| `dm.fromDep(alias, network, deployment, otherAlias=alias)`                      | Pull a contract from **another market's** DM (spiders that market). Used when a new market reuses shared infra (admin, factory, configurator, rewards, bridge receiver). |
| `dm.putAlias(alias, contract)`                                                  | Record an alias manually.                                                                                                                                                |
| `dm.idempotent(condition, action, retries?)`                                    | Run `action` only if `condition()` is truthy. Used for "set X if not already X" config calls.                                                                            |


Under the hood (`Deploy.ts`):

- Artifact deploys use the current gas price × 1.2, save the build file to `.contracts/`, and handle verification per strategy.
- Build-file deploys (clones) use the stored bytecode/ABI and verify through `ManualVerify.ts`.
- Each deploy increments `dm.counter`; each traced tx adds to `dm.spent` (ETH).



### Running a market deploy script

A market's `deploy.ts` default-exports `async (dm, deploySpec) => Deployed`. Most delegate to `deployComet` in `src/deploy/`.

`dm.runDeployScript(deploySpec)`:

1. spiders (the "old" state),
2. imports and runs `deployments/<net>/<dep>/deploy.ts`,
3. spiders again with the returned `Deployed` as extra roots (so they land in `roots.json`),
4. returns a delta; `dm.diffDelta(delta)` prints added/removed addresses.

```bash
npx hardhat deploy --network base --deployment usdc --simulate   # fork, no disk writes, lazy verify
npx hardhat deploy --network base --deployment usdc              # real deploy + eager verify
npx hardhat deploy --network base --deployment usdc --no-deploy  # only verify what's queued
```

`deploySpec` is `{ allMissing: true }` from the tasks; scenarios use `{ cometMain: true, cometExt: true }` for upgrades.

---



## 9. Step 7 - Verify contracts


| Strategy       | Behaviour                                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `eager`        | Verify right after each deploy.                                                                             |
| `lazy`         | Store args in `verify/args.json`; verify later with `dm.verifyContracts()`. Successful entries are removed. |
| `none` / unset | Do nothing.                                                                                                 |


Two verification paths (`Verify.ts`):

- `via: 'artifacts'` → Hardhat's `verify:verify` task.
- `via: 'buildfile'` → `ManualVerify.ts`, which submits the stored compiler metadata directly to the explorer API.

"Already verified" counts as success; "does not have bytecode" waits 5s and retries (up to 10 times). Other failures are logged and swallowed unless `raise` is set.

The `deploy` task always tries to verify `comet:implementation` too (it is deployed by a factory, so the DM never saw its deploy), unless `--no-verify-impl`.

Verify a single address by hand:

```bash
npx hardhat publish --network base --address 0x… [--deployment usdc] arg1 arg2
```

Set `DEBUG_VERIFY=1` to dump the manual verification request to `sources-<address>.json`.

---



## 10. Step 8 - Write and run migrations

A migration changes the live protocol, usually by submitting a governance proposal.

### 10.1 Generate

```bash
npx hardhat gen:migration --network base --deployment usdc my_change
# → deployments/base/usdc/migrations/<unix timestamp>_my_change.ts
```



### 10.2 Shape

```ts
import { migration } from '../../../../plugins/deployment_manager/Migration';

export default migration('1778758319_my_change', {
  // Deploy/compute anything the proposal needs. Return value is stored as the artifact.
  async prepare(dm, govDm) { return { newThing: '0x…' }; },

  // Build and submit the proposal (usually through govDm's governor).
  async enact(dm, govDm, artifact) { /* ... */ },

  // Optional: true once governance executed it. Written automatically after a real enact.
  async enacted(dm, govDm) { return false; },

  // Optional: assertions run by scenarios after the proposal executes.
  async verify(dm, govDm, preMigrationBlockNumber) { /* ... */ },
});
```

- `dm` is the market's DM; `govDm` is the governance DM (mainnet for L2 markets, same DM for mainnet markets).
- `prepare` artifacts live in `deployments/<net>/<dep>/artifacts/<name>.json`.
- `DiffState.ts` (`diffState`, `getCometConfig`) can snapshot and diff a Comet's configuration between the pre-migration block and now.



### 10.3 Run

```bash
npx hardhat migrate --network base --deployment usdc 1778758319_my_change --simulate           # prepare only, on a fork
npx hardhat migrate --network base --deployment usdc 1778758319_my_change --simulate --enact   # prepare + enact on a fork
npx hardhat migrate --network base --deployment usdc 1778758319_my_change --enact              # real
```

Flags: `--prepare` (default when `--enact` is absent), `--enact`, `--overwrite` (replace an existing artifact), `--impersonate <addr>` (simulate only: proposer), `--no-enacted` (don't rewrite the file), `--tenderly` / `--tenderly-vnet` (execute the proposal on Tenderly). `deploy_and_migrate` chains the deploy task and a migration in one run.

What the task does:

1. Builds the market DM and, if the base has an `auxiliaryBase`, the governance DM; spiders both.
2. Loads the migration (`loadMigrations`) - **migrations whose** `enacted()` **returns true are filtered out**.
3. `runMigration`: clears `cache/relay.json`, `cache/currentProposal.json`, `cache/bytecodes.json`; runs `prepare` (refuses to overwrite an existing artifact without `--overwrite`); runs `enact`; optionally executes on Tenderly.
4. After a real enact, `writeEnacted` rewrites the migration file to add `enacted() { return true; }`.



### 10.4 How scenarios use migrations

`scenario/constraints/MigrationConstraint.ts` loads every migration **modified on the current branch** for the base, runs `prepare` + `enact` on the fork with a COMP whale as proposer, then `ProposalConstraint` executes the proposal and calls `verify`. So every scenario runs against the protocol as it will be after your proposal.

---



## 11. Step 9 - Signers, nonces, retries and logging

- **Signers**: `dm.getSigner(address?)` / `dm.getSigners()` return signers wrapped in `ExtendedNonceManager`, so parallel txs get correct nonces and EIP-712 signing works. Asking for an unknown address creates a new managed signer (works for impersonated accounts on forks). Tasks and scenarios `unshift` an impersonated proposer into `dm._signers` to make it the default.
- **Retries**: `dm.retry(fn, retries = 7, timeLimit = 2 min, wait = 500ms)` - each attempt is time-boxed, waits double, and nonce managers are reset between attempts (`resetSignersPendingCounts`).
- **Logging**: `dm.tracer()` returns a trace function. Strings are printed only with `DEBUG=1`, prefixed with the network. Passing a tx response waits for it, logs cost and emitted events, and adds to `dm.spent`.
- **Tenderly helpers**: `stashRelayMessage` (used by `scenario/utils/relay*Message.ts`) and `stashBytecode` (when `saveBytecode` is on) write to the repo-level `cache/` folder for Tenderly simulations. `cleanCache()` deletes them.

---



## 12. Step 10 - Cross-market and cross-network work


| Method                                                      | Use                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `dm.fromDep(alias, network, deployment)`                    | Borrow one contract from another market (spiders it).                                                         |
| `dm.spiderOther(network, deployment)`                       | Spider another market, get its full `Spider` result. Creates a fresh DM every call (no caching).              |
| `dm.addBridgedDeploymentManager(network, deployment, hre?)` | Create and cache a DM for another market (loads cache, then spiders). A different network requires its `hre`. |
| `dm.readAlias(network, deployment, alias)`                  | Read an address from another market's `aliases.json` without crawling.                                        |
| `dm.fork()`                                                 | Copy this DM with its in-memory cache and contracts (for isolated scenario branches).                         |
| `cache.asDeployment(network, deployment)`                   | Same memory, different path root.                                                                             |


L2 markets always involve two DMs: the L2 market DM and the mainnet governance DM from `auxiliaryBase`. That is why CI spiders mainnet first.

---



## 13. Step 11 - CLI cheat sheet


| Command                                                                                                                                                                             | Purpose                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npx hardhat spider --network <n> --deployment <d>`                                                                                                                                 | Crawl one market, write `roots.json`/`aliases.json`.                           |
| `npx hardhat spider --clean`                                                                                                                                                        | Delete every `aliases.json` and `.contracts` cache.                            |
| `yarn hardhat scenario:spider [--bases a,b]`                                                                                                                                        | Spider several bases in parallel; fails after all finish, naming each failure. |
| `npx hardhat deploy --network <n> --deployment <d> [--simulate] [--no-deploy] [--no-verify] [--no-verify-impl] [--overwrite]`                                                       | Run the market deploy script and verify.                                       |
| `npx hardhat gen:migration --network <n> --deployment <d> <name>`                                                                                                                   | Scaffold a migration.                                                          |
| `npx hardhat migrate --network <n> --deployment <d> <migration> [--prepare] [--enact] [--simulate] [--overwrite] [--impersonate <a>] [--no-enacted] [--tenderly] [--tenderly-vnet]` | Run a migration.                                                               |
| `npx hardhat deploy_and_migrate ...`                                                                                                                                                | Deploy + migrate in one run.                                                   |
| `npx hardhat publish --network <n> --address <a> [args...]`                                                                                                                         | Verify one contract.                                                           |
| `yarn test`                                                                                                                                                                         | Includes `plugins/deployment_manager/test/*.ts`.                               |


---



## 14. Recipes



### Add a new market

1. Create `deployments/<net>/<market>/` with `configuration.json` and `deploy.ts` (copy a sibling market; skip `migrations/`).
2. Create `relations.ts` that spreads `../../relations` and adds anything market-specific (proxy types of new collateral tokens, bridges).
3. Register it in `hardhat.config.ts` under `deploymentManager.networks.<net>.<market>` and add a scenario base.
4. `npx hardhat deploy --network <net> --deployment <market> --simulate` until it's clean.
5. Real deploy (normally via the `deploy-market` workflow), which commits the new `roots.json`.
6. Write the initialization migration (`configurate_and_ens`), which usually ends with `dm.spider()` to pick up newly configured contracts such as the reward token.



### A spider run fails on a new collateral

Short version:

- `Cannot find contract function …` or a wrong ABI → the token is a proxy the explorer ABI doesn't describe. Add a contract-name entry (e.g. `MyProxyType: { artifact: 'contracts/interfaces/ERC20.sol:ERC20', delegates: { field: { slot: '0x3608…' } } }`) to the market's `relations.ts`.
- `Contract source code not verified` → add an `artifact:` override so no explorer ABI is needed.
- `Had X -> A, not B` → two contracts resolve to the same alias; give one a distinct `alias`.
- `symbol()` reverts on a fork → see the hardcoded fallbacks in `deployments/relations.ts` and `RelationConfig.readKey`.

Full table of symptoms and fixes: [Spider, section 10](spider.md#10-step-8---extending-the-rules).



### Use the DM in a script

```ts
const dm = new DeploymentManager('mainnet', 'usdc', hre, { writeCacheToDisk: true });
await dm.spider();
const comet = await dm.getContractOrThrow('comet');
```

---



## 15. Known quirks

- `contracts()` **spiders implicitly** on first use; unexpected explorer/RPC traffic usually comes from here.
- **Spider rewrites** `roots.json` on every run. With `deployed` contracts passed in, they are added permanently (that is how deploys record new roots). Don't commit an accidental change.
- **Aliases are unique, addresses are not** - the same contract under two aliases is crawled twice.
- `loadMigrations` **calls** `enacted(undefined, undefined)` and drops enacted migrations. An `enacted` that uses its DM arguments will crash there, and `migrate` on an enacted migration reports "Unknown migration".
- `deploy` **task swallows deploy-script errors** (logs `Failed to deploy with error`) and continues to verification; the process still exits successfully.
- `Deploy.ts` **module-level** `retry` **uses** `this.resetSignersPendingCounts()`, but `this` is undefined there, so the retry path throws a `TypeError` instead of retrying. It only wraps verification bookkeeping, which rarely throws, so it is latent.
- `raiseOnVerificationFailure` **is never set** by the DM, so verification failures are always logged and ignored.
- **Retry defaults differ**: DM imports use 4 retries / 5s; direct `Import.ts` calls default to 7 / 10s.
- `spider --clean` runs `rm deployments/*/*/aliases.json`, which errors if no file matches, and wipes the build-file cache.
- `spiderOther` **/** `fromDep` **are uncached** - each call spiders the other market again.

---



## 16. Function reference

Every function in the plugin, file by file. "internal" means it is not exported and only used inside its own file.

### `DeploymentManager.ts`

**Module level**

| Function | What it does |
| --- | --- |
| `getManagedSigner(signer)` *(internal)* | Wraps a raw ethers signer in `ExtendedNonceManager` and turns it into a `SignerWithAddress`, so every DM signer tracks its own nonces. |

**Setup and signers**

| Method | What it does |
| --- | --- |
| `constructor(network, deployment, hre, config)` | Stores the network, deployment, `hre` and config; resets `counter` and `spent`; creates the `Cache` for this market. No I/O. |
| `addBridgedDeploymentManager(network, deployment, hre?)` | Returns a DM for another market, created once and cached under `network:deployment`. The new DM loads its existing cache and then spiders. Throws if the market is on another network and no `hre` is given. |
| `getSigners()` | Returns all Hardhat signers wrapped as managed signers. Built once and reused. |
| `getSigner(address?)` | No address: the first managed signer. With an address: the matching managed signer, or a new one created through `hre.ethers.getSigner(address)` and added to the list (works for impersonated accounts on forks). |
| `resetSignersPendingCounts()` | Resyncs every signer's nonce from the chain. Called between retries. |
| `deployOpts()` *(private)* | Builds the `DeployOpts` passed to `Deploy.ts`: network, verification strategy, cache, default signer, tracer. |
| `importRetries()` / `importRetryDelay()` *(private)* | Explorer import retry count (default 4) and first delay (default 5s), taken from config. |

**Loading contracts**

| Method | What it does |
| --- | --- |
| `spider(deployed = {})` | Seeds the build-file cache from the archive submodule, picks the relation config, merges `roots.json` with `deployed`, crawls, then writes `roots.json` and `aliases.json` and keeps the contract map in memory. Returns the `Spider` result. |
| `spiderOther(network, deployment)` | Creates a fresh DM for another market and spiders it. Not cached. |
| `loadContractsFromExistingCache()` | Rebuilds contracts from `aliases.json` and the local `.contracts/` build files without touching the chain. Logs and skips aliases whose build file cannot be loaded. |
| `contracts()` | Returns the in-memory alias → contract map, running `spider()` first if nothing is loaded yet. |
| `getContracts(signer?)` | All contracts as a plain object, each connected to `signer` or the default signer. |
| `contract(alias, signer?)` | One contract by alias, connected to a signer; `undefined` if the alias is unknown. |
| `getContractOrThrow(alias, signer?)` | Same as `contract`, but throws `<network>/<deployment> deployment missing <alias>`. |
| `putAlias(alias, contract)` | Records an alias in `aliases.json` and in the in-memory map. |
| `readAlias(network, deployment, alias)` | Reads one address from another market's `aliases.json` without crawling. |

**Importing and deploying**

| Method | What it does |
| --- | --- |
| `import(address, network = 'mainnet')` | Fetches a build file (cache first, then explorer) and caches it. |
| `cast(address, artifact)` | Wraps an address in a contract using a local Hardhat artifact's ABI. Nothing is cached. |
| `idempotent(condition, action, retries?)` | Runs `action` (with retries) only if `condition()` returns something truthy. Used for "set it only if it isn't set yet" calls. |
| `deploy(alias, contractFile, args, force?, retries?)` | Deploys from a local artifact and records the alias, unless the alias already exists and `force` is not set. |
| `clone(alias, address, args, fromNetwork = 'mainnet', force?, retries?)` | Imports a verified contract from another network and deploys its bytecode here, unless the alias already exists with a non-zero address. |
| `existing(alias, addresses, network = 'mainnet', artifact?)` | Registers already-deployed contracts under an alias. Several addresses are merged into one proxy contract. An `artifact` forces a local ABI and re-registers even if the alias exists. |
| `fromDep(alias, network, deployment, otherAlias = alias)` | Spiders another market, takes one of its contracts and records it here under `alias`. Throws if it isn't found. |
| `_deploy(contractFile, args, retries?)` | Internal worker behind `deploy`: optionally stashes bytecode for Tenderly, logs the pending tx count, deploys through `Deploy.deploy` with retries, increments `counter`. |
| `_deployBuild(buildFile, args, retries?)` | Internal worker behind `clone`: deploys from a build file with retries, increments `counter`. |
| `runDeployScript(deploySpec)` | Spiders, runs the market's `deploy.ts`, spiders again with the returned contracts as roots, and returns the before/after delta. |
| `diffDelta(delta)` | Prints a readable diff of the addresses before and after a deploy (contract objects stripped). |

**Verification**

| Method | What it does |
| --- | --- |
| `verifyContracts(filter?)` | Goes through the lazy-verification queue. For each entry that passes `filter`, verifies it and removes it from the queue on success. |
| `verifyContract(args)` | Verifies one contract through `Verify.verifyContract`. |
| `setVerificationStrategy(strategy)` | Switches between `none`, `eager` and `lazy` at runtime. |

**Migrations and market files**

| Method | What it does |
| --- | --- |
| `generateMigration(name, timestamp?)` | Creates a new migration file from the template. |
| `storeArtifact(migration, artifact)` | Saves a migration's `prepare` output to `artifacts/<name>.json` and returns the path. |
| `readArtifact(migration)` | Reads that saved output back. |
| `readConfig()` | Reads the market's `configuration.json`. |

**Tenderly cache files**

| Method | What it does |
| --- | --- |
| `cleanCache()` | Deletes `cache/relay.json`, `cache/currentProposal.json` and `cache/bytecodes.json` in the repo root. |
| `stashRelayMessage(messenger, callData, signer)` | Appends a bridge relay message to `cache/relay.json`, skipping duplicates. Used by the `scenario/utils/relay*Message.ts` helpers. |
| `stashBytecode(bytecodeWithArgs)` | Appends deploy bytecode (with constructor args) to `cache/bytecodes.json`. |

**Utilities**

| Method | What it does |
| --- | --- |
| `shouldWriteCacheToDisk(flag)` | Turns disk writes on or off for both the DM config and its cache. |
| `retry(fn, retries = 7, timeLimit?, wait = 500)` | Runs `fn` with a time limit (2 min by default). On failure it logs, resets nonces, waits, doubles the wait and tries again until retries run out. |
| `tracer()` | Returns a trace function. A string is logged (only with `DEBUG` set) with the network prefix. A tx response is awaited, its cost and events are logged, and the cost is added to `spent`. |
| `fork()` | Returns a copy of this DM with a copy of its in-memory cache and contract map. |

### `Spider.ts`

| Function | What it does |
| --- | --- |
| `spider(cache, network, hre, relations, roots, trace)` | Entry point. Crawls every root in order, adds each root's contract to the shared context, then records every root's alias. Returns `{ roots, aliases, contracts }`. |
| `crawl(...)` *(internal)* | Visits one address: finds its relation config (by address, alias template, contract name, then resolved alias), builds its contract, works out its alias and hands off to `maybeProcess`. An address with no code is only recorded. |
| `maybeProcess(alias, build, config)` *(internal, inside `crawl`)* | If the alias is new: crawls the implementation (`delegates`) and merges its ABI into the proxy, stores the contract, then crawls every child in `relations` and adds them to the context. If the alias was already seen, skips it. |
| `maybeStore(alias, address, into)` *(internal)* | Records alias → address. Returns `false` if the same pair already exists, lets a real address replace a zero address, and throws on any other conflict. |
| `discoverNodes(path, contract, context, config, defaultKey)` *(internal)* | Reads the addresses a relation points to and pairs each with its alias template and the parent path. |
| `isContract(hre, address)` *(internal)* | True if the address has code. |
| `localBuild(cache, hre, artifact, network, address)` *(internal)* | Builds a contract from a local Hardhat artifact. |
| `remoteBuild(cache, hre, network, address)` *(internal)* | Builds a contract from an explorer build file (through the cache). |

### `RelationConfig.ts`

| Function | What it does |
| --- | --- |
| `getRelationConfig(dmConfig, network, deployment)` | Returns the relation map registered for this market in `hardhat.config.ts`, falling back to the base map. Throws if neither exists. |
| `getFieldKey(config, defaultKey?)` | Normalises a relation's `field` into `{ key }`, `{ slot }` or `{ getter }`. With no `field`, the relation's own name is used as the getter. |
| `readField(contract, fieldKey, context)` | Gets the addresses a relation points to: reads a storage slot, calls a getter, or runs a custom function. Always returns an array. |
| `readAlias(contract, aliasRender, context, path)` | Works out a contract's alias: a fixed string, a getter call for `.name` templates, or a custom function. |
| `aliasTemplateKey(template)` | The key used to look up config for an alias template: the string itself, or a named function's name. |
| `asAddressArray(val, msg)` *(internal)* | Turns `null`, a string or a string array into an address array; throws on anything else. |
| `readKey(contract, fnName)` *(internal)* | Calls a no-argument getter statically. Has a hardcoded `tETH` fallback when `symbol()` reverts on a fork. |

### `Import.ts`

| Function | What it does |
| --- | --- |
| `fetchAndCacheContract(cache, network, address, retries?, delay?, force?)` | `fetchContract`, then writes the result to the build-file cache. |
| `fetchContract(cache, network, address, retries?, delay?, force?)` | Returns the cached build file if there is one (unless `force`), otherwise imports it from the explorer. |
| `importContract(network, address, retries?, delay?)` | Downloads a build file from Blockscout (for `mainnet`, `unichain`, `scroll`, `optimism`, `base`, `arbitrum`, `ronin`) or Etherscan (others). Retries with doubling delay capped at 10s; gives up at once on "Contract source code not verified". |
| `readContract(cache, hre, fullyQualifiedName, network, address, force?)` | Returns the cached build file, or builds one from a local Hardhat artifact and its build info. |

### `Deploy.ts`

| Function | What it does |
| --- | --- |
| `deploy(contractFile, args, hre, opts)` | Deploys from a Hardhat artifact at gas price × 1.2, reads its build file from `artifacts/`, verifies or queues verification per strategy, and caches the build file. |
| `deployBuild(buildFile, args, hre, opts)` | Deploys from a build file (e.g. a clone), verifies or queues verification per strategy, and caches the build file. |
| `doDeploy(name, factory, args, opts, src, gasPrice?)` *(internal)* | Sends the deploy transaction, waits for it and traces it. |
| `deployFromBuildFile(buildFile, args, hre, opts)` *(internal)* | Creates a contract factory from a build file's ABI and bytecode, then calls `doDeploy`. |
| `maybeStoreCache(opts, contract, buildFile)` *(internal)* | Stores the build file if a cache was given. |
| `getBuildFileFromArtifacts(contractFile, contractFileName)` *(internal)* | Finds the compiler output for a contract through its `.dbg.json` file in `artifacts/contracts/`. |
| `retry(fn, retries?, timeLimit?, wait?)` *(internal)* | Retries the verification step. Its failure path calls `this.resetSignersPendingCounts()`, which fails because `this` is undefined here (see Known quirks). |

### `Verify.ts`, `ManualVerify.ts`, `VerifyArgs.ts`

| Function | What it does |
| --- | --- |
| `verifyContract(args, hre, raise = false, retries = 10)` | Verifies a contract through Hardhat's `verify:verify` (`via: 'artifacts'`) or `manualVerifyContract` (`via: 'buildfile'`). "Already verified" counts as success; "does not have bytecode" waits 5s and retries. Other errors are thrown only if `raise`. Returns whether it succeeded. |
| `manualVerifyContract(contract, buildFile, args, hre)` | Submits the stored compiler metadata and encoded constructor args straight to the explorer API, then checks the result. Removes `compilationTarget` and caps optimizer runs at 1,000,000 first. Writes the request to disk when `DEBUG_VERIFY` is set. |
| `getVerifyArgs(cache)` / `storeVerifyArgs(cache, map)` | Read / write the lazy-verification queue `verify/args.json`. |
| `putVerifyArgs(cache, address, args)` / `deleteVerifyArgs(cache, address)` | Add / remove one queue entry. |

### `Migration.ts`, `MigrationTemplate.ts`, `Enacted.ts`

| Function | What it does |
| --- | --- |
| `migration(name, actions)` | Creates a `Migration`. Every migration file default-exports one. |
| `loadMigration(path)` | Imports a file and checks its default export is a `Migration`. |
| `loadMigrations(paths)` | Loads several migrations, skipping any whose `enacted()` returns true (called with no DM arguments). |
| `getArtifactSpec(migration)` | Cache path of a migration's artifact: `artifacts/<name>.json`. |
| `generateMigration(cache, name, timestamp?)` | Writes a new migration file from the template; throws if the file already exists. Returns the file name. |
| `migrationTemplate({ timestamp, name })` | The source text of a new, empty migration. |
| `migrationName({ timestamp, name })` | File name `<timestamp>_<name>.ts`. |
| `now()` *(internal)* | Current Unix time in seconds. |
| `writeEnacted(migration, dm, writeToFile = true)` | Reads the migration file and adds (or replaces) `enacted() { return true; }`, writing it back unless told not to. Returns the new source. |
| `addEnactedToMigration(sourceFile)` | The text edit behind `writeEnacted`: inserts or replaces `enacted` right after `enact`, keeping the original formatting. |

### `Roots.ts`, `Aliases.ts`, `ContractMap.ts`

| Function | What it does |
| --- | --- |
| `getRoots(cache)` / `putRoots(cache, roots)` | Read / write `roots.json`. |
| `getAliases(cache)` / `storeAliases(cache, aliases)` | Read / write `aliases.json`. |
| `putAlias(cache, alias, address)` | Adds or updates one alias in `aliases.json`. |
| `getInvertedAliases(cache)` | Address (lowercase) → list of aliases. |
| `getBuildFile(cache, network, address)` / `storeBuildFile(...)` | Read / write `deployments/<network>/.contracts/<address>.json`. |
| `seedArchiveCache(cache, network)` | Copies every archived build file for the network into the cache, skipping ones already there. Does nothing if the submodule isn't checked out. |
| `getArchivedBuildFile(network, address)` | Reads one archived build file straight from the submodule. Not used anywhere yet. |
| `getFileSpec(network, address)` *(internal)* | Cache path of a build file. |

### `Cache.ts`

| Method / function | What it does |
| --- | --- |
| `constructor(network, deployment, writeCacheToDisk?, deploymentDir?)` | Empty in-memory store rooted at `<cwd>/deployments` by default. |
| `asDeployment(network, deployment)` | A cache for another market that shares the same memory. |
| `getFilePath(spec)` | Absolute file path for a spec. |
| `readCache(spec, transformer?)` | Memory first, then disk (parsed as JSON by default). `undefined` if missing. |
| `storeCache(spec, data, transformer?)` | Writes to memory, and to disk if enabled. |
| `readMap(spec)` / `storeMap(spec, map)` | Same, for JSON objects stored as `Map`s. Always copies, so callers can't change the cached map by accident. |
| `clearMemory()` / `storeMemory()` / `loadMemory(c)` / `cloneMemory()` | Clear, export, import or detach the in-memory store. |
| `show()` | Prints the whole in-memory store. |
| `getPath(spec)` *(private)* | Turns a spec into path segments, lowercased. `{ rel }` is relative to `<network>/<deployment>`, `{ top }` to `deployments/`. |
| `getMemory` / `putMemory` *(private)* | Read / write the nested in-memory maps. |
| `getDisk` / `putDisk` *(private)* | Read / write a file. Writes go to a temp file that is then renamed, so parallel processes never read a half-written file. |
| `compose`, `deepClone`, `parseJson` *(internal)* | Chain two functions; deep-copy nested maps; parse JSON, returning `undefined` with a warning if it's invalid. |

### `NonceManager.ts`

| Method | What it does |
| --- | --- |
| `ExtendedNonceManager._reset()` | Sets the local nonce back to the chain's transaction count. |
| `ExtendedNonceManager._signTypedData(domain, types, value)` | EIP-712 signing through `eth_signTypedData_v4`, which ethers' `NonceManager` doesn't provide. |
| `ExtendedNonceManager.sendTransaction(tx)` | Sends as usual; on failure resets the nonce before re-throwing. |

### `DiffState.ts`

| Function | What it does |
| --- | --- |
| `diffState(contract, getState, oldBlock, newBlock?)` | Reads state at two blocks, prints a readable diff, and returns the changed fields. |
| `getCometConfig(comet, blockNumber?)` | Comet's full configuration at a block: governance addresses, rates, tracking, reserves and every asset's factors and caps (keyed by symbol). |
| `mapObject(obj, fn)` *(internal)* | Applies `fn` to every nested value in place (used to turn `BigNumber`s into `bigint`s). |

### `Utils.ts`

| Function | What it does |
| --- | --- |
| `debug(...args)` | Logs only when `DEBUG` is set. Accepts a function to build the message lazily. |
| `stringifyJson(value)` | JSON with 4-space indent and `bigint`s written as strings. |
| `fileExists(path)` | True if the path exists. |
| `getPrimaryContract(buildFile)` | Finds the build file's main contract (`buildFile.contract`) among all its entries; throws if missing. |
| `getEthersContract(address, buildFile, hre)` | ethers `Contract` for an address using the build file's ABI. |
| `mergeABI(abi0, abi1)` | Combines two ABIs, dropping duplicates; on conflicts (e.g. constructors) the second wins. |
| `mergeContracts(address, contracts, hre)` | One contract at `address` whose ABI is all the given contracts' ABIs merged. |
| `mergeIntoProxyContract(contracts, hre)` | `mergeContracts` at the last contract's address (the proxy). |
| `objectToMap` / `objectFromMap` | Plain object ↔ `Map`. |
| `mapValues(obj, fn)` | Applies `fn` to every value of an object. |
| `asArray(v)` | Wraps a single value in an array; `undefined` becomes `[]`. |
| `txCost(receipt)` | Gas used × effective gas price, in wei. |
| `asyncCallWithTimeout(promise, timeLimit = 2 min)` | Rejects with "Async call timeout limit reached" if the promise takes too long. |

### Types-only files

- `Types.ts` - `Address`, `Alias`, `ABI`, `BuildFile`, `ContractMetadata`, `TraceFn`.
- `type-extensions.ts` - adds `deploymentManager` to Hardhat's config types.
- `index.ts` - the plugin's public exports.

---



## 17. Related docs

- [Root `README.md`](../../README.md) - Spider, Migrations, Deploying sections.
- [Spider](spider.md) - contract discovery in depth.
- [`SCENARIO.md`](../../SCENARIO.md) - how scenarios drive the DM and spider.
- [`docs/contract-import.md`](../contract-import.md) - explorer import details and Blockscout flakiness.
- [`docs/contracts-archive.md`](../contracts-archive.md) - the build-file archive submodule and its sync workflow.
- The code itself: [`plugins/deployment_manager/`](../../plugins/deployment_manager/).

