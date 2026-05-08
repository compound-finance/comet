// Phase 4 — CU bench for Compound supply via OrchestratorRouter.
// Three EVM txs per supply iteration (each = 1 Solana tx underneath):
//   T1. Relayer  → router.snapshotForPendingSupply(userPubkey, amount)
//   T2. User     → unifiedToken.transfer(comet, amount)   [pre-deposit]
//   T3. Relayer  → router.completeSupplyForUser(userPubkey, amount)
//
// For each EVM tx we look up the underlying Solana sigs via
// rome_solanaTxForEvmTx, then read each sig's computeUnitsConsumed.
// The headline number is "atomic" supply CU = max single Solana tx CU
// across the three steps; if any single Solana tx > 1.4M, atomic mode
// fails and supply has to fall back to iterative.

import { ethers } from 'hardhat';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_RPC    = 'https://api.devnet.solana.com';
const PROGRAM_ID = 'romedpkFKEu3JJrYujtNUferyEv47UxvjZe2QcdPwN8';
const USDC_MINT  = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const ADDR = {
  unifiedToken:    '0xe76bb4c8C0f50C75eE348E91ddd34f4043582aCC', // redeploy with decimals=6
  cometProxy:      '0xDf203b46C89921537F24beA30046eb1FF8c3FCD3',
  router:          '0x02Ed3401ba0f75a2ebF4E3f724B1C115EC110914',
};

const SUPPLY_AMOUNT_USDC_RAW = 10_000n; // 0.01 USDC (6 dec)
const ITERATIONS = parseInt(process.env.ITERATIONS || '1', 10);

function deriveExternalAuthPda(evmAddr: string): PublicKey {
  const seeds = [
    Buffer.from('EXTERNAL_AUTHORITY'),
    Buffer.from(evmAddr.slice(2).toLowerCase(), 'hex'),
  ];
  const [pda] = PublicKey.findProgramAddressSync(seeds, new PublicKey(PROGRAM_ID));
  return pda;
}

async function rpc(method: string, params: any[], rpcUrl = MARCUS_RPC): Promise<any> {
  const r = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((x: any) => x.json());
  if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
  return r.result;
}

