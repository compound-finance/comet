# Infrastructure

Docs for the tooling around the protocol - the TypeScript that deploys markets, discovers their contracts, runs migrations and drives scenarios. Nothing here describes protocol behaviour itself; for that see the other docs under [`docs/`](..).

## Contents

| Doc | What it covers |
| --- | --- |
| [Deployment Manager](deployment-manager.md) | The `plugins/deployment_manager` Hardhat plugin: the access layer between tooling and the deployed protocol. |
| [Spider](spider.md) | Contract discovery: how a market's full contract set is crawled from a few committed root addresses. |
| [Simulations](simulations.md) | The simulation family: what each kind proves, what it costs, and which to reach for. |
| [Governance simulation](governance-simulation.md) | Executing a proposal without governance: fork fast path, open on-chain proposals, both Tenderly modes. |

## Deployment Manager

The Deployment Manager answers, for any market on any network, which contracts exist, where they are, and how to call them. One instance represents one market on one network (e.g. `base` / `usdc`), and deploy scripts, migrations, scenarios, scripts and CI all go through it.

Its responsibilities:

- **Discovery** - reconstruct the market's contract set from the chain (see Spider below).
- **Deploying** - idempotent helpers (`deploy`, `clone`, `existing`, `fromDep`) that record every contract they create under an alias.
- **Verifying** - eager or deferred source verification on Etherscan/Blockscout.
- **Migrations** - governance proposals with a `prepare` → `enact` lifecycle, exercised by scenarios before they are submitted.

Read the full guide: **[Deployment Manager](deployment-manager.md)**. It runs from the plugin's purpose through the files a market needs, instantiating a manager, loading contracts, discovery, imports, deploys, verification, migrations, cross-market work, a CLI cheat sheet, recipes, known quirks, and a function-by-function reference of every file.

Start here to add or change a market, write or run a migration, or trace where a contract's ABI or address came from.

## Spider

Spider is the discovery layer inside that plugin. It starts from a handful of committed root addresses, follows relation rules through getters and storage slots, and produces the market's complete alias → contract map - 97 aliases from 28 roots for mainnet USDC. Only the roots and the rules are committed; everything else is read from the chain on each run, so upgrades and new collaterals are picked up without a repo change.

Read the full guide: **[Spider](spider.md)**. It covers the inputs (`roots.json`, `relations.ts`), the crawl and its config resolution order, alias rules and conflicts, where ABIs come from, what the base rules discover, every caller across the repo, how to extend the rules for a new collateral or contract, operational notes, and a function reference.

Start here when a crawl fails, when a new collateral or contract needs to appear in `aliases.json`, or when an alias resolves to something unexpected.

## Simulations

Every change to the protocol reaches production through governance, and that path - propose, vote for days, queue behind a timelock, execute, relay to L2 - cannot be rehearsed on the real chain. Simulations run the same contracts against a copy of real state, relaxing only the preconditions that make an experiment impossible: who holds COMP, how long a vote lasts, whether a bridge has delivered its message.

The repo has several kinds, layered on three execution surfaces (a local Hardhat fork, Tenderly's stateless API, a Tenderly Virtual TestNet): scenario runs, migration `--simulate`, the governance fast path, open on-chain proposal execution, cross-chain relays, and the Solidity-side Forge simulations.

Read the overview: **[Simulations](simulations.md)** - what each kind proves, a decision table for picking one, the environment they need, and which things look like simulations but are not.

For the governance family specifically - how a proposal is pushed through the real governor and timelock without a real vote, how live on-chain proposals are folded into scenario runs, and what both Tenderly modes do - read **[Governance simulation](governance-simulation.md)**. Its section 9 lists every rule the simulation relaxes, which is the part to read before trusting a green run.

Start here to rehearse a migration's proposal, to produce a link a reviewer can open, or to work out why a proposal that simulated cleanly behaved differently on-chain.
