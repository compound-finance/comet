// Derive the Comet contract's PDA + USDC ATA so we know whether we
// need to bootstrap that account too before any UnifiedToken.transfer
// to Comet works.

import { ethers } from 'hardhat';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const PROGRAM_ID = 'romedpkFKEu3JJrYujtNUferyEv47UxvjZe2QcdPwN8';
const USDC_MINT  = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SYS_ADDR   = '0xfF00000000000000000000000000000000000007';
const COMET_PROXY = '0x8E471Df008CaD1DDCb750902658B6b77668d9dBb';
const ROUTER     = '0x46DF5b19C121fDa1975d89a8a76708C132f75FB5';

async function deriveAtaFor(label: string, evmAddr: string, signer: any, sys: any, programIdBytes32: string, usdcMintPk: PublicKey) {
  const seeds = [
    { item: ethers.utils.toUtf8Bytes('EXTERNAL_AUTHORITY') },
    { item: evmAddr.toLowerCase() },
  ];
  const [pdaBytes32, bump] = await sys.find_program_address(programIdBytes32, seeds);
  const pda = new PublicKey(Buffer.from(pdaBytes32.slice(2), 'hex'));
  const ata = getAssociatedTokenAddressSync(usdcMintPk, pda, true);
  console.log(`${label}:`);
  console.log(`  EVM addr: ${evmAddr}`);
  console.log(`  PDA:      ${pda.toBase58()} (bump=${bump})`);
  console.log(`  ATA:      ${ata.toBase58()}`);
  return { pda, ata };
}

async function main() {
  const [signer] = await ethers.getSigners();
  const sysAbi = ['function find_program_address(bytes32 program, tuple(bytes item)[] seeds) external pure returns (bytes32, uint8)'];
  const sys = new ethers.Contract(SYS_ADDR, sysAbi, signer);
  const programIdBytes32 = '0x' + Buffer.from(bs58.decode(PROGRAM_ID)).toString('hex');
  const usdcMintPk = new PublicKey(USDC_MINT);

  console.log('Required ATAs for Phase D:\n');
  await deriveAtaFor('Deployer (test user)', signer.address, signer, sys, programIdBytes32, usdcMintPk);
  console.log();
  await deriveAtaFor('CometProxy', COMET_PROXY, signer, sys, programIdBytes32, usdcMintPk);
  console.log();
  await deriveAtaFor('OrchestratorRouter', ROUTER, signer, sys, programIdBytes32, usdcMintPk);

  // Check live state of each on Solana
  const SOL_RPC = 'https://api.devnet.solana.com';
  console.log('\nLive Solana state:');
  for (const [label, addr] of [
    ['Deployer ATA', 'DcSxZawrYNG7GuQrLkMuAdFxLHNYMC8yccwe7UMmyUyf'],
  ]) {
    const r = await fetch(SOL_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [addr, { encoding: 'jsonParsed', commitment: 'confirmed' }] }),
    }).then((x: any) => x.json());
    console.log(`  ${label} ${addr}: ${r.result?.value ? 'EXISTS' : 'MISSING'}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
