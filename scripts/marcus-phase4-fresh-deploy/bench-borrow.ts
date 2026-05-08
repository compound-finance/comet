// Phase 4 — borrow bench. Validates the borrow path's per-Solana-tx CU.
//
// Pre-steps (one-time, idempotent-ish):
//   B0a. Deployer approves Comet on PCOL collateral
//   B0b. Deployer calls comet.supply(PCOL, X) to register collateral position
//   B0c. Deployer transfers some USDC to Comet's ATA so it has reserves
//        (same path as supply T2 — UnifiedToken.transfer → spl_transfer_checked_v1)
//
// Bench step (the actual borrow, what we're measuring):
//   B1.  Deployer calls comet.withdraw(baseToken=UnifiedToken, amount=Y)
//        Internally: accrue() + solvency check + doTransferOut → UnifiedToken.transfer
//        (which goes through spl_transfer_checked_v1 again, this time Comet → user)

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_RPC    = 'https://api.devnet.solana.com';

const ADDR = {
  unifiedToken: '0xe76bb4c8C0f50C75eE348E91ddd34f4043582aCC',
  pcol:         '0x06419D33D1cfBc406Ca50EC014Ec02117742907f',
  cometProxy:   '0x057c15b0162CC8b6242Ac22A6B9FC92B00e3c710', // collateral-aware Comet
};

const COLLATERAL_AMOUNT = ethers.utils.parseUnits('100', 18); // 100 PCOL
const SEED_USDC_RAW     = 50_000n; // 0.05 USDC
const BORROW_USDC_RAW   = 10_000n; // 0.01 USDC (well under collateral × 0.7 BCF)
const ITERATIONS = parseInt(process.env.ITERATIONS || '1', 10);

async function rpc(method: string, params: any[], rpcUrl = MARCUS_RPC): Promise<any> {
  const r = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((x: any) => x.json());
  if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
  return r.result;
}

