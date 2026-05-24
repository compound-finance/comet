# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Compound v3 (Comet) money-market fork — the EVM-side lending app for the Compound-on-Rome wedge. Vendored canonical Compound v3 with Rome-specific additions: `LiquidationRouter` (atomic absorb + N×buyCollateral in one EVM tx) and registry-driven deploy scripts.

**Public repo** — same as upstream Compound. AI/tooling footers are blocked on all commits + PRs (per monorepo CLAUDE.md hook).

## Configuration / chain metadata

Chain ids, base assets, collateral assets, price feeds, and Comet variant addresses for every Rome chain are canonical at **[`rome-protocol/registry`](https://github.com/rome-protocol/registry)** under `apps/compound/<chainId>-<slug>.json`. Don't hardcode in `hardhat.config.ts` or deploy scripts.

The `scripts/registry-driven-deploy/` entry point reads the registry JSON to drive a fresh Comet variant deploy on any Rome chain — adding Compound to a new chain is a registry edit, not a code change in this repo.

## Build & Deploy Commands

```shell
# Install deps
yarn install --frozen-lockfile

# Compile contracts (Hardhat 2)
yarn compile

# Run unit tests
yarn test

# Lint (Compound's strict ESLint config + Solhint for contracts)
yarn lint
yarn lint-contracts

# Run scenarios (requires Etherscan API key + network access)
yarn scenario

# Type-check (matches CI "Check types" step)
yarn tsc

# Registry-driven deploy on a new chain
CHAIN_ID=200010 REGISTRY_ROOT=/path/to/registry-checkout \
  ETH_PK=<deployer-pk> \
  ETHERSCAN_KEY=stub SNOWTRACE_KEY=stub MAINNET_QUICKNODE_LINK=stub \
  UNICHAIN_QUICKNODE_LINK=stub LINEA_QUICKNODE_LINK=stub \
  npx hardhat run scripts/registry-driven-deploy/deploy.ts --network <chain>
```

## Cached-wrapper composition (the Rome-specific bit)

Compound v3 composes with **`SPL_ERC20_cached` wrappers** the same way Uniswap V2/V3 + Aave V3 do — modify the token layer, keep the protocol layer canonical. Empirically validated on Hadrian (PR #18, merged 2026-05-24).

### One operational gotcha

When `Pool.supply(asset, amount, ...)` lands tokens at the Comet proxy's address, Pool reads `IERC20(asset).balanceOf(Comet)` in pre-supply accrual. Cached `SPL_ERC20_cached` wrappers revert on `balanceOf` if the recipient's SPL associated-token-account hasn't been initialized.

**Solution**: every deploy script calls `wrapper.ensure_token_account(cometProxy)` after `initializeStorage` for each cached wrapper that will flow through the Comet. Same gotcha + same fix as Uniswap V3 + Aave V3. Auto-detected via the `0x5e094743` selector probe; plain ERC20s skipped.

### Two-EOA TRUE borrow setup

Compound v3 doesn't block self-borrow (unlike Aave V3 which blocks self-liquidation). But: a user goes into "borrow" (negative `principal`) only when they withdraw base beyond their own supply. Single-signer setup can't trigger that without overdrawing the pool. So gamut Phase 8 generates a fresh random EOA, funds it with native gas + collat + small wUSDC dust, warms its cached-wrapper ATAs, then has it supply collat and withdraw base → real borrow.

### Heavy-case 5-collat gamut

For multi-collateral stress test, `scripts/hadrian-cached-test/` bootstraps 4 new cached SPL_ERC20 wrappers (wHEAT/wSALT/wMILK/wOIL) via `ERC20SPLFactory.create_token_mint` → `init_token_mint` → `add_spl_token_no_metadata` → `mint_to`. Then deploys a fresh Comet variant with cached wUSDC base + all 5 cached collats and runs a 33-step gamut covering supply / TRUE multi-collat borrow / repay / withdraw.

**Key empirical finding**: Compound v3's multi-collat borrow stays in **1 Solana sig at 1.16M CU** even with 5 collats backing — 5.6× cheaper than Aave V3 single-collat borrow (6.46M / 28 sigs). Per-collat overhead is linear ~52K CU. Full breakdown: [`scripts/hadrian-cached-test/METRICS.md`](scripts/hadrian-cached-test/METRICS.md).

## Hadrian smoke test playbook

```shell
# 1. Bootstrap 4 new cached SPL_ERC20 wrappers (wHEAT/wSALT/wMILK/wOIL).
#    Idempotent — skips wrappers that already exist.
ETH_PK=<key> ETHERSCAN_KEY=stub SNOWTRACE_KEY=stub MAINNET_QUICKNODE_LINK=stub \
  UNICHAIN_QUICKNODE_LINK=stub LINEA_QUICKNODE_LINK=stub \
  npx hardhat run scripts/hadrian-cached-test/bootstrap-5-cached.ts --network hadrian

# 2. Deploy fresh single-collat Comet (cached wUSDC × cached wETH)
ETH_PK=<key> ... npx hardhat run scripts/hadrian-cached-test/deploy.ts --network hadrian

# 3. Run single-collat gamut (mainline + 2-EOA TRUE borrow)
ETH_PK=<key> ... npx hardhat run scripts/hadrian-cached-test/gamut.ts --network hadrian

# 4. Deploy 5-collat heavy-case Comet
ETH_PK=<key> ... npx hardhat run scripts/hadrian-cached-test/deploy-5collat.ts --network hadrian

# 5. Run 5-collat heavy-case gamut
ETH_PK=<key> ... npx hardhat run scripts/hadrian-cached-test/gamut-5collat.ts --network hadrian
```

The `state.json`, `state-5collat.json`, and `cached-wrappers.json` files record deployed addresses so subsequent runs can re-use them.

## Solidity Compiler Version

`solc 0.8.15` (Compound v3 mainnet pin). Optimizer enabled with `runs: 200`. Don't bump without re-running the full scenario suite — Compound v3's bytecode-hash invariants are tested.

## Architecture (the Rome-specific additions)

- **`contracts/LiquidationRouter.sol`** — atomic absorb + N×buyCollateral in a single EVM tx. Lets a liquidator absorb the user's debt and buy collateral within the same EVM tx, removing the inter-tx race window. See PR #15.
- **`scripts/registry-driven-deploy/`** — chain-agnostic Comet deploy: reads target params from `rome-protocol/registry`, deploys fresh Comet variants + Bulker. Adding a new Rome chain = a registry JSON edit. See PR #14.
- **`scripts/hadrian-cached-test/`** — cached-wrapper composition test infrastructure: standalone deploy scripts + 2 gamuts + per-action Solana metrics + per-collat scaling measurements. See PR #18 + `METRICS.md`.

The vendored upstream Compound code (`contracts/Comet.sol`, `CometExt.sol`, `Configurator.sol`, etc.) is byte-identical to mainnet `@compound-finance/comet`. Don't modify — protocol-level work happens upstream first.

## CI checks (the matrix that gates PRs)

| Check | What it does | Blocking? |
|---|---|---|
| Run ESLint | strict ESLint on plugins/scenario/scripts/src/tasks/test/hardhat.config | yes |
| Contract linter | Solhint on contracts/ | yes |
| Run Unit Tests / Unit tests | `yarn test` | yes |
| Run Forge Tests | `forge test` | yes |
| Gas profiler | gas-stats reporter | yes |
| Run Scenarios → Prepare Repository | spider mainnet contracts via Etherscan | flaky — Etherscan rate-limits cause intermittent fails |
| Scan / Slither analyzer / CodeQL / Semgrep OSS | security tools | yes |
| test (Rome CI) | Compound's own CI | yes |

**Heads-up on Scenarios**: it spiders Compound mainnet contracts via Etherscan API and frequently rate-limits in CI. If the Scenarios "Prepare Repository" job fails with "Too many invalid api key attempts" it's an external issue, NOT your code. Admin-merge override is justified in that case — same as PR #18's merge.

If ESLint catches your scripts: don't suppress globally. Add specific `.eslintignore` entries for non-code files (the lint glob `scripts/**/*` catches .md and .json too). Pattern: `scripts/<your-dir>/*.md` + `scripts/<your-dir>/*.json`.

If TypeScript catches your scripts: imports like `ethers.BigNumber` work as a value but fail as a type. Use explicit `import { BigNumber } from 'ethers';` and reference `BigNumber` as the type.

## Cross-repo dependencies

| Layer | Consumer | Method |
|---|---|---|
| `Comet.supply / withdraw / supplyTo` | `compound-on-rome-demo` UI | wagmi readContract / writeContract; ABI from `@compound-finance/comet` npm |
| `Comet.borrowBalanceOf / balanceOf / collateralBalanceOf` | `compound-on-rome-demo` portfolio view | view-only reads |
| `LiquidationRouter.absorbAndBuy` | `compound-on-rome-orchestrator` keeper | cross-chain liquidation flows; see PR #15 |
| `SPL_ERC20_cached.ensure_token_account` | Compound deploy scripts | warmup before first supply (see Hadrian smoke playbook above) |

## Change impact map

| If you change... | Also check / update |
|---|---|
| `contracts/Comet.sol` or vendored Compound contracts | Run full forge + scenario suite; bytecode-hash invariants may break |
| `contracts/LiquidationRouter.sol` | Update `compound-on-rome-orchestrator` keeper if ABI changed |
| `scripts/registry-driven-deploy/` | Update `rome-protocol/registry` `apps/compound/` schema if needed |
| `scripts/hadrian-cached-test/` | METRICS.md per re-run; this CLAUDE.md if architecture changes |
| `hardhat.config.ts` network entries | rome-protocol/registry chains entries should match |

## Test selection

| What changed | Run |
|---|---|
| `contracts/*` (Compound vendored) | `yarn test` + `yarn forge:test` + `yarn scenario` |
| `contracts/LiquidationRouter.sol` | `yarn test test/LiquidationRouter*` + integration test against rome-protocol/compound-on-rome-orchestrator |
| `scripts/hadrian-cached-test/` | `yarn lint` + `yarn tsc` + manually run the 5-script Hadrian smoke playbook above. No unit tests required (these are deploy + smoke scripts) |
| `hardhat.config.ts` | `yarn tsc` + a deploy dry-run on the network you changed |
