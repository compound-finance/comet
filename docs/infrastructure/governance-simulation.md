# Governance Simulation - Guide

A step-by-step guide to executing a governance proposal without governance: on a local fork, through the Tenderly API, or on a Tenderly Virtual TestNet.

Part of the [Simulations](simulations.md) family.

---

## 0. Introduction

### Definition

Governance simulation is the act of driving a proposal through the real governor, timelock and bridge receivers while relaxing the rules that make the real path slow: who holds COMP, how long voting lasts, when the timelock's `eta` is reached, and what the base fee is. The contracts are the deployed ones; only the surface they run on and the preconditions are synthetic.

### Purpose

Governance is the only route into production, and it is unforgiving: a proposal is immutable once submitted, takes days to resolve, and a revert at execution is a public failure that costs another cycle. Simulation moves that failure earlier, to a fork, where it costs a re-run.

Three questions are worth separating:

| Question | Answered by |
| --- | --- |
| Does the proposal execute at all - no revert, no gas cliff? | the fast path on a fork |
| Does the protocol still behave correctly afterwards? | scenarios, run against the post-proposal world |
| Can a reviewer verify this without running anything? | the Tenderly modes |

### The real path versus the simulated one

| Stage | Real | Simulated |
| --- | --- | --- |
| Propose | proposer needs the COMP threshold | impersonate a whale, or a signer already holding it |
| Vote | ~2 days of voting | mine to `startBlock`, cast whale votes, or write the tally into storage |
| Queue | anyone calls `queue` | same call, with a zeroed base fee |
| Timelock | ~2 days | `evm_setNextBlockTimestamp` past `eta` |
| Execute | anyone calls `execute` | same call, with an explicit gas limit so reverts surface as reverts |
| Bridge | sequencer delivers, minutes to days | messages replayed onto the L2 fork, then executed there |

---

## 1. Key notes

| Term | Meaning |
| --- | --- |
| **governance DM** (`govDm`) | Deployment Manager for the market that owns governance: mainnet for L2 bases, itself for mainnet bases. |
| **whale** | Hardcoded address holding COMP. `COMP_WHALES.mainnet` (5 addresses) and `COMP_WHALES.testnet` (1), in `src/deploy/index.ts`. |
| **open proposal** | Already on-chain in state Pending, Active, Succeeded or Queued. |
| **bridged proposal** | A proposal queued on an L2 `bridgeReceiver` after a relayed message. |
| **fast path** | `fastGovernanceExecute` / `executeOpenProposal`: the whole lifecycle in one function. |
| **state override** | Writing a storage slot to bypass a rule - used for vote tallies and timelock admin checks. |
| **proposal cache** | `cache/currentProposal.json`, written when a migration builds a proposal; replayed by the Tenderly modes. |

---

## 2. Files

| File | Role |
| --- | --- |
| [`scenario/utils/index.ts`](../../scenario/utils/index.ts) | The bulk of it: `fastGovernanceExecute`, `voteForOpenProposal`, `executeOpenProposal`, `executeOpenProposalAndRelay`, `fastL2GovernanceExecute`, `createCrossChainProposal`, `tenderlyExecute`, `tenderlyVnetExecute`, `simulateBundle`, `forceProposalVotesSucceeded`. |
| [`scenario/constraints/ProposalConstraint.ts`](../../scenario/constraints/ProposalConstraint.ts) | Finds and executes open proposals before scenarios run. |
| [`scenario/constraints/MigrationConstraint.ts`](../../scenario/constraints/MigrationConstraint.ts) | Prepares and enacts staged migrations, recording the proposal each one creates. |
| [`scenario/utils/bridgeProposal.ts`](../../scenario/utils/bridgeProposal.ts) | Open **bridged** proposals: discovery and execution on L2. |
| [`scenario/utils/relayMessage.ts`](../../scenario/utils/relayMessage.ts) | Dispatches a relay to the right chain implementation. |
| [`scenario/utils/tenderlyVnet.ts`](../../scenario/utils/tenderlyVnet.ts) | Creates or reuses a Virtual TestNet. |
| [`scenario/utils/hreUtils.ts`](../../scenario/utils/hreUtils.ts) | `setNextBaseFeeToZero`, `setNextBlockTimestamp`, `mineBlocks`, `setEtherBalance`. |
| [`scenario/context/Gov.ts`](../../scenario/context/Gov.ts) | `ProposalState`, `BridgedProposalState`, `OpenProposal` types. |
| [`src/deploy/index.ts`](../../src/deploy/index.ts) | `COMP_WHALES`, proposal building, `stashProposal` → `cache/currentProposal.json`. |
| [`tasks/deployment_manager/task.ts`](../../tasks/deployment_manager/task.ts) | `--simulate`, `--impersonate`, `--tenderly`, `--tenderly-vnet`. |

