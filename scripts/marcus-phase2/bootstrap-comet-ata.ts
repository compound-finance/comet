// Phase 2 — Bootstrap CometProxy's AUTHORITY_PDA's USDC ATA so Compound
// supply transfers (transferFrom user → comet) can land on-chain.

import { ethers } from 'hardhat';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';

const SOLANA_RPC_PUBLIC = 'https://api.devnet.solana.com';
const PROGRAM_ID = 'RomeDbGQYbqomGVk13h9JkQHKoNWKB84Lw1ij9AtRXT';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const COMET_PROXY_EVM = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Bootstrapping CometProxy's USDC ATA on Solana devnet`);
  console.log(`CometProxy EVM: ${COMET_PROXY_EVM}`);

  const SystemProgramAbi = [
    'function find_program_address(bytes32 program, tuple(bytes item)[] seeds) external pure returns (bytes32, uint8)',
  ];
  const sysAddr = '0xfF00000000000000000000000000000000000007';
  const sys = new ethers.Contract(sysAddr, SystemProgramAbi, signer);

  const programIdBytes = bs58.decode(PROGRAM_ID);
  const programIdBytes32 = '0x' + Buffer.from(programIdBytes).toString('hex');

  const seeds = [
    { item: ethers.utils.toUtf8Bytes('EXTERNAL_AUTHORITY') },
    { item: COMET_PROXY_EVM.toLowerCase() },
  ];
  const [authPdaBytes32] = await sys.find_program_address(programIdBytes32, seeds);
  const authPdaBuf = Buffer.from(authPdaBytes32.slice(2), 'hex');
  const authPda = new PublicKey(authPdaBuf);
  console.log(`CometProxy AUTHORITY_PDA: ${authPda.toBase58()}`);

  const usdcMintPk = new PublicKey(USDC_MINT);
  const ata = getAssociatedTokenAddressSync(usdcMintPk, authPda, true);
  console.log(`CometProxy AUTHORITY_PDA's USDC ATA: ${ata.toBase58()}`);

  const conn = new Connection(SOLANA_RPC_PUBLIC, 'confirmed');
  const existing = await conn.getAccountInfo(ata);
  if (existing) {
    console.log(`ATA already exists; no-op.`);
    return;
  }
  console.log('ATA does not exist; creating...');

  const payerPath = process.env.SOLANA_PAYER_KEYPAIR_PATH;
  if (!payerPath) {
    console.error('Set SOLANA_PAYER_KEYPAIR_PATH');
    process.exit(1);
  }
  const payer = loadKeypair(payerPath);

  const ix = createAssociatedTokenAccountInstruction(
    payer.publicKey,
    ata,
    authPda,
    usdcMintPk,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const tx = new Transaction().add(ix);
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  console.log(`Sent ATA-create tx: ${sig}`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: false });
    const st = value[0];
    if (st?.err) throw new Error(`Failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') break;
    await new Promise(r => setTimeout(r, 2000));
  }
  const after = await conn.getAccountInfo(ata);
  console.log(`ATA after: ${after ? `${after.data.length} bytes OK` : 'NOT CREATED'}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