async function getSolanaCu(evmTxHash: string): Promise<{ sigs: string[]; perSig: { sig: string; cu: number | null; err: any }[]; maxCu: number; totalCu: number }> {
  let sigs: string[] = [];
  try {
    sigs = await rpc('rome_solanaTxForEvmTx', [evmTxHash]);
  } catch (e) {
    return { sigs: [], perSig: [], maxCu: 0, totalCu: 0 };
  }
  const perSig = [] as { sig: string; cu: number | null; err: any }[];
  let maxCu = 0;
  let totalCu = 0;
  for (const sig of sigs) {
    let meta: any = null;
    for (let i = 0; i < 8; i++) {
      const tx = await rpc('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }], SOL_RPC).catch(() => null);
      if (tx?.meta) { meta = tx.meta; break; }
      await new Promise(r => setTimeout(r, 1500));
    }
    const cu = meta?.computeUnitsConsumed ?? null;
    perSig.push({ sig, cu, err: meta?.err });
    if (cu) {
      maxCu = Math.max(maxCu, cu);
      totalCu += cu;
    }
  }
  return { sigs, perSig, maxCu, totalCu };
}

async function captureStep(label: string, run: () => Promise<any>): Promise<{ txHash: string; gasUsed: string; sigs: string[]; perSig: any[]; maxCu: number; totalCu: number }> {
  console.log(`[${label}]`);
  const tx = await run();
  const r = await tx.wait();
  console.log(`  evm tx: ${tx.hash}  block: ${r.blockNumber}  gasUsed: ${r.gasUsed}`);
  const cu = await getSolanaCu(tx.hash);
  console.log(`  solana sigs: ${cu.sigs.length}  maxCU: ${cu.maxCu.toLocaleString()}  totalCU: ${cu.totalCu.toLocaleString()}`);
  return { txHash: tx.hash, gasUsed: r.gasUsed.toString(), ...cu };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer (test user): ${deployer.address}\n`);

  const pcol = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', ADDR.pcol, deployer);
  const ut   = await ethers.getContractAt('contracts/unified-token/UnifiedToken.sol:UnifiedToken', ADDR.unifiedToken, deployer);
  const comet = await ethers.getContractAt('contracts/Comet.sol:Comet', ADDR.cometProxy, deployer);

  // Sanity
  const pcolBal = await pcol.balanceOf(deployer.address);
  const utBal = await ut.balanceOf(deployer.address);
  console.log(`Deployer PCOL: ${ethers.utils.formatUnits(pcolBal, 18)}`);
  console.log(`Deployer UT (USDC): ${ethers.utils.formatUnits(utBal, 6)}\n`);
  if (pcolBal.lt(COLLATERAL_AMOUNT)) throw new Error('Insufficient PCOL');
  if (utBal.lt(SEED_USDC_RAW + BORROW_USDC_RAW)) {
    console.log(`WARN: deployer UT balance ${utBal} < ${SEED_USDC_RAW + BORROW_USDC_RAW} — may revert at seed step`);
  }

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    addresses: ADDR,
    iterations: ITERATIONS,
    collateralAmount: COLLATERAL_AMOUNT.toString(),
    seedUsdcRaw: SEED_USDC_RAW.toString(),
    borrowUsdcRaw: BORROW_USDC_RAW.toString(),
    setup: {} as any,
    runs: [] as any[],
  };

  // ─────── Pre-step: setup (one-time) ───────
  console.log('═══════ PRE-SETUP (one-time) ═══════');

  const pcolAllowance = await pcol.allowance(deployer.address, ADDR.cometProxy);
  if (pcolAllowance.lt(COLLATERAL_AMOUNT)) {
    out.setup.pcolApprove = await captureStep('B0a. PCOL.approve(comet, max)', () =>
      pcol.approve(ADDR.cometProxy, ethers.constants.MaxUint256, { gasLimit: 5_000_000 }),
    );
  } else {
    console.log(`[B0a] PCOL approval already in place — skipping`);
  }

  const userBasic = await comet.userBasic(deployer.address);
  const collateralBalance = await comet.userCollateral(deployer.address, ADDR.pcol);
  if (collateralBalance.balance.lt(COLLATERAL_AMOUNT)) {
    out.setup.supplyCollateral = await captureStep('B0b. comet.supply(PCOL, 100)', () =>
      comet.supply(ADDR.pcol, COLLATERAL_AMOUNT, { gasLimit: 50_000_000 }),
    );
  } else {
    console.log(`[B0b] PCOL collateral already supplied (${collateralBalance.balance}) — skipping`);
  }

  const cometUtBal = await ut.balanceOf(ADDR.cometProxy);
  if (cometUtBal.lt(SEED_USDC_RAW * BigInt(ITERATIONS))) {
    out.setup.seedComet = await captureStep('B0c. UnifiedToken.transfer(comet, seed)', () =>
      ut.transfer(ADDR.cometProxy, SEED_USDC_RAW * BigInt(ITERATIONS), { gasLimit: 30_000_000 }),
    );
  } else {
    console.log(`[B0c] Comet has ${cometUtBal} UT — sufficient, skipping seed`);
  }

  // ─────── Borrow iterations ───────
  for (let i = 0; i < ITERATIONS; i++) {
    console.log(`\n══════ Borrow iteration ${i + 1}/${ITERATIONS} ══════`);
    const run: any = { iteration: i + 1, steps: {} };

    run.steps.borrow = await captureStep(`B1. comet.withdraw(USDC, ${BORROW_USDC_RAW})`, () =>
      comet.withdraw(ADDR.unifiedToken, BORROW_USDC_RAW, { gasLimit: 50_000_000 }),
    );

    const overallMax = run.steps.borrow.maxCu;
    const overallTotal = run.steps.borrow.totalCu;
    run.summary = { maxSingleSolanaTxCU: overallMax, totalCU: overallTotal, atomicFitsCeiling: overallMax < 1_400_000 };
    console.log(`\n  ── Iter ${i + 1} summary ──`);
    console.log(`    max single Solana tx CU: ${overallMax.toLocaleString()} (ceiling: 1,400,000)`);
    console.log(`    total CU across borrow: ${overallTotal.toLocaleString()}`);
    console.log(`    fits 1.4M ceiling per Solana tx: ${run.summary.atomicFitsCeiling ? '✅ YES' : '❌ NO'}`);
    out.runs.push(run);
  }

  const outPath = path.join(__dirname, 'bench-borrow.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
