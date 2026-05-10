// Bootstrap ATAs for any EVM address that needs SPL operations on Marcus.
// Uses a Solana-side payer wallet (funded by us with SOL + USDC) to:
//   1. Derive each EVM address's ExternalAuthPda
//   2. Compute ATA(PDA, USDC_MINT) for each
//   3. If the ATA doesn't exist, send a tiny USDC seed via
//      `createAssociatedTokenAccountIdempotent` + `transferChecked`,
//      which atomically allocates the ATA and credits a starter balance.
//
// Idempotent: re-running is safe; existing ATAs are skipped.
//
// Run:
//   npx ts-node scripts/marcus-phase4-fresh-deploy/bootstrap-atas.ts
// (no hardhat needed — pure Solana RPC)

import {
  Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';
import * as path from 'path';

const SOL_RPC      = 'https://api.devnet.solana.com';
const PROGRAM_ID   = 'romedpkFKEu3JJrYujtNUferyEv47UxvjZe2QcdPwN8';
const USDC_MINT    = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_DECIMALS = 6;

// Targets that need ATA bootstrapping for the Phase 4 supply bench.
const TARGETS: { label: string; evmAddr: string }[] = [
  { label: 'Deployer (test user)',    evmAddr: '0xe4abFBCa0FEACc65BA51602Bcbc8AA9B797830AF' },
  { label: 'CometProxy (decimals=6)', evmAddr: '0xDf203b46C89921537F24beA30046eb1FF8c3FCD3' },
  { label: 'OrchestratorRouter (decimals=6)', evmAddr: '0x02Ed3401ba0f75a2ebF4E3f724B1C115EC110914' },
  { label: 'CometProxy (collateral stack)',   evmAddr: '0x057c15b0162CC8b6242Ac22A6B9FC92B00e3c710' },
  { label: 'OrchestratorRouter (collateral)', evmAddr: '0xDD3841043b49836D7A27323fb109553CB3dD0bd0' },
  // v2 (post derive_user_ata patch) — Phase 4 measurement deploy 2026-05-10
  { label: 'CometProxy v2 (UT-v2 base)',       evmAddr: '0x65c88dE3f52594B9e9946685121266F1714Cc055' },
  { label: 'OrchestratorRouter v2 (UT-v2)',    evmAddr: '0xa42Dab5d42E61B1Fa407e79075b9f52A1DB0fE98' },
  // v2-collat (collateral-aware Comet-v2 for Phase F borrow re-bench)
  { label: 'CometProxy v2-collat (UT-v2 base)', evmAddr: '0x454CF4E6ECA5Aa9F3168ff0b04D0FE37E942bb76' },
  { label: 'OrchestratorRouter v2-collat',      evmAddr: '0xCDa98Ee216f254655cAa7CAb345D9db28565f109' },
];

// Each ATA gets seeded with this much USDC to allocate it (the create
// happens via createAssociatedTokenAccountIdempotent, but we also need
// to land *some* tokens so the SPL transfer_checked path during real
// supply doesn't fail with NoSourceForFee or similar). 0.01 USDC keeps
// the seed minimal.
const SEED_AMOUNT_RAW = 10_000n; // 0.01 USDC at 6 decimals

function deriveExternalAuthPda(evmAddr: string, programId: PublicKey): [PublicKey, number] {
  const seeds = [
    Buffer.from('EXTERNAL_AUTHORITY'),
    Buffer.from(evmAddr.slice(2).toLowerCase(), 'hex'),
  ];
  return PublicKey.findProgramAddressSync(seeds, programId);
}

async function ataExists(conn: Connection, ata: PublicKey): Promise<boolean> {
  const info = await conn.getAccountInfo(ata, 'confirmed');
  return info !== null;
}

async function main() {
  const keyPath = process.env.HOME + '/.secrets/marcus/compound-phase4-solana.json';
  const secret = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(secret));
  console.log(`Payer wallet: ${payer.publicKey.toBase58()}`);

  const conn = new Connection(SOL_RPC, 'confirmed');
  const programId = new PublicKey(PROGRAM_ID);
  const usdcMint = new PublicKey(USDC_MINT);

  // Sanity: payer SOL + USDC
  const solBal = await conn.getBalance(payer.publicKey);
  const payerAta = getAssociatedTokenAddressSync(usdcMint, payer.publicKey);
  let payerUsdc = 0n;
  try {
    const bal = await conn.getTokenAccountBalance(payerAta, 'confirmed');
    payerUsdc = BigInt(bal.value.amount);
  } catch (e) {}
  console.log(`Payer SOL:    ${solBal / 1e9}`);
  console.log(`Payer USDC:   ${Number(payerUsdc) / 1e6}\n`);
  if (solBal < 0.005 * 1e9) throw new Error('Payer SOL too low — fund with at least 0.005 SOL');
  if (payerUsdc < BigInt(TARGETS.length) * SEED_AMOUNT_RAW)
    throw new Error(`Payer USDC too low — need at least ${(TARGETS.length * Number(SEED_AMOUNT_RAW)) / 1e6} USDC`);

  const out: any = {
    timestamp: new Date().toISOString(),
    payer: payer.publicKey.toBase58(),
    seedAmountUsdc: Number(SEED_AMOUNT_RAW) / 10 ** USDC_DECIMALS,
    targets: [] as any[],
  };

  for (const t of TARGETS) {
    const [pda, bump] = deriveExternalAuthPda(t.evmAddr, programId);
    const ata = getAssociatedTokenAddressSync(usdcMint, pda, true);
    const exists = await ataExists(conn, ata);
    console.log(`▸ ${t.label} (${t.evmAddr})`);
    console.log(`    PDA:    ${pda.toBase58()} (bump=${bump})`);
    console.log(`    ATA:    ${ata.toBase58()}`);
    console.log(`    state:  ${exists ? 'EXISTS — skipping' : 'MISSING — bootstrapping'}`);

    if (exists) {
      out.targets.push({ ...t, pda: pda.toBase58(), ata: ata.toBase58(), bootstrapped: false });
      continue;
    }

    const tx = new Transaction()
      .add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,  // funding payer
          ata,              // ATA to create
          pda,              // owner
          usdcMint,
          TOKEN_PROGRAM_ID,
        ),
      )
      .add(
        createTransferCheckedInstruction(
          payerAta,         // source
          usdcMint,
          ata,              // dest
          payer.publicKey,  // owner of source
          Number(SEED_AMOUNT_RAW),
          USDC_DECIMALS,
        ),
      );

    const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' });
    console.log(`    sig:    ${sig}`);
    out.targets.push({
      ...t,
      pda: pda.toBase58(),
      ata: ata.toBase58(),
      bootstrapped: true,
      sig,
    });
    console.log();
  }

  const outPath = path.join(__dirname, 'bootstrap-atas.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