---

## 3. Step 1 - Pick a mode

| Mode | Surface | Vote handling | Output | Cost |
| --- | --- | --- | --- | --- |
| Fork fast path | local Hardhat fork | real votes from whales | pass/fail in your terminal | seconds to minutes, free |
| Scenario suite | local fork per base | same, via constraints | full property test results | minutes to hours |
| `--tenderly` | Tenderly API, stateless | skipped via storage patch | a shareable link per step | API quota |
| `--tenderly-vnet` | hosted persistent fork | skipped via storage patch | RPC URL + dashboard, state queryable afterwards | API quota, vnet lifetime |

Rule of thumb: the fork fast path while iterating, scenarios before opening the PR, a Tenderly mode when someone else needs to see it.

---

## 4. Step 2 - Get a proposer

Proposing requires COMP above the governor's threshold. Three ways this is satisfied:

```bash
# 1. CLI: impersonate any address (simulation only - the task rejects it without --simulate)
yarn hardhat migrate --network mainnet --deployment usdc --simulate --enact \
  --impersonate 0x66cD62c6F8A4BB0Cd8720488BCBd1A6221B765F9 1712345678_my_change
```

```ts
// 2. Scenarios: the first COMP whale, funded with 1 ETH, unshifted to be the default signer
const proposer = await impersonateAddress(govDm, (await ctx.getCompWhales())[0], exp(1, 18));
govDm._signers.unshift(proposer);

// 3. Several proposals in one run: a fresh whale per call, tracked per network/deployment
const signer = await getSignerForProposal(dm, govDm);
```

`getSignerForProposal` hands out the default signer first, then successive `COMP_WHALES[network]` entries, impersonating and funding each - so two proposals in one simulation do not collide on one proposer.

---

## 5. Step 3 - The fast path on a fork

`fastGovernanceExecute(dm, proposer, targets, values, signatures, calldatas)` runs the entire lifecycle:

