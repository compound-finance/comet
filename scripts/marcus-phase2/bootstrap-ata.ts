// Phase 2 — bootstrap the deployer's AUTHORITY_PDA's USDC ATA on Solana devnet
// so subsequent EVM-lane CPIs (approve, transfer, transferFrom) can land.
//
// Approach:
//   1. Compute the deployer's AUTHORITY_PDA via Marcus's SystemProgram precompile
//      (find_program_address on chain — that's the canonical derivation).
//   2. Compute the ATA pubkey via the same precompile.
//   3. Create the ATA on Solana devnet using a Solana payer keypair (paid by the
//      operator). This is a Solana-side action, not an EVM tx.
//   4. Optionally transfer a tiny amount of USDC from a funded source ATA
//      to seed the new ATA.
//
// Required env:
//   - ETH_PK: deployer EVM private key (used to derive deployer.address)
//   - SOLANA_PAYER_KEYPAIR_PATH or SOLANA_PAYER_KEY: funded Solana payer
//   - SOLANA_USDC_SOURCE_KEYPAIR_PATH (optional): if set, transfer 0.1 USDC

import { ethers } from 'hardhat';
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';

const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';
const PROGRAM_ID = 'RomeDbGQYbqomGVk13h9JkQHKoNWKB84Lw1ij9AtRXT';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const [signer] = await ethers.getSigners();
  const evmAddr = signer.address;
  console.log(`Deployer EVM addr: ${evmAddr}`);

  // Compute AUTHORITY_PDA via Rome's SystemProgram precompile (chain call).
  // This is what UnifiedToken does internally; we use the same path.
  const SystemProgramAbi = [
    'function find_program_address(bytes32 program, tuple(bytes item)[] seeds) external pure returns (bytes32, uint8)',
    'function rome_evm_program_id() external view returns (bytes32)',
  ];
  const sysAddr = '0xfF00000000000000000000000000000000000007';
  const sys = new ethers.Contract(sysAddr, SystemProgramAbi, signer);

  const programIdBytes = bs58.decode(PROGRAM_ID);
  const programIdBytes32 = '0x' + Buffer.from(programIdBytes).toString('hex');

  const seeds = [
    { item: ethers.utils.toUtf8Bytes('EXTERNAL_AUTHORITY') },
    { item: evmAddr.toLowerCase() }, // 20 bytes hex (matches abi.encodePacked(address))
  ];
  const [authPdaBytes32] = await sys.find_program_address(programIdBytes32, seeds);
  const authPdaBuf = Buffer.from(authPdaBytes32.slice(2), 'hex');
  const authPda = new PublicKey(authPdaBuf);
  console.log(`Deployer AUTHORITY_PDA: ${authPda.toBase58()}`);

  // Compute ATA classically (off-chain, deterministic).
  const usdcMintPk = new PublicKey(USDC_MINT);
  const ata = getAssociatedTokenAddressSync(usdcMintPk, authPda, true /* allowOwnerOffCurve */);
  console.log(`Deployer AUTHORITY_PDA's USDC ATA: ${ata.toBase58()}`);

  // Check if ATA already exists.
  const conn = new Connection(SOLANA_RPC, 'confirmed');
  const existing = await conn.getAccountInfo(ata);
  if (existing) {
    console.log(`ATA already exists (data length: ${existing.data.length} bytes). No-op.`);
    return;
  }
  console.log('ATA does not exist; creating...');

  // Load Solana payer (funded with SOL on devnet).
  const payerPath = process.env.SOLANA_PAYER_KEYPAIR_PATH;
  if (!payerPath) {
    console.error('Set SOLANA_PAYER_KEYPAIR_PATH to a funded Solana keypair file path.');
    process.exit(1);
  }
  const payer = loadKeypair(payerPath);
  console.log(`Solana payer: ${payer.publicKey.toBase58()}`);

  const balance = await conn.getBalance(payer.publicKey);
  console.log(`Solana payer balance: ${balance / 1e9} SOL`);
  if (balance < 0.01 * 1e9) {
    console.error(`Solana payer balance too low: ${balance / 1e9} SOL. Need ~0.01 SOL minimum.`);
    process.exit(1);
  }

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
  // HTTP polling (Rome RPC doesn't support WebSocket).
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: false });
    const st = value[0];
    if (st?.err) throw new Error(`ATA-create failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') break;
    await new Promise(r => setTimeout(r, 2000));
  }
  const after = await conn.getAccountInfo(ata);
  console.log(`ATA after create: ${after ? `${after.data.length} bytes OK` : 'NOT CREATED'}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
