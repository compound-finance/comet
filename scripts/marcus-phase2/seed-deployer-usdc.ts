// Phase 2 — Seed the deployer's AUTHORITY_PDA's USDC ATA with a small amount
// so subsequent supply / borrow / withdraw smoke tests can run against
// UnifiedToken v2 + the upgraded Comet impl.
//
// Flow:
//   1. Compute the deployer's AUTHORITY_PDA's USDC ATA (re-derive on-chain).
//   2. Transfer 5 USDC from the Solana payer's USDC ATA to the deployer's.

import { ethers } from 'hardhat';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';

const SOLANA_RPC_PUBLIC = 'https://api.devnet.solana.com';
const SOLANA_RPC_ROME = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';
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

  // Compute AUTHORITY_PDA via Rome's SystemProgram precompile.
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
    { item: evmAddr.toLowerCase() },
  ];
  const [authPdaBytes32] = await sys.find_program_address(programIdBytes32, seeds);
  const authPdaBuf = Buffer.from(authPdaBytes32.slice(2), 'hex');
  const authPda = new PublicKey(authPdaBuf);
  console.log(`Deployer AUTHORITY_PDA: ${authPda.toBase58()}`);

  const usdcMintPk = new PublicKey(USDC_MINT);
  const recipientAta = getAssociatedTokenAddressSync(usdcMintPk, authPda, true);
  console.log(`Recipient ATA: ${recipientAta.toBase58()}`);

  const payerPath = process.env.SOLANA_PAYER_KEYPAIR_PATH;
  if (!payerPath) {
    console.error('Set SOLANA_PAYER_KEYPAIR_PATH');
    process.exit(1);
  }
  const payer = loadKeypair(payerPath);
  console.log(`Solana payer: ${payer.publicKey.toBase58()}`);

  const sourceAta = getAssociatedTokenAddressSync(usdcMintPk, payer.publicKey, false);
  console.log(`Source ATA (payer's USDC ATA): ${sourceAta.toBase58()}`);

  // Use the Solana public devnet for the TX (Rome's RPC may not handle SPL writes well).
  const conn = new Connection(SOLANA_RPC_PUBLIC, 'confirmed');

  // Check source balance
  const sourceInfo = await conn.getTokenAccountBalance(sourceAta);
  console.log(`Source balance: ${sourceInfo.value.uiAmountString} USDC`);
  if ((sourceInfo.value.uiAmount ?? 0) < 1) {
    console.error('Source ATA has insufficient USDC');
    process.exit(1);
  }

  // Transfer 5 USDC
  const amount = 5_000_000n; // 5 USDC at 6 decimals
  const ix = createTransferCheckedInstruction(
    sourceAta,
    usdcMintPk,
    recipientAta,
    payer.publicKey,
    amount,
    6,
  );

  const tx = new Transaction().add(ix);
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  console.log(`Sent transfer tx: ${sig}`);

  // HTTP polling
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: false });
    const st = value[0];
    if (st?.err) throw new Error(`Transfer failed: ${JSON.stringify(st.err)}`);
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') break;
    await new Promise(r => setTimeout(r, 2000));
  }

  const balance = await conn.getTokenAccountBalance(recipientAta);
  console.log(`Recipient ATA balance after: ${balance.value.uiAmountString} USDC`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