1. **Propose.** Base fee zeroed, then `propose(...)` with `gasPrice: 0`. On mainnet the signature is folded into the calldata (Bravo's 4-argument form); elsewhere `testnetPropose` calls the 5-argument form through a minimal ABI. The `ProposalCreated` event yields `id`, `startBlock`, `endBlock`.
2. **Vote** - `voteForOpenProposal`:
   - mines to `startBlock + 1` if voting has not opened;
   - casts `castVote(id, 1)` from every whale for the network, each failure logged and skipped, so a whale that has moved its COMP does not abort the run.
3. **Execute** - `executeOpenProposal`:
   - mines past `endBlock`;
   - `queue(id)` if the state is Succeeded;
   - jumps the next block timestamp past `eta` (`proposalEta`, falling back to `proposals(id).eta` for older governors);
   - refreshes CCIP fee stats (`updateCCIPStats`), which otherwise go stale on a fork and make Ronin's bridge quote revert;
   - `execute(id)` with an explicit 120M gas limit, so a failure surfaces as a revert rather than a gas-estimation error. Gas used at or above 16,777,215 is treated as a failure;
   - re-deploys the Renzo oracle mock and mines one block.

Every transaction runs with `gasPrice: 0` after `setNextBaseFeeToZero`, so an impersonated account needs no ETH.

For an L2 target, `fastL2GovernanceExecute` wraps the same call and then relays (see [step 7 of the hub](simulations.md#7-cross-chain-relay-simulation)); `createCrossChainProposal` builds the L1 proposal that wraps L2 calldata for a bridge receiver.

---

## 6. Step 4 - Open on-chain proposals

Proposals already live on-chain are executed on the fork *before* scenarios run, so the suite tests the world as it will be once everything in flight has landed.

`ProposalConstraint`:

1. On a bridged base, executes any proposals already queued on the L2 `bridgeReceiver` (`getOpenBridgedProposals` → `executeBridgedProposal`, which fast-forwards past the receiver's `eta`).
2. Reads `ProposalCreated` logs from the governor over the last `votingDelay + votingPeriod + 30000` blocks and keeps those in state Pending, Active, Succeeded or Queued.
3. Votes for each, then executes each with `executeOpenProposalAndRelay`, which after execution derives the L2s the proposal touched, mocks their Redstone oracles, and relays.
4. If a proposal came from a staged migration (matched by id via `MigrationConstraint`), runs that migration's `verify` block afterwards.

`MigrationConstraint` complements this for changes not yet on-chain: it loads migrations modified on the current branch, runs `prepare` and `enact` with a whale as proposer, and records the proposal id each one created.

---

## 7. Step 5 - Tenderly stateless bundle (`--tenderly`)

```bash
yarn hardhat migrate --network mainnet --deployment usdc --enact --tenderly 1712345678_my_change
```

`tenderlyExecute` replays the cached proposal (`cache/currentProposal.json`) through Tenderly's `simulate-bundle` API rather than a local node:

- **Timeline.** Block and timestamp numbers are computed forward from the latest block (propose → vote → queue → execute, 12 seconds per block) and passed explicitly per call.
- **State patches.** The timelock's admin slot is zeroed, and on the governor: the proposal-settings slot is packed to enable execution, and the fractional-counting vote-extension slots are cleared. The vote itself is never cast.
- **Deploy replay.** Any contract bytecode stashed during the run (`cache/bytecodes.json`, written when `saveBytecode` is on) is deployed first, so the proposal's targets exist.
- **Rolling state.** `simulateBundle` posts one simulation at a time, extracts `state_diff` from each result and merges it into the next call's `state_objects`, chaining otherwise stateless calls.
- **Output.** Each simulation is saved and shared (`shareSimulation`), so the run prints a link per step.

Use it when the artefact matters more than the fidelity: a reviewer opens each link and reads the trace.

---

## 8. Step 6 - Tenderly Virtual TestNet (`--tenderly-vnet`)

```bash
yarn hardhat migrate --network mainnet --deployment usdc --enact --tenderly-vnet 1712345678_my_change
```

`tenderlyVnetExecute` runs the proposal as **real transactions** on a hosted fork:

1. **Create or reuse** a Virtual TestNet for the governance network (`getOrCreateVirtualTestnet`). `TENDERLY_VNET_RPC_URL[_<NETWORK>]` reuses an existing one - the escape hatch when an account cannot create them through the API.
2. **Build a Deployment Manager** against the vnet's admin RPC, with disk writes off.
3. **Fund the proposer** (100 ETH) and replay any stashed deploy bytecode.
4. **Propose** through the real governor.
5. **Skip the vote** - `forceProposalVotesSucceeded` writes `forVotes` directly into the governor's `GovernorCountingFractional` storage, high enough to satisfy both quorum and the success check. Then `evm_increaseBlocks` past the deadline.
6. **Queue**, jump past `eta` with `evm_setNextBlockTimestamp`, refresh CCIP stats, **execute** with a 30M gas limit.
7. **Follow it cross-chain.** Every distinct L2 chain id among the market DM and anything registered with `addBridgedDeploymentManager` gets its own Virtual TestNet, a Deployment Manager, a crawl, and a relay from the governance vnet. A failure on one L2 is logged and the rest continue.
8. **Print** the public RPC URL and dashboard link for every testnet involved.

The result outlives the run: anyone can point a client at the public RPC and query the post-proposal state.

---

## 9. Step 7 - What the simulation relaxes

Everything below is a deliberate departure from production. Read this before trusting a green run.

| Relaxation | Where | Consequence |
| --- | --- | --- |
| Votes come from hardcoded whales | `COMP_WHALES` | Quorum and the real vote distribution are not tested. A whale that moved its COMP is skipped silently. |
| Vote skipped entirely | both Tenderly modes | Nothing about voting is exercised; the tally is fabricated in storage. |
| Base fee zeroed, `gasPrice: 0` | fork paths | Gas pricing is not representative; gas *usage* still is. |
| Time and blocks jumped | everywhere | Anything depending on elapsed time between stages (accrual, TWAPs, oracle staleness) sees an idealised timeline. |
| Bridge messages relayed by hand | relay helpers | Sequencer behaviour, finality windows and real bridge fees are not tested. |
| Oracles mocked | `mockAllRedstoneOracles`, `redeployRenzoOracle` | Prices are synthetic on forks where those feeds do not update. |
| CCIP stats refreshed | `updateCCIPStats` | Compensates for stale fee data on a fork; real quotes may differ. |
| Timelock admin slot zeroed | `--tenderly` | The timelock's own access control is bypassed for the bundle. |
| Explicit high gas limits | fork and vnet execute | A proposal near the real block gas limit can pass here and fail on-chain. The 16.7M check is the only guard. |

---

## 10. Step 8 - Running it

```bash
# Migration's own code, on a fork
yarn hardhat migrate --network mainnet --deployment usdc --simulate 1712345678_my_change

# Full proposal lifecycle on a fork, as a whale
yarn hardhat migrate --network mainnet --deployment usdc --simulate --enact \
  --impersonate 0x66cD62c6F8A4BB0Cd8720488BCBd1A6221B765F9 1712345678_my_change

# Shareable simulation links per step
yarn hardhat migrate --network mainnet --deployment usdc --enact --tenderly 1712345678_my_change

# Hosted fork, real transactions, cross-chain
yarn hardhat migrate --network mainnet --deployment usdc --enact --tenderly-vnet 1712345678_my_change

# The whole protocol against the post-proposal world (migration must be staged in git)
yarn hardhat scenario --bases mainnet-usdc
```

In CI, `prepare-migration.yaml` and `enact-migration.yaml` expose `simulate`, `tenderly` and `tenderlyVnet` as workflow inputs, so the same runs are reproducible from the GitHub UI with the exact committed code.

Required environment: `TENDERLY_USERNAME` and `TENDERLY_ACCESS_KEY` for both Tenderly modes; optionally `TENDERLY_VNET_RPC_URL[_<NETWORK>]` to reuse a Virtual TestNet.

---

## 11. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `deployment missing governor` | The governance DM was not crawled, or an L2 base has no `auxiliaryBase` configured. |
| Proposal never leaves Pending | `startBlock` not reached - `voteForOpenProposal` mines for you, so this usually means the governor is on the other chain's DM. |
| `Execution may have failed due to hitting gas limit` | Execution used ≥ 16,777,215 gas. Treat as a real failure, not a harness artefact. |
| Votes have no effect | Whale addresses in `COMP_WHALES` have moved their COMP; the errors are logged but not raised. |
| Ronin bridge quote reverts | Stale CCIP fee stats - `updateCCIPStats` covers this on the paths that call it. |
| `Missing Tenderly credentials…` | `TENDERLY_USERNAME` / `TENDERLY_ACCESS_KEY` unset, or the account cannot create Virtual TestNets - set `TENDERLY_VNET_RPC_URL`. |
| Tenderly run proposes nothing | `cache/currentProposal.json` is missing: the migration did not build a proposal through the shared helper, or `cleanCache()` removed it. |
| L2 relay fails under `--tenderly-vnet` | Logged per L2 and skipped; check that market's vnet dashboard link. |

---

## 12. Function reference

| Function | What it does |
| --- | --- |
| `fastGovernanceExecute(dm, proposer, targets, values, signatures, calldatas)` | Propose, vote and execute in one call on a fork. |
| `fastL2GovernanceExecute(govDm, bridgeDm, proposer, …)` | The same, then relays the resulting messages to the L2. |
| `createCrossChainProposal(ctx, l2ProposalData, bridgeReceiver)` | Wraps L2 calldata into an L1 proposal addressed at the chain's bridge, and runs it. |
| `voteForOpenProposal(dm, proposal)` | Mines to the voting window and casts whale votes. |
| `executeOpenProposal(dm, proposal)` | Mines past the deadline, queues, jumps past `eta`, executes with a gas limit. |
| `executeOpenProposalAndRelay(govDm, bridgeDm, proposal)` | `executeOpenProposal`, then derives and relays to every L2 the proposal touched. |
| `getOpenProposals(dm, governor)` | Open proposals from recent `ProposalCreated` logs. |
| `getOpenBridgedProposals(dm)` / `executeBridgedProposal(dm, proposal)` | The same for proposals queued on an L2 bridge receiver. |
| `getSignerForProposal(dm, govDm)` | A distinct funded proposer per proposal within one run. |
| `tenderlyExecute(govDm, marketDm, governor, timelock)` | Stateless `simulate-bundle` run with state patches and shareable links. |
| `tenderlyVnetExecute(govDm, marketDm, governor, timelock)` | Virtual TestNet run: real transactions, forced vote tally, per-L2 testnets. |
| `simulateBundle(dm, simulations, blockNumber)` *(internal)* | Posts simulations one at a time, chaining `state_diff` forward. |
| `forceProposalVotesSucceeded(provider, governor, id)` *(internal)* | Writes a passing `forVotes` tally into governor storage. |
| `shareSimulation(dm, id)` *(internal)* | Makes a saved Tenderly simulation publicly viewable. |

---

## 13. Related docs

- [Simulations](simulations.md) - the full family and how to choose.
- [Deployment Manager](deployment-manager.md) - migrations, the `migrate` task and its flags.
- [`MIGRATIONS.md`](../../MIGRATIONS.md) - the migration workflow end to end.
- [`SCENARIO.md`](../../SCENARIO.md) - running the scenario suite.
- The code: [`scenario/utils/index.ts`](../../scenario/utils/index.ts), [`scenario/constraints/ProposalConstraint.ts`](../../scenario/constraints/ProposalConstraint.ts).
