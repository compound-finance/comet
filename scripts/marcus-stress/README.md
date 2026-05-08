# Phase 4.3 — Stress soak driver

Drives sustained EVM-lane Supply ops against Marcus to satisfy the master spec's Phase 4.3 requirement: **7-day soak, ~100 ops/day per lane**. Captures landing rate, latency percentiles, error breakdown.

## What this does

- Loops on a configurable interval (default 14m24s = 100/day rate)
- Each iteration drives one full EVM-lane Supply via the relayer:
  1. POST `/intent` `{evmAddress, amount}`
  2. Poll until `awaiting-deposit`
  3. User signs `unifiedToken.transfer(comet, amount)`
  4. Poll until `complete`
- Records per-iteration: status, intentId, all 3 tx hashes, total latency, error (if any)
- Writes a rolling JSON log so a 7-day run is restart-resilient — just re-launch and it appends

## Run

Pre-reqs:
- Relayer service running (`compound-on-rome-orchestrator/relayer/`)
- Test deployer wallet has UT balance + Marcus USDC gas. The driver re-uses the same deployer the bench scripts use (`~/.secrets/marcus/compound-phase4.key`).

```bash
ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
  RELAYER_URL=http://localhost:8787 \
  DURATION_HOURS=168 \
  INTERVAL_SECONDS=864 \
  npx hardhat run scripts/marcus-stress/soak-supply.ts --network marcus
```

Knobs:
- `DURATION_HOURS` — how long to run (default 168 = 7 days)
- `INTERVAL_SECONDS` — gap between iterations (default 864 = 14m24s → ~100/day)
- `AMOUNT_RAW` — supply amount per iteration (default `10000` = 0.01 USDC)
- `LOG_PATH` — output log file (default `scripts/marcus-stress/soak-log.jsonl`)

## What's NOT in this harness (operator concerns)

- **Solana congestion simulation** — needs an external traffic generator targeting Marcus's Solana cluster. Out of scope.
- **Failure injection** (orchestrator service down, RPC drop, oracle staleness) — done at the infra layer via process kills / network rules. Out of scope.
- **Always-on relayer infrastructure** — driver assumes a relayer is running. Operator decides where it lives (currently localhost; production needs a real host).
- **Liquidator-side stress** — covered by the liquidator's own polling cadence + Phase 4.3's underwater positions surfacing naturally. Not driven from here.

## Output

`soak-log.jsonl` — one JSON record per iteration:

```jsonl
{"ts":"2026-05-08T12:00:00Z","iter":1,"status":"complete","intentId":"…","snapshotTx":"0x…","transferTx":"0x…","completeTx":"0x…","latencyMs":28412}
{"ts":"2026-05-08T12:14:24Z","iter":2,"status":"failed","intentId":"…","error":"snapshot did not confirm in time","latencyMs":90123}
…
```

After the run, a small analysis script (`analyze-soak.ts`, also in this dir) reads the JSONL and prints:
- Total iterations, success / failure counts
- p50 / p95 / p99 latency
- Error breakdown by category
- Hours-without-incident
