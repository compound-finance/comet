# Simulations - Guide

An overview of every kind of simulation in this repo: what each one proves, what it costs, and which to reach for.

---

## 0. Introduction

### Definition

A simulation runs protocol code against a copy of real chain state instead of the chain itself. The copy is either a local Hardhat fork, a Tenderly stateless call, or a Tenderly Virtual TestNet. Rules that would otherwise make an experiment impossible - who holds COMP, how long a vote lasts, what the base fee is, whether a bridge has relayed a message - are relaxed deliberately and explicitly.

### Purpose

Every change to Compound III reaches production through governance: a proposal is created, voted on for days, queued behind a timelock, then executed, and on L2s relayed across a bridge afterwards. That path cannot be rehearsed on the real chain, and a failure at the end of it is expensive and public.

Simulations exist to answer, before a proposal is submitted:

- does the migration's own code run against today's state;
- does the resulting proposal execute through the real governor, timelock and bridge receivers;
- does the protocol still behave correctly afterwards, across every market;
- can a reviewer see the outcome for themselves rather than taking it on trust.

### The layers

Each layer builds on the one below. Most flows combine several.

```
  ┌──────────────────────────────────────────────────────────────────┐
  │ 4. Verification      scenarios re-run against the post-proposal   │
  │                      world; migration `verify` blocks assert      │
  ├──────────────────────────────────────────────────────────────────┤
  │ 3. Bridge relay      L1 messages replayed onto L2 forks;          │
  │                      bridged proposals queued and executed        │
  ├──────────────────────────────────────────────────────────────────┤
  │ 2. Governance        propose → vote → queue → execute, compressed │
  │                      (whale votes, storage overrides, time jumps) │
  ├──────────────────────────────────────────────────────────────────┤
  │ 1. Execution surface local Hardhat fork  |  Tenderly bundle  |    │
  │                      Tenderly Virtual TestNet                     │
  └──────────────────────────────────────────────────────────────────┘
```

---

## 1. Key notes

| Term | Meaning |
| --- | --- |
| **fork** | A local Hardhat node serving state from a remote RPC at a pinned or recent block. Writes stay local. |
| **base** | A market to simulate against: network + deployment, optionally with `auxiliaryBase`. Defined in `hardhat.config.ts` under `scenario.bases`. |
| **auxiliary base** | The market holding governance for a bridged base. Mainnet, for every L2. |
| **impersonation** | Sending transactions as an address you do not hold keys for. `hardhat_impersonateAccount` on a fork. |
| **whale** | A hardcoded address with enough COMP to propose or to swing a vote. `COMP_WHALES` in `src/deploy/index.ts`. |
| **state override** | Writing a storage slot directly to skip a rule, e.g. a vote tally or a timelock delay. |
| **relay** | Replaying a bridge message that a real sequencer would deliver, so an L1 action lands on an L2 fork. |
| **Virtual TestNet** | A hosted, persistent, shareable Tenderly fork with its own RPC URL. |
| **open proposal** | A proposal already live on-chain in state Pending, Active, Succeeded or Queued. |

---

## 2. The simulation types

