// Smoke gamut for vanilla Compound v3 on Hadrian against v6 cached
// SPL_ERC20_cached wrappers. Parametric over N collats (any count).
//
// Asserts:
//   - state.json exists with cometProxy + baseAsset + collateralAssets[]
//   - signer can approve + supply base liquidity
//   - fresh borrower wallet can be funded and can warm ATAs
//   - borrower can supply all N collats
//   - assetsIn bitmap records all N collats
//   - borrower can withdraw base → TRUE N-collat borrow (Comet walks every
//     collat for capacity calc)
//   - borrower can repay + withdraw collats
//
// First-run contract: this script MUST fail before deploy.ts runs, because
// scripts/hadrian-vanilla/state.json does not exist.  That is the
// "failing test for the right reason" gate of TDD discipline.
//
// Captures per-action Solana metrics (sigs, CU, heap, slot span) for the
// METRICS.md write-up that follows.

import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { callTx, sendTx } from '../_lib/gas';

const STATE_FILE = path.join('scripts', 'hadrian-vanilla', 'state.json');
const ROME_RPC = 'https://hadrian.testnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';

type Metric = {
  name: string;
  wallMs: number;
  txHash?: string;
  iterSigs?: number;
  totalCU?: number;
  maxHeap?: number;
  slotSpan?: number;
};

async function rpc(url: string, method: string, params: any[]): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  return (await r.json() as any).result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getSolanaTxWithRetry(sig: string): Promise<any> {
  for (const delay of [0, 1000, 2000, 3000, 5000]) {
    if (delay > 0) await sleep(delay);
    const tx: any = await rpc(SOLANA_RPC, 'getTransaction', [
      sig,
      { maxSupportedTransactionVersion: 0, encoding: 'json' },
    ]);
    if (tx) return tx;
  }
  return null;
}

async function captureTxMetrics(txHash: string): Promise<Partial<Metric>> {
  try {
    const sigs: string[] = (await rpc(ROME_RPC, 'rome_solanaTxForEvmTx', [txHash])) ?? [];
    let totalCU = 0;
    let maxHeap = 0;
    let missing = 0;
    const slots: number[] = [];
    for (const sig of sigs) {
      const tx = await getSolanaTxWithRetry(sig);
      if (!tx) { missing += 1; continue; }
      slots.push(tx.slot);
      totalCU += tx.meta?.computeUnitsConsumed ?? 0;
      for (const l of (tx.meta?.logMessages ?? []) as string[]) {
        const m = l.match(/Program log: Heap (\d+)/);
        if (m) maxHeap = Math.max(maxHeap, parseInt(m[1], 10));
      }
    }
    return {
      txHash,
      iterSigs: sigs.length,
      totalCU: missing === sigs.length ? undefined : totalCU,
      maxHeap: missing === sigs.length ? undefined : maxHeap,
      slotSpan: slots.length > 0 ? Math.max(...slots) - Math.min(...slots) : 0,
    };
  } catch {
    return { txHash };
  }
}

