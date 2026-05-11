// Step 0 — direct vanilla-Compound supply CU bench against Comet-wUSDC.
// No relayer, no OrchestratorRouter, no pre-deposit dance.
//   T1. wUSDC.approve(comet, MAX)
//   T2. comet.supply(wUSDC, amount)   ← the headline number
//
// Goal: empirically establish whether replacing UnifiedToken (custom) with
// rome-solidity SPL_ERC20 wUSDC as the Compound base asset materially lowers
// per-tx CU. Prior UT-v2 baseline (post derive_user_ata patch): 927K supply.
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/bench-wusdc-supply.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_RPC    = 'https://api.devnet.solana.com';

const ADDR = {
  wusdc:      '0x39844f1d605a11acd87f766494291bbd11b406f4',
  cometProxy: '0x42eB6EA38862e9F00F1E3aef9FC0bBfbd5C88215', // Comet-wUSDC (Step 0)
};

const SUPPLY_AMOUNT_RAW = 100_000n; // 0.1 wUSDC (6 decimals)
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

  const wusdc = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', ADDR.wusdc, deployer);
  const comet = await ethers.getContractAt('contracts/Comet.sol:Comet', ADDR.cometProxy, deployer);

  // Sanity
  const wBal = await wusdc.balanceOf(deployer.address);
  console.log(`Deployer wUSDC: ${ethers.utils.formatUnits(wBal, 6)}`);
  if (wBal.lt(SUPPLY_AMOUNT_RAW * BigInt(ITERATIONS))) {
    throw new Error(`Insufficient wUSDC — need ${Number(SUPPLY_AMOUNT_RAW * BigInt(ITERATIONS)) / 1e6}, have ${ethers.utils.formatUnits(wBal, 6)}`);
  }

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    addresses: ADDR,
    iterations: ITERATIONS,
    supplyAmountRaw: SUPPLY_AMOUNT_RAW.toString(),
    setup: {} as any,
    runs: [] as any[],
  };

  // ── Pre-step: ensure approval ──
  console.log('═══════ PRE-SETUP ═══════');
  const allowance = await wusdc.allowance(deployer.address, ADDR.cometProxy);
  if (allowance.lt(SUPPLY_AMOUNT_RAW * BigInt(ITERATIONS))) {
    out.setup.approve = await captureStep('S0. wUSDC.approve(comet, MAX)', () =>
      wusdc.approve(ADDR.cometProxy, ethers.constants.MaxUint256, { gasLimit: 30_000_000 }),
    );
  } else {
    console.log(`[S0] approval already in place (${allowance.toString()}) — skipping`);
  }

  // ── Supply iterations ──
  for (let i = 0; i < ITERATIONS; i++) {
    console.log(`\n══════ Supply iteration ${i + 1}/${ITERATIONS} ══════`);
    const run: any = { iteration: i + 1, steps: {} };

    run.steps.supply = await captureStep(`S1. comet.supply(wUSDC, ${SUPPLY_AMOUNT_RAW})`, () =>
      comet.supply(ADDR.wusdc, SUPPLY_AMOUNT_RAW, { gasLimit: 50_000_000 }),
    );

    const overallMax = run.steps.supply.maxCu;
    const overallTotal = run.steps.supply.totalCu;
    run.summary = { maxSingleSolanaTxCU: overallMax, totalCU: overallTotal, atomicFitsCeiling: overallMax < 1_400_000 };
    console.log(`\n  ── Iter ${i + 1} summary ──`);
    console.log(`    max single Solana tx CU: ${overallMax.toLocaleString()} (ceiling: 1,400,000)`);
    console.log(`    total CU: ${overallTotal.toLocaleString()}`);
    console.log(`    fits 1.4M atomic ceiling: ${run.summary.atomicFitsCeiling ? '✅ YES' : '❌ NO'}`);
    out.runs.push(run);
  }

  const outPath = path.join(__dirname, 'bench-wusdc-supply.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);

  // Quick comparison readout
  const supplyMax = out.runs[0]?.steps?.supply?.maxCu ?? 0;
  const utV2Baseline = 927_351;
  const delta = supplyMax - utV2Baseline;
  console.log(`\n══════ vs UT-v2 (927,351 baseline) ══════`);
  console.log(`  wUSDC supply:    ${supplyMax.toLocaleString()}`);
  console.log(`  delta vs UT-v2:  ${delta >= 0 ? '+' : ''}${delta.toLocaleString()} CU`);
  console.log(`  interp:          ${Math.abs(delta) < 50_000 ? '≈ comparable (no atomic-composed unlock from base swap alone)' : (delta < 0 ? 'meaningfully lighter' : 'unexpectedly heavier')}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
