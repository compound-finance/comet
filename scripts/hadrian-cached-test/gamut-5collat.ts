// Heavy-use-case gamut: Compound v3 with FIVE cached SPL_ERC20 collateral
// assets. Stresses Comet's multi-asset borrow capacity calc (iterates all
// 5 collats × price feed reads × SLOADs per borrow).
//
// Flow:
//   1. signer supplies cached wUSDC base (lender liquidity)
//   2. fresh borrower wallet generated, funded with native gas + small amount
//      of each of the 5 cached collats (signer mints to borrower via
//      wrapper.mint_to since signer is the mint authority on all 4 new wrappers;
//      cached wETH is bulk-transferred from signer's existing balance)
//   3. borrower approves Comet on all 6 cached wrappers (5 collats + 1 base)
//   4. borrower supplies all 5 collats
//   5. borrower withdraws base → TRUE multi-collat borrow
//   6. borrower repays
//   7. borrower withdraws all 5 collats
//
// Captures per-action Solana metrics — particularly Phase 5 (multi-collat
// borrow) where Comet walks all 5 collats for capacity calc.

import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

// keccak256('ensure_token_account(address)')[0:4] — used in cached-wrapper
// probe paths below if/when added. Kept as documentation reference.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ENSURE_TOKEN_ACCOUNT_SELECTOR = '0x5e094743';
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
  const [signer] = await ethers.getSigners();
  const stateFile = path.join('scripts', 'hadrian-cached-test', 'state-5collat.json');
  if (!fs.existsSync(stateFile)) {
    throw new Error(`Run deploy-5collat.ts first.`);
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

  const COMET = state.cometProxy;
  const BASE = state.baseAsset;
  const COLLATS = state.collateralAssets;
  console.log(`Signer: ${signer.address}`);
  console.log(`Comet:  ${COMET}`);
  console.log(`Base:   ${BASE.symbol} @ ${BASE.address}`);
  console.log(`Collats:`);
  for (const c of COLLATS) {
    console.log(`  ${c.symbol} ($${c.priceUsd}, ${c.borrowCollateralFactor * 100}% LTV) @ ${c.address}`);
  }

  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function decimals() view returns (uint8)',
  ];
  const WRAPPER_MINT_ABI = ['function mint_to(address to, uint256 value) returns (bool)'];
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

  // Per-collat amounts (raw units, sized so total collat value ≈ $0.50):
  //   wETH:  100  raw / 1e8  × $3000 = $0.003
  //   wHEAT: 1000 raw / 1e9  × $10   = $0.0000001  → bump to 1_000_000
  //   wSALT: 1000 raw × $5   ≈ same → bump
  //   wMILK: 1000 raw × $20  ≈ same → bump
  //   wOIL:  1000 raw × $50  ≈ same → bump
  // Actually just supply 1B raw of each so each contributes meaningful collat
  const COLLAT_SUPPLY: Record<string, BigNumber> = {
    wETH:  ethers.BigNumber.from('100'),               // 100 raw (8-dec) ≈ $0.003
    wHEAT: ethers.BigNumber.from('100000000000'),      // 100 token × 1e9 = 1e11 raw, × $10 = $1000
    wSALT: ethers.BigNumber.from('100000000000'),      // 100 × $5 = $500
    wMILK: ethers.BigNumber.from('100000000000'),      // 100 × $20 = $2000
    wOIL:  ethers.BigNumber.from('100000000000'),      // 100 × $50 = $5000
  };

  const BASE_LEND  = ethers.BigNumber.from('5000000');     // 5 wUSDC
  const BORROW_AMT = ethers.BigNumber.from('100000');      // 0.1 wUSDC borrow

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
        ? `sigs=${m.iterSigs} CU=${m.totalCU?.toLocaleString()} heap=${m.maxHeap?.toLocaleString()} span=${m.slotSpan}`
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

  // ─── Phase 0: Pre-flight balances ─────────────────────────────
  console.log(`\n--- Phase 0: pre-flight balances ---`);
  console.log(`  signer ${BASE.symbol}: ${await baseToken.balanceOf(signer.address)}`);
  for (const c of COLLATS) {
    const t = new ethers.Contract(c.address, ERC20_ABI, signer);
    console.log(`  signer ${c.symbol}: ${await t.balanceOf(signer.address)}`);
  }

  // ─── Phase 1: signer supplies base lender liquidity ───────────
  console.log(`\n--- Phase 1: signer approves + supplies base liquidity (lender) ---`);
  await step(`${BASE.symbol}.approve(comet, max) [signer]`, async () => {
    const tx = await baseToken.approve(COMET, MaxUint256, { gasLimit: 30_000_000 });
    await tx.wait();
    return tx.hash;
  });
  await step(`comet.supply(${BASE.symbol}, ${BASE_LEND}) [signer lender]`, async () => {
    const tx = await comet.supply(BASE.address, BASE_LEND, { gasLimit: 30_000_000 });
    await tx.wait();
    return tx.hash;
  });

  // ─── Phase 2: generate borrower wallet ────────────────────────
  console.log(`\n--- Phase 2: generate borrower wallet ---`);
  const borrower = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log(`  borrower: ${borrower.address}`);

  // Hadrian gas price is ~1e10 wei/gas. Each tx with gasLimit 30M needs
  // 3e17 wei = 0.3 native upfront in Rome's pre-flight check. Funding 5
  // native covers ~16 txs (the 18-tx envelope we need + headroom).
  await step(`fund borrower with 5 native gas`, async () => {
    const tx = await signer.sendTransaction({
      to: borrower.address,
      value: ethers.utils.parseEther('5'),
      gasLimit: 5_000_000,
    });
    await tx.wait();
    return tx.hash;
  });

  // ─── Phase 3: warm borrower's ATAs on all 6 cached wrappers ──
  console.log(`\n--- Phase 3: warm borrower ATAs ---`);
  for (const addr of [BASE.address, ...COLLATS.map((c: any) => c.address)]) {
    const wrapper = new ethers.Contract(addr, ['function ensure_token_account(address) returns (bytes32)'], signer);
    await step(`${addr.slice(0, 10)}…ensure_token_account(borrower)`, async () => {
      const tx = await wrapper.ensure_token_account(borrower.address, { gasLimit: 30_000_000 });
      await tx.wait();
      return tx.hash;
    });
  }

  // ─── Phase 4: fund borrower with all 5 collats + small wUSDC dust ──
  console.log(`\n--- Phase 4: fund borrower with collats + repay dust ---`);
  // 4a: cached wETH is bulk-transferred from signer (existing balance)
  const wethToken = new ethers.Contract(CACHED_WETH(state), ERC20_ABI, signer);
  await step(`wETH.transfer(borrower, ${COLLAT_SUPPLY.wETH})`, async () => {
    const tx = await wethToken.transfer(borrower.address, COLLAT_SUPPLY.wETH, { gasLimit: 30_000_000 });
    await tx.wait();
    return tx.hash;
  });
  // 4b-4e: new cached wrappers — signer is mint authority, mint directly to borrower
  for (const c of COLLATS) {
    if (c.symbol === 'wETH') continue;
    const wrapper = new ethers.Contract(c.address, WRAPPER_MINT_ABI, signer);
    await step(`${c.symbol}.mint_to(borrower, ${COLLAT_SUPPLY[c.symbol]})`, async () => {
      const tx = await wrapper.mint_to(borrower.address, COLLAT_SUPPLY[c.symbol], { gasLimit: 30_000_000 });
      await tx.wait();
      return tx.hash;
    });
  }
  // 4f: small wUSDC dust for repay interest
  const REPAY_DUST = ethers.BigNumber.from('1000');  // bumped for interest accrual
  await step(`${BASE.symbol}.transfer(borrower, ${REPAY_DUST}) [repay dust]`, async () => {
    const tx = await baseToken.transfer(borrower.address, REPAY_DUST, { gasLimit: 30_000_000 });
    await tx.wait();
    return tx.hash;
  });

  // ─── Phase 5: borrower approves Comet on all 6 ────────────────
  console.log(`\n--- Phase 5: borrower approves Comet on 6 wrappers ---`);
  for (const addr of [BASE.address, ...COLLATS.map((c: any) => c.address)]) {
    const t = new ethers.Contract(addr, ERC20_ABI, borrower);
    const sym = addr === BASE.address ? BASE.symbol : COLLATS.find((c: any) => c.address === addr).symbol;
    await step(`${sym}.approve(comet, max) [borrower]`, async () => {
      const tx = await t.approve(COMET, MaxUint256, { gasLimit: 30_000_000 });
      await tx.wait();
      return tx.hash;
    });
  }

  // ─── Phase 6: borrower supplies all 5 collats ─────────────────
  console.log(`\n--- Phase 6: borrower supplies all 5 cached collats ---`);
  const cometAsBorrower = comet.connect(borrower);
  for (const c of COLLATS) {
    await step(`comet.supply(${c.symbol}, ${COLLAT_SUPPLY[c.symbol]}) [borrower]`, async () => {
      const tx = await (cometAsBorrower as any).supply(c.address, COLLAT_SUPPLY[c.symbol], { gasLimit: 30_000_000 });
      await tx.wait();
      return tx.hash;
    });
  }

  // Snapshot assetsIn bitmap to confirm all 5 collats are recorded
  const userBasic = await comet.userBasic(borrower.address);
  console.log(`    borrower assetsIn bitmap: 0b${userBasic.assetsIn.toString(2).padStart(16, '0')} (${userBasic.assetsIn} = ${userBasic.assetsIn.toString(2).split('1').length - 1} collats)`);

  // ─── Phase 7: TRUE multi-collat borrow ───────────────────────
  console.log(`\n--- Phase 7: TRUE multi-collat borrow (HEAVY operation) ---`);
  console.log(`  → Comet must iterate all 5 collats for borrow capacity calc`);
  await step(`comet.withdraw(${BASE.symbol}, ${BORROW_AMT}) [borrower, 5-collat]`, async () => {
    const tx = await (cometAsBorrower as any).withdraw(BASE.address, BORROW_AMT, { gasLimit: 30_000_000 });
    await tx.wait();
    return tx.hash;
  });
  const borrowBal = await comet.borrowBalanceOf(borrower.address);
  console.log(`    borrower.borrowBalanceOf: ${borrowBal} (should be ${BORROW_AMT})`);

  // ─── Phase 8: repay ──────────────────────────────────────────
  console.log(`\n--- Phase 8: borrower repays ---`);
  await step(`comet.supply(${BASE.symbol}, ${BORROW_AMT.add(REPAY_DUST.div(2))}) [borrower repay]`, async () => {
    const tx = await (cometAsBorrower as any).supply(BASE.address, BORROW_AMT.add(REPAY_DUST.div(2)), { gasLimit: 30_000_000 });
    await tx.wait();
    return tx.hash;
  });
  const borrowAfter = await comet.borrowBalanceOf(borrower.address);
  console.log(`    borrower.borrowBalanceOf after repay: ${borrowAfter}`);

  // ─── Phase 9: borrower withdraws all 5 collats ────────────────
  console.log(`\n--- Phase 9: borrower withdraws all 5 collats ---`);
  for (const c of COLLATS) {
    await step(`comet.withdraw(${c.symbol}, ${COLLAT_SUPPLY[c.symbol]}) [borrower]`, async () => {
      const tx = await (cometAsBorrower as any).withdraw(c.address, COLLAT_SUPPLY[c.symbol], { gasLimit: 30_000_000 });
      await tx.wait();
      return tx.hash;
    });
  }

  // ─── Summary ─────────────────────────────────────────────────
  console.log(`\n--- Summary ---`);
  console.log(`  PASS: ${passed.length}`);
  console.log(`  FAIL: ${failed.length}`);

  console.log(`\n--- Per-action metrics ---`);
  const txRows = metrics.filter((m) => m.iterSigs !== undefined);
  if (txRows.length > 0) {
    const pad = (s: string, n: number) => s.padEnd(n);
    const padR = (s: string, n: number) => s.padStart(n);
    console.log('  ' + pad('Action', 65) + padR('wall(s)', 9) + padR('sigs', 6) + padR('Sol CU', 11) + padR('max heap', 10) + padR('slots', 7));
    console.log('  ' + '-'.repeat(108));
    for (const m of txRows) {
      const wallS = (m.wallMs / 1000).toFixed(1);
      const cuStr = m.totalCU !== undefined ? m.totalCU.toLocaleString() : '-';
      const heapStr = m.maxHeap !== undefined ? m.maxHeap.toLocaleString() : '-';
      const span = m.slotSpan !== undefined ? String(m.slotSpan) : '-';
      const sigs = m.iterSigs !== undefined ? String(m.iterSigs) : '-';
      const label = m.name.length > 64 ? m.name.slice(0, 62) + '…' : m.name;
      console.log('  ' + pad(label, 65) + padR(wallS, 9) + padR(sigs, 6) + padR(cuStr, 11) + padR(heapStr, 10) + padR(span, 7));
    }
  }

  if (failed.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failed) console.log(`  - ${f}`);
    process.exit(1);
  }
}

function CACHED_WETH(state: any): string {
  return state.collateralAssets.find((c: any) => c.symbol === 'wETH').address;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
