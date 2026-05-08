// Phase 4.3 stress soak driver — sustained EVM-lane Supply ops against
// Marcus + the relayer. Per master spec: ~100 ops/day per lane, 7 days.
//
// Run (default = 7 days at ~100/day):
//   ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//     RELAYER_URL=http://localhost:8787 \
//     npx hardhat run scripts/marcus-stress/soak-supply.ts --network marcus
//
// Loops are JSONL-logged per iteration so a restart picks up state via
// the existing log (file is append-only). The driver itself doesn't need
// to recover; the log + analyze-soak.ts is the source of truth.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const ADDR = {
  unifiedToken: '0xe76bb4c8C0f50C75eE348E91ddd34f4043582aCC',
  cometProxy:   '0xDf203b46C89921537F24beA30046eb1FF8c3FCD3',
};

const RELAYER_URL = process.env.RELAYER_URL ?? 'http://localhost:8787';
const DURATION_HOURS = Number(process.env.DURATION_HOURS ?? '168'); // 7 days
const INTERVAL_SECONDS = Number(process.env.INTERVAL_SECONDS ?? '864'); // 14m24s = 100/day
const AMOUNT_RAW = BigInt(process.env.AMOUNT_RAW ?? '10000'); // 0.01 USDC
const LOG_PATH = process.env.LOG_PATH ??
  path.join(__dirname, 'soak-log.jsonl');

interface SoakRecord {
  ts: string;
  iter: number;
  status: 'complete' | 'failed';
  intentId?: string;
  snapshotTx?: string;
  transferTx?: string;
  completeTx?: string;
  latencyMs: number;
  error?: string;
}

function appendLog(rec: SoakRecord): void {
  fs.appendFileSync(LOG_PATH, JSON.stringify(rec) + '\n');
}

async function rpc<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function getIntent(intentId: string): Promise<{ status: string; snapshotTxHash?: string; completeTxHash?: string; error?: string }> {
  const r = await fetch(`${RELAYER_URL}/intent/${intentId}`);
  if (!r.ok) throw new Error(`get intent: ${r.status}`);
  return r.json() as Promise<{ status: string; snapshotTxHash?: string; completeTxHash?: string; error?: string }>;
}

async function runOneSupply(
  ut: any, // ethers Contract
  user: any, // ethers Signer
  iter: number,
): Promise<SoakRecord> {
  const t0 = Date.now();
  const ts = new Date(t0).toISOString();
  let intentId: string | undefined;
  let snapshotTx: string | undefined;
  let transferTx: string | undefined;
  let completeTx: string | undefined;

  try {
    // 1. POST /intent
    const created = await rpc<{ intentId: string; status: string }>(
      `${RELAYER_URL}/intent`,
      { evmAddress: user.address, amount: AMOUNT_RAW.toString() },
    );
    intentId = created.intentId;

    // 2. Poll until awaiting-deposit
    const deadline1 = Date.now() + 90_000;
    while (Date.now() < deadline1) {
      const intent = await getIntent(intentId);
      if (intent.snapshotTxHash) snapshotTx = intent.snapshotTxHash;
      if (intent.status === 'failed') throw new Error(intent.error ?? 'snapshot failed');
      if (intent.status === 'awaiting-deposit') break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!snapshotTx) throw new Error('snapshot did not confirm in time');

    // 3. Sign + broadcast user's transfer
    const tx = await ut.transfer(ADDR.cometProxy, AMOUNT_RAW, { gasLimit: 30_000_000 });
    transferTx = tx.hash;
    await tx.wait();

    // 4. Poll until complete
    const deadline2 = Date.now() + 120_000;
    while (Date.now() < deadline2) {
      const intent = await getIntent(intentId);
      if (intent.completeTxHash) completeTx = intent.completeTxHash;
      if (intent.status === 'failed') throw new Error(intent.error ?? 'complete failed');
      if (intent.status === 'complete') break;
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!completeTx) throw new Error('complete did not confirm in time');

    return {
      ts, iter, status: 'complete',
      intentId, snapshotTx, transferTx, completeTx,
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    // Best-effort cancel so the next iter is not blocked.
    if (intentId) {
      try { await fetch(`${RELAYER_URL}/intent/${intentId}`, { method: 'DELETE' }); } catch {}
    }
    return {
      ts, iter, status: 'failed',
      intentId, snapshotTx, transferTx, completeTx,
      latencyMs: Date.now() - t0,
      error: (err as Error).message,
    };
  }
}

async function main() {
  const [user] = await ethers.getSigners();
  const ut = await ethers.getContractAt(
    'contracts/unified-token/UnifiedToken.sol:UnifiedToken',
    ADDR.unifiedToken,
    user,
  );

  console.log(`User:           ${user.address}`);
  console.log(`Relayer URL:    ${RELAYER_URL}`);
  console.log(`Amount/iter:    ${AMOUNT_RAW} raw (= ${(Number(AMOUNT_RAW) / 1e6).toFixed(6)} USDC)`);
  console.log(`Duration:       ${DURATION_HOURS}h`);
  console.log(`Interval:       ${INTERVAL_SECONDS}s (= ${Math.round(86400 / INTERVAL_SECONDS)} ops/day)`);
  console.log(`Log:            ${LOG_PATH}`);
  console.log('');

  // Boot probe — UT balance must cover the soak.
  const utBalance = await ut.balanceOf(user.address);
  const needed = AMOUNT_RAW * BigInt(Math.ceil((DURATION_HOURS * 3600) / INTERVAL_SECONDS));
  console.log(`UT balance:     ${ethers.utils.formatUnits(utBalance, 6)} USDC`);
  console.log(`Estimated need: ${ethers.utils.formatUnits(needed, 6)} USDC`);
  if (utBalance.lt(needed)) {
    console.warn(
      `WARNING: UT balance < estimated need. Soak will fail mid-run when balance hits 0.`,
    );
  }

  const endAt = Date.now() + DURATION_HOURS * 3600 * 1000;
  let iter = 0;
  while (Date.now() < endAt) {
    iter += 1;
    const rec = await runOneSupply(ut, user, iter);
    appendLog(rec);
    console.log(
      `[iter ${iter}] ${rec.status} latency=${(rec.latencyMs / 1000).toFixed(1)}s` +
      (rec.error ? ` error=${rec.error.slice(0, 80)}` : ''),
    );
    // Sleep until the next interval boundary.
    const sleepMs = Math.max(0, INTERVAL_SECONDS * 1000 - rec.latencyMs);
    await new Promise(r => setTimeout(r, sleepMs));
  }
  console.log(`\nSoak complete. ${iter} iterations. Logs at ${LOG_PATH}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