| # | Type | Surface | Entry point | Answers |
| --- | --- | --- | --- | --- |
| 1 | [Scenario](#3-scenario-simulation) | local fork per base | `yarn hardhat scenario` | Does the protocol still behave correctly, across every market and state? |
| 2 | [Migration](#4-migration-simulation) | local fork | `migrate --simulate` | Does this migration's own code run against today's state? |
| 3 | [Governance proposal](governance-simulation.md#5-step-3---the-fast-path-on-a-fork) | local fork | `fastGovernanceExecute`, scenario constraints | Does the proposal execute through the real governor and timelock? |
| 4 | [Open on-chain proposal](governance-simulation.md#6-step-4---open-on-chain-proposals) | local fork | `ProposalConstraint` | Do live proposals, once executed, break anything? |
| 5 | [Cross-chain relay](#7-cross-chain-relay-simulation) | local forks, both chains | `relayMessage`, `--tenderly-vnet` | Does the L1 proposal actually land and execute on the L2? |
| 6 | [Tenderly bundle](governance-simulation.md#7-step-5---tenderly-stateless-bundle---tenderly) | Tenderly API | `migrate --enact --tenderly` | What does each step do, in a link a reviewer can open? |
| 7 | [Tenderly Virtual TestNet](governance-simulation.md#8-step-6---tenderly-virtual-testnet---tenderly-vnet) | hosted fork | `migrate --enact --tenderly-vnet` | Same, as real transactions on a fork anyone can query afterwards. |
| 8 | [Forge](#8-forge-simulations) | Foundry fork | `forge test`, `forge script` | Does this Solidity-level deployment or bridge path work? |

Types 3-7 are the governance family and have their own guide: **[Governance simulation](governance-simulation.md)**.

---

## 3. Scenario simulation

The scenario framework forks each base, shapes the world until it satisfies a scenario's requirements, runs the scenario, then reverts. Requirements are met by **constraints** - supply caps, balances, utilization, prices, pauses - each of which can solve into several worlds, so one scenario expands into many runs.

```bash
yarn hardhat scenario --bases mainnet-usdc
yarn hardhat scenario:multistream            # streams in parallel, grouped by network
```

Proposal-related constraints (`MigrationConstraint`, `ProposalConstraint`) run first, so every scenario executes against a world that already includes pending migrations and live proposals. That is what makes the suite a governance safety net rather than just a protocol test.

Usage is documented in [`SCENARIO.md`](../../SCENARIO.md); the engine itself (worlds, solving, snapshots, multistream) is not yet covered in depth here.

---

## 4. Migration simulation

`migrate --simulate` runs a migration's `prepare` and, with `--enact`, its `enact` step against a fork built from the market's base spec. Nothing is written to disk unless `--overwrite` is passed, and verification drops to `lazy`.

```bash
yarn hardhat migrate --network mainnet --deployment usdc --simulate 1712345678_my_change
yarn hardhat migrate --network mainnet --deployment usdc --simulate --enact --impersonate 0x… 1712345678_my_change
```

`--impersonate` is what makes the enact step viable: proposing requires COMP the caller does not have. See the [Deployment Manager guide](deployment-manager.md#10-step-8---write-and-run-migrations) for the full flag set.

This proves the migration's own code path only. Whether the *proposal it creates* executes is a separate question, answered by the governance family below.

---

## 5. Governance proposal simulation

Compresses the real lifecycle - propose, vote, queue, execute - into a single run by mining through the voting period, casting whale votes or overriding the tally, and jumping past the timelock's `eta`.

Used by `fastGovernanceExecute` (scenarios and deploy scripts), by `MigrationConstraint` (staged migrations), and by both Tenderly modes.

Full detail: [Governance simulation](governance-simulation.md).

---

## 6. Open on-chain proposal simulation

Before scenarios run, `ProposalConstraint` reads the governor's `ProposalCreated` logs, keeps proposals still in Pending, Active, Succeeded or Queued, votes them through and executes them on the fork - relaying to L2 where needed. The suite therefore tests the protocol as it will be once everything currently in flight has landed.

Full detail: [Governance simulation](governance-simulation.md#6-step-4---open-on-chain-proposals).

---

## 7. Cross-chain relay simulation

A proposal that targets an L2 emits a bridge message on L1 that a sequencer would normally deliver minutes or days later. `scenario/utils/relayMessage.ts` replays it directly onto the L2 fork: it reads the bridge contract's logs on the governance fork, impersonates the L2 bridge alias or messenger, delivers the payload to the bridge receiver, then fast-forwards past the receiver's own timelock and executes the queued proposal.

Per-chain implementations exist for Polygon (FxRoot state sync), Arbitrum (retryable tickets, CCTP mint), the OP stack (Base, Optimism, Mantle, Unichain), Scroll, Linea and Ronin (CCIP). For Arbitrum, Base and Optimism the reverse direction is also simulated, so L2→L1 token bridging performed by a proposal shows up on the governance fork where a migration's `verify` step expects it.

Which L2s are involved is derived from the proposal's own targets (`isBridgeProposal.ts`), matched against the market's bridge roots; a migration can register additional ones with `addBridgedDeploymentManager`.

A dedicated guide for this is planned; today the mechanics are summarised here and in [`MIGRATIONS.md`](../../MIGRATIONS.md#multichain-proposals).

---

## 8. Forge simulations

Solidity-side simulations live under `forge/`:

- `forge/test/MarketUpdate*DeploymentTest.t.sol` - per-chain fork tests for the market-update deployment path.
- `forge/script/marketupdates/helpers/BridgeHelper.sol` - `simulateMessageAndExecuteProposal`, the Solidity equivalent of the relay step.
- `forge/script/marketupdates/GovernorProposal.s.sol` - builds and simulates the governance proposal for market updates.

These are independent of the TypeScript stack: they use Foundry's own forking and cheatcodes, and run through `forge test` / `forge script` (see the `Makefile`).

---

## 9. Not simulations

Easy to mistake for one:

| Thing | What it really is |
| --- | --- |
| `scripts/vote-queue-execute.ts` | Sends **real** votes, queue and execute transactions for a proposal id, polling until each state is reachable. Intended for testnets and forks you control. |
| `deploy --simulate` | Runs the deploy script against a fork - a deploy rehearsal, not a governance one. |
| `scripts/seed-fork-state-example.ts` | Seeds a personal fork with balances and executed proposals. A setup tool. |
| Seacrest steps in CI | A wallet bridge for signing **real** transactions from a workflow. |
| `--skip-simulation` (Makefile) | A Foundry flag disabling its pre-broadcast simulation. |

---

## 10. Choosing one

| You want to know | Use |
| --- | --- |
| Does my migration code run at all | `migrate --simulate` |
| Does my proposal execute end to end | `migrate --enact --simulate --impersonate <whale>` |
| Does it break any protocol behaviour | `yarn hardhat scenario --bases <base>` with the migration staged in git |
| Does it reach and execute on the L2 | same, on a bridged base; or `--tenderly-vnet` |
| Can I show a reviewer the result | `--tenderly` (links per step) or `--tenderly-vnet` (queryable fork) |
| Is the protocol still safe with live proposals in flight | scenarios, via `ProposalConstraint` (automatic) |
| Does a Solidity-level deployment path work | `forge test` under `forge/test/` |

---

## 11. Environment

| Variable | Needed for |
| --- | --- |
| `<NETWORK>_QUICKNODE_LINK`, `ETHERSCAN_KEY`, chain explorer keys | any fork (state) and contract discovery (ABIs) |
| `TENDERLY_USERNAME`, `TENDERLY_ACCESS_KEY` | `--tenderly` and `--tenderly-vnet` |
| `TENDERLY_VNET_RPC_URL[_<NETWORK>]` | reusing an existing Virtual TestNet instead of creating one |
| `DEBUG=1` | trace output from the Deployment Manager and relays |

CI entry points: `run-scenarios.yaml` (scenario suite per base), `prepare-migration.yaml` and `enact-migration.yaml` (both expose `simulate`, `tenderly` and `tenderlyVnet` as workflow inputs).

---

## 12. Related docs

- [Governance simulation](governance-simulation.md) - the proposal lifecycle, open proposals, both Tenderly modes.
- [Deployment Manager](deployment-manager.md) - the layer every simulation gets its contracts from.
- [Spider](spider.md) - how those contracts are discovered.
- [`SCENARIO.md`](../../SCENARIO.md) - running the scenario suite.
- [`MIGRATIONS.md`](../../MIGRATIONS.md) - migration workflow, including the Tenderly flags.
