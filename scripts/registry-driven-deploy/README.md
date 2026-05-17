# Registry-driven Compound deploy

Phase 2 of the Compound-on-Rome rebuild. Replaces hardhat scripts that
hardcoded addresses + names with a registry-driven entry point:

- target chainId picked at run time (`CHAIN_ID` env var)
- everything else (base asset, collateral assets, price feeds, Comet
  variants to deploy) resolved from `apps/compound/<chainId>-<slug>.json`
  in the registry checkout
- adding Compound to a new Rome chain = adding a registry JSON file, no
  code change here

## Architecture

```
scripts/registry-driven-deploy/
  deploy.ts                   # entry point — reads CHAIN_ID, drives the flow
  lib/
    registry-client.ts        # mirrors @rome-protocol/registry's
                              # getCompoundDeployment + buildRegistryUpdate
                              # until v0.11.0 ships on NPM
    deploy-comet-variant.ts   # deployCometVariant + deployBulker — registry-aware
                              # CometExt + Comet impl + proxy + init
  tests/
    registry-client.test.ts   # 8 tests covering registry-client + payload-build
  state/                      # gitignored — deploy run output (next-version
                              # registry payload per chain)
```

## Run

```bash
CHAIN_ID=200010 \
  REGISTRY_ROOT=/path/to/registry \
  ETH_PK=<deployer-pk> \
  ETHERSCAN_KEY=stub SNOWTRACE_KEY=stub MAINNET_QUICKNODE_LINK=stub \
  UNICHAIN_QUICKNODE_LINK=stub LINEA_QUICKNODE_LINK=stub \
  npx hardhat run scripts/registry-driven-deploy/deploy.ts --network hadrian
```

After a successful run, `state/200010-hadrian.json` holds the
next-version registry payload. Land it via:

```bash
cd registry
cp ../compound-on-rome-comet/scripts/registry-driven-deploy/state/200010-hadrian.json \
   apps/compound/200010-hadrian.json
/publish-registry-pr
```

## Test

```bash
ETHERSCAN_KEY=stub SNOWTRACE_KEY=stub MAINNET_QUICKNODE_LINK=stub \
  UNICHAIN_QUICKNODE_LINK=stub LINEA_QUICKNODE_LINK=stub \
  npx hardhat test scripts/registry-driven-deploy/tests/registry-client.test.ts \
    --no-compile
```

8 tests cover:

- registry-not-found error path
- unknown-chain returns undefined
- known-chain returns the entry
- resolveDeployTarget throws when entry missing (deploy is blocked,
  forcing the operator to add the registry entry first)
- resolveDeployTarget extracts deploy params (no hardcoding)
- zero-address treated as first-time (current: null) — supports both
  upgrade-in-place and fresh-chain deploys
- buildRegistryUpdate merges outcome over previous, preserves source
  commits + status, flags chainId mismatch

## Chain-agnostic invariants

The deploy script is chain-agnostic by construction:

1. No address constants in `deploy.ts` or any lib file
2. RPC URL resolved via `rpcRef` from the registry entry's reference
   into `chains/<id>-<slug>/chain.json`
3. Collateral asset symbols are looked up by name against the entry's
   `collateralAssets[]`; unknown symbols throw with a clear error
4. Comet variants to deploy come from `comets[]` in the registry entry;
   adding a new variant = registry edit
5. Bulker is deployed once per chain
6. Source git SHAs are picked up from env vars (GITHUB_SHA,
   ROME_SOLIDITY_REF, ROME_EVM_PRIVATE_REF) — no hardcoded versions

## What's NOT in this Phase

- Solana-side ATA bootstrap for each new Comet (the
  `helper.transfer_lamports + wrapper.ensure_token_account` pair).
  That's a separate post-deploy step; reuse `bootstrap-post.ts` from
  the bench worktree until a registry-driven version lands.
- Token-state setup (admin gets PCOL/MOCK + transfers to testUser) —
  bench artifact, not part of production deploy.
- Bench rerun against new contracts — Phase 2 closeout task, not
  shipped here.