async function main() {
  // ─── Pre-flight: state.json must exist (checked BEFORE getSigners() so
  // the failure mode is obvious even without ETH_PK / RPC reachable) ────
  if (!fs.existsSync(STATE_FILE)) {
    throw new Error(
      `${STATE_FILE} does not exist. Run scripts/hadrian-vanilla/bootstrap-mints.ts ` +
      `then scripts/hadrian-vanilla/deploy.ts first.`,
    );
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const [signer] = await ethers.getSigners();

  const COMET: string = state.comet;
  const BASE = state.baseAsset;
  const COLLATS: any[] = state.collateralAssets;
  console.log(`\n=== Vanilla Compound v3 — Hadrian gamut ===`);
  console.log(`Signer:  ${signer.address}`);
  console.log(`Comet:   ${COMET}  (no proxy — impl-direct)`);
  console.log(`Bulker:  ${state.bulker}`);
  console.log(`Base:    ${BASE.symbol} @ ${BASE.address}`);
  console.log(`Collats (${COLLATS.length}):`);
  for (const c of COLLATS) {
    console.log(`  ${c.symbol.padEnd(8)} @ ${c.address}  feed=${c.priceFeed}  CF=${c.borrowCollateralFactor}`);
  }

  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function decimals() view returns (uint8)',
  ];
  const WRAPPER_MINT_ABI = ['function mint_to(address to, uint256 value) returns (bool)'];
  const ENSURE_ATA_ABI = ['function ensure_token_account(address) returns (bytes32)'];
  const cometAbi = [
    'function supply(address asset, uint256 amount)',
    'function withdraw(address asset, uint256 amount)',
    'function balanceOf(address account) view returns (uint256)',
    'function borrowBalanceOf(address account) view returns (uint256)',
    'function collateralBalanceOf(address account, address asset) view returns (uint128)',
    'function userBasic(address account) view returns (int104, uint64, uint64, uint16 assetsIn, uint8)',
  ];

  const comet = new ethers.Contract(COMET, cometAbi, signer);
  const baseToken = new ethers.Contract(BASE.address, ERC20_ABI, signer);
  const MaxUint256 = ethers.constants.MaxUint256;

  // ─── Per-collat funding amounts ─────────────────────────────
  // Bounded by deployer's actual balance on pre-existing v6 wrappers (signer
  // is NOT mint authority on v6 wUSDC/wETH/wSOL — those wrap pre-existing
  // Solana mints; the gamut's mint_to fallback transfers from signer's
  // existing balance for those three.  For freshly-bootstrapped wrappers
  // signer IS mint authority and mint_to succeeds; default = 100 tokens.
  const COLLAT_OVERRIDES: Record<string, BigNumber> = {
    wETH: BigNumber.from('1000000'),       // 0.01 wETH × $3000 ≈ $30
    wSOL: BigNumber.from('10000000'),      // 0.01 wSOL × $150  ≈ $1.50
    wBTC: BigNumber.from('1000000000'),    // 1.0  wBTC × $60K  ≈ $60K (fresh-mint, plenty)
  };
  const collatSupply = (c: any): BigNumber => {
    const override = COLLAT_OVERRIDES[c.symbol];
    if (override) return override;
    return BigNumber.from(100).mul(BigNumber.from(10).pow(c.decimals));  // synthetic @ $1 → $100
  };

  const BASE_LEND  = BigNumber.from('1000000');  // 1 wUSDC (signer has ~4.58)
  const BORROW_AMT = BigNumber.from('100000');    // 0.1 wUSDC borrow
  const REPAY_DUST = BigNumber.from('10000');     // 0.01 wUSDC dust for interest

  const passed: string[] = [];
  const failed: string[] = [];
  const metrics: Metric[] = [];

  async function step(name: string, fn: () => Promise<string | void>) {
    process.stdout.write(`  ${name} ... `);
    const start = Date.now();
    try {
      const maybeHash = await fn();
      const wallMs = Date.now() - start;
      const m: Metric = { name, wallMs };
      if (typeof maybeHash === 'string' && maybeHash.length === 66) {
        Object.assign(m, await captureTxMetrics(maybeHash));
      }
      metrics.push(m);
      const detail = m.iterSigs !== undefined
        ? `sigs=${m.iterSigs} CU=${m.totalCU?.toLocaleString() ?? '?'} heap=${m.maxHeap?.toLocaleString() ?? '?'} span=${m.slotSpan}`
        : '';
      console.log(`PASS (${wallMs}ms) ${detail}`);
      passed.push(`${name} (${wallMs}ms)`);
    } catch (e) {
      const wallMs = Date.now() - start;
      metrics.push({ name, wallMs });
      console.log(`FAIL (${wallMs}ms): ${(e as Error).message.slice(0, 200)}`);
      failed.push(`${name}: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  // ─── Phase 0: pre-flight balances ─────────────────────────────
  console.log(`\n--- Phase 0: pre-flight balances ---`);
  console.log(`  signer ${BASE.symbol}: ${await baseToken.balanceOf(signer.address)}`);
  for (const c of COLLATS) {
    const t = new ethers.Contract(c.address, ERC20_ABI, signer);
    console.log(`  signer ${c.symbol}: ${await t.balanceOf(signer.address)}`);
  }

  // ─── Phase 1: signer supplies base lender liquidity ───────────
  console.log(`\n--- Phase 1: signer approves + supplies base liquidity (lender) ---`);
  await step(`${BASE.symbol}.approve(comet, max) [signer]`, async () => {
    const tx = await callTx(baseToken, 'approve', [COMET, MaxUint256]);
    await tx.wait();
    return tx.hash;
  });
  await step(`comet.supply(${BASE.symbol}, ${BASE_LEND}) [signer lender]`, async () => {
    const tx = await callTx(comet, 'supply', [BASE.address, BASE_LEND]);
    await tx.wait();
    return tx.hash;
  });

  // ─── Phase 2: generate borrower wallet ────────────────────────
  console.log(`\n--- Phase 2: generate borrower wallet ---`);
  const borrower = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log(`  borrower: ${borrower.address}`);
  await step(`fund borrower with 5 native gas`, async () => {
    const tx = await sendTx(signer, {
      to: borrower.address,
      value: ethers.utils.parseEther('5'),
    });
    await tx.wait();
    return tx.hash;
  });

  // ─── Phase 3: warm borrower ATAs on all cached wrappers ──
  console.log(`\n--- Phase 3: warm borrower ATAs on base + ${COLLATS.length} collats ---`);
  for (const addr of [BASE.address, ...COLLATS.map((c: any) => c.address)]) {
    const wrapper = new ethers.Contract(addr, ENSURE_ATA_ABI, signer);
    await step(`${addr.slice(0, 10)}…ensure_token_account(borrower)`, async () => {
      const tx = await callTx(wrapper, 'ensure_token_account', [borrower.address]);
      await tx.wait();
      return tx.hash;
    });
  }

  // ─── Phase 4: fund borrower with all collats + repay dust ──
  console.log(`\n--- Phase 4: fund borrower with ${COLLATS.length} collats + repay dust ---`);
  for (const c of COLLATS) {
    const amt = collatSupply(c);
    // For freshly-bootstrapped wrappers, signer is mint authority — mint_to
    // directly.  For pre-existing v6 wrappers (wETH/wSOL), signer's mint
    // authority should also be valid (factory v6 uses caller as mint authority
    // for all create_token_mint outputs).  Fall back to transfer if mint_to
    // reverts.
    const wrapper = new ethers.Contract(c.address, [...WRAPPER_MINT_ABI, ...ERC20_ABI], signer);
    await step(`${c.symbol}.mint_to(borrower, ${amt})`, async () => {
      try {
        const tx = await callTx(wrapper as any, 'mint_to', [borrower.address, amt]);
        await tx.wait();
        return tx.hash;
      } catch {
        const tx = await callTx(wrapper as any, 'transfer', [borrower.address, amt]);
        await tx.wait();
        return tx.hash;
      }
    });
  }
  await step(`${BASE.symbol}.transfer(borrower, ${REPAY_DUST}) [repay dust]`, async () => {
    const tx = await callTx(baseToken, 'transfer', [borrower.address, REPAY_DUST]);
    await tx.wait();
    return tx.hash;
  });

  // ─── Phase 5: borrower approves Comet on base + every collat ────
  console.log(`\n--- Phase 5: borrower approves Comet on base + ${COLLATS.length} collats ---`);
  for (const addr of [BASE.address, ...COLLATS.map((c: any) => c.address)]) {
    const t = new ethers.Contract(addr, ERC20_ABI, borrower);
    const sym = addr === BASE.address ? BASE.symbol : COLLATS.find((c: any) => c.address === addr).symbol;
    await step(`${sym}.approve(comet, max) [borrower]`, async () => {
      const tx = await callTx(t, 'approve', [COMET, MaxUint256]);
      await tx.wait();
      return tx.hash;
    });
  }

  // ─── Phase 6: borrower supplies all collats ─────────────────
  console.log(`\n--- Phase 6: borrower supplies all ${COLLATS.length} cached collats ---`);
  const cometAsBorrower = comet.connect(borrower);
  for (const c of COLLATS) {
    const amt = collatSupply(c);
    await step(`comet.supply(${c.symbol}, ${amt}) [borrower]`, async () => {
      const tx = await callTx(cometAsBorrower as any, 'supply', [c.address, amt]);
      await tx.wait();
      return tx.hash;
    });
  }

  const userBasic = await comet.userBasic(borrower.address);
  const collatBits = userBasic.assetsIn.toString(2).split('1').length - 1;
  console.log(`    borrower assetsIn bitmap: 0b${userBasic.assetsIn.toString(2).padStart(16, '0')} (${collatBits} collats)`);
  if (collatBits !== COLLATS.length) {
    failed.push(`Phase 6 invariant: expected assetsIn bit count ${COLLATS.length}, got ${collatBits}`);
  }

  // ─── Phase 7: TRUE N-collat borrow ───────────────────────
  console.log(`\n--- Phase 7: TRUE ${COLLATS.length}-collat borrow (heaviest path) ---`);
  console.log(`  → Comet walks all ${COLLATS.length} collats for borrow capacity calc`);
  await step(`comet.withdraw(${BASE.symbol}, ${BORROW_AMT}) [${COLLATS.length}-collat borrow]`, async () => {
    const tx = await callTx(cometAsBorrower as any, 'withdraw', [BASE.address, BORROW_AMT]);
    await tx.wait();
    return tx.hash;
  });
  const borrowBal = await comet.borrowBalanceOf(borrower.address);
  console.log(`    borrower.borrowBalanceOf: ${borrowBal}`);

  // ─── Phase 8: repay ──────────────────────────────────────
  console.log(`\n--- Phase 8: borrower repays ---`);
  await step(`comet.supply(${BASE.symbol}, ${BORROW_AMT.add(REPAY_DUST.div(2))}) [repay]`, async () => {
    const tx = await callTx(cometAsBorrower as any, 'supply', [BASE.address, BORROW_AMT.add(REPAY_DUST.div(2))]);
    await tx.wait();
    return tx.hash;
  });
  const borrowAfter = await comet.borrowBalanceOf(borrower.address);
  console.log(`    borrower.borrowBalanceOf after repay: ${borrowAfter}`);

  // ─── Phase 9: withdraw all collats ──────────────────────
  console.log(`\n--- Phase 9: borrower withdraws all ${COLLATS.length} collats ---`);
  for (const c of COLLATS) {
    const amt = collatSupply(c);
    await step(`comet.withdraw(${c.symbol}, ${amt}) [borrower]`, async () => {
      const tx = await callTx(cometAsBorrower as any, 'withdraw', [c.address, amt]);
      await tx.wait();
      return tx.hash;
    });
  }

  // ─── Summary ─────────────────────────────────────────────
  console.log(`\n=== Summary ===`);
  console.log(`PASSED (${passed.length}):`);
  for (const s of passed) console.log(`  ✓ ${s}`);
  if (failed.length > 0) {
    console.log(`\nFAILED (${failed.length}):`);
    for (const s of failed) console.log(`  ✗ ${s}`);
  }

  const out = {
    runAt: new Date().toISOString(),
    deploymentRef: STATE_FILE,
    cometAddress: COMET,
    nCollats: COLLATS.length,
    passed: passed.length,
    failed: failed.length,
    metrics,
  };
  const metricsFile = path.join('scripts', 'hadrian-vanilla', 'gamut-metrics.json');
  fs.writeFileSync(metricsFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nmetrics: ${metricsFile}`);

  if (failed.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