async function getSolanaCu(evmTxHash: string): Promise<{ sigs: string[]; perSig: { sig: string; cu: number | null; err: any }[]; maxCu: number; totalCu: number }> {
  // Find the Solana tx(s) underlying this EVM tx.
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
    // Wait briefly for confirmation propagation to public devnet.
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

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0]; // index 0 — pk
  const relayer  = signers[1]; // index 1 — pk + 1 (deriveAccounts convention)
  if (!relayer) throw new Error('Need at least 2 derived signers (set ETH_PK)');
  console.log(`Deployer (test user): ${deployer.address}`);
  console.log(`Relayer:              ${relayer.address}`);

  // Deployer's PDA pubkey = userPubkey for snapshot/complete
  const userPda = deriveExternalAuthPda(deployer.address);
  const userPubkey = '0x' + Buffer.from(userPda.toBytes()).toString('hex');
  console.log(`Deployer PDA (userPubkey): ${userPda.toBase58()}\n`);

  // Sanity: deployer has UnifiedToken balance
  const ut = await ethers.getContractAt('contracts/unified-token/UnifiedToken.sol:UnifiedToken', ADDR.unifiedToken, deployer);
  const utBal = await ut.balanceOf(deployer.address);
  console.log(`Deployer UnifiedToken balance: ${ethers.utils.formatUnits(utBal, 6)} USDC`);
  if (utBal.lt(SUPPLY_AMOUNT_USDC_RAW * BigInt(ITERATIONS))) {
    throw new Error(`Insufficient UnifiedToken balance — need ${Number(SUPPLY_AMOUNT_USDC_RAW * BigInt(ITERATIONS)) / 1e6} USDC for ${ITERATIONS} iterations`);
  }

  const router = await ethers.getContractAt('OrchestratorRouter', ADDR.router, relayer);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    program: PROGRAM_ID,
    iterations: ITERATIONS,
    supplyAmountRaw: SUPPLY_AMOUNT_USDC_RAW.toString(),
    addresses: ADDR,
    runs: [] as any[],
  };

  for (let i = 0; i < ITERATIONS; i++) {
    console.log(`\n══════ Iteration ${i + 1}/${ITERATIONS} ══════`);
    const run: any = { iteration: i + 1, steps: {} };

    // T1. snapshotForPendingSupply (relayer)
    console.log('[T1] snapshotForPendingSupply…');
    const t1 = await router.snapshotForPendingSupply(userPubkey, SUPPLY_AMOUNT_USDC_RAW, { gasLimit: 30_000_000 });
    const t1r = await t1.wait();
    console.log(`  evm tx: ${t1.hash}  block: ${t1r.blockNumber}  gasUsed: ${t1r.gasUsed}`);
    const t1cu = await getSolanaCu(t1.hash);
    console.log(`  solana sigs: ${t1cu.sigs.length}  maxCU: ${t1cu.maxCu.toLocaleString()}  totalCU: ${t1cu.totalCu.toLocaleString()}`);
    run.steps.snapshot = { txHash: t1.hash, gasUsed: t1r.gasUsed.toString(), ...t1cu };

    // T2. unifiedToken.transfer(comet, amount) — the heavy CPI tx (PR #4 spl_transfer_checked_v1 path)
    console.log('[T2] UnifiedToken.transfer(comet) — pre-deposit…');
    const ut2 = ut.connect(deployer);
    const t2 = await ut2.transfer(ADDR.cometProxy, SUPPLY_AMOUNT_USDC_RAW, { gasLimit: 30_000_000 });
    const t2r = await t2.wait();
    console.log(`  evm tx: ${t2.hash}  block: ${t2r.blockNumber}  gasUsed: ${t2r.gasUsed}`);
    const t2cu = await getSolanaCu(t2.hash);
    console.log(`  solana sigs: ${t2cu.sigs.length}  maxCU: ${t2cu.maxCu.toLocaleString()}  totalCU: ${t2cu.totalCu.toLocaleString()}`);
    run.steps.preDepositTransfer = { txHash: t2.hash, gasUsed: t2r.gasUsed.toString(), ...t2cu };

    // T3. completeSupplyForUser (relayer) — Comet.supply with V3.1 doTransferIn path
    console.log('[T3] completeSupplyForUser…');
    const t3 = await router.completeSupplyForUser(userPubkey, SUPPLY_AMOUNT_USDC_RAW, { gasLimit: 50_000_000 });
    const t3r = await t3.wait();
    console.log(`  evm tx: ${t3.hash}  block: ${t3r.blockNumber}  gasUsed: ${t3r.gasUsed}`);
    const t3cu = await getSolanaCu(t3.hash);
    console.log(`  solana sigs: ${t3cu.sigs.length}  maxCU: ${t3cu.maxCu.toLocaleString()}  totalCU: ${t3cu.totalCu.toLocaleString()}`);
    run.steps.complete = { txHash: t3.hash, gasUsed: t3r.gasUsed.toString(), ...t3cu };

    const overallMax = Math.max(t1cu.maxCu, t2cu.maxCu, t3cu.maxCu);
    const overallTotal = t1cu.totalCu + t2cu.totalCu + t3cu.totalCu;
    run.summary = { maxSingleSolanaTxCU: overallMax, totalCU: overallTotal, atomicFitsCeiling: overallMax < 1_400_000 };
    console.log(`\n  ── Iter ${i + 1} summary ──`);
    console.log(`    max single Solana tx CU: ${overallMax.toLocaleString()} (ceiling: 1,400,000)`);
    console.log(`    total CU across all steps: ${overallTotal.toLocaleString()}`);
    console.log(`    atomic mode fits 1.4M ceiling: ${run.summary.atomicFitsCeiling ? '✅ YES' : '❌ NO'}`);
    out.runs.push(run);
  }

  const outPath = path.join(__dirname, 'bench-supply.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2, /*replacer*/ (_, v) => typeof v === 'bigint' ? v.toString() : v));
  console.log(`\nResults: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
