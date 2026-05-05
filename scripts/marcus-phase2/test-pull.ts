// Phase 2 — Deploy SimplePullProxy + bootstrap its ATA + test transferFrom flow
// (simulates what Comet does without all the Comet logic)
import { ethers } from 'hardhat';
import { Connection, PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';
import * as fs from 'fs';

const PROGRAM_ID = 'RomeDbGQYbqomGVk13h9JkQHKoNWKB84Lw1ij9AtRXT';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
const SOL_PUBLIC = 'https://api.devnet.solana.com';
const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';

function loadKp(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function getRomeSolanaSigs(evmTxHash: string): Promise<string[]> {
  const r = await fetch(MARCUS_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'rome_solanaTxForEvmTx', params: [evmTxHash] }) });
  const j: any = await r.json();
  return j.result || [];
}
async function getSolMeta(sig: string) {
  const r = await fetch(SOL_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'json' }] }) });
  const j: any = await r.json();
  if (!j.result) return null;
  const meta = j.result.meta;
  const tx = j.result.transaction;
  const keys = tx?.message?.accountKeys?.map((k: any) => (typeof k === 'string' ? k : k.pubkey)) ?? [];
  const altR = tx?.message?.addressTableLookups?.length ?? 0;
  const lr = meta?.loadedAddresses?.readonly?.length ?? 0;
  const lw = meta?.loadedAddresses?.writable?.length ?? 0;
  return { cu: meta?.computeUnitsConsumed, err: meta?.err, accountCount: keys.length + lr + lw, altLookups: altR, ver: tx?.version ?? 'legacy' };
}
async function measure(evmTx: string, label: string) {
  const provider = ethers.provider;
  const r = await provider.getTransactionReceipt(evmTx);
  console.log(`  ${label}: tx=${evmTx} block=${r.blockNumber} status=${r.status}`);
  await new Promise(r => setTimeout(r, 4_000));
  const sigs = await getRomeSolanaSigs(evmTx);
  const cus: number[] = [];
  let accts = 0; let alts = 0; let ver: any = 'legacy';
  for (const sig of sigs) {
    let m = null;
    for (let i = 0; i < 6; i++) { m = await getSolMeta(sig); if (m) break; await new Promise(r => setTimeout(r, 2_000)); }
    if (!m) continue;
    cus.push(m.cu ?? 0); accts = Math.max(accts, m.accountCount); alts = Math.max(alts, m.altLookups); ver = m.ver;
    console.log(`    sig=${sig.slice(0, 12)}… cu=${m.cu} accts=${m.accountCount} alts=${m.altLookups} ver=${m.ver}`);
  }
  return { txHash: evmTx, evmGas: r.gasUsed.toString(), block: r.blockNumber, reverted: r.status === 0, sigs, cus, accountCount: accts, altLookups: alts, txVersion: ver };
}

async function bootstrapAta(evmAddr: string, payer: Keypair) {
  const sysAddr = '0xfF00000000000000000000000000000000000007';
  const SystemProgramAbi = ['function find_program_address(bytes32 program, tuple(bytes item)[] seeds) external pure returns (bytes32, uint8)'];
  const [signer] = await ethers.getSigners();
  const sys = new ethers.Contract(sysAddr, SystemProgramAbi, signer);
  const programIdBytes = bs58.decode(PROGRAM_ID);
  const programIdBytes32 = '0x' + Buffer.from(programIdBytes).toString('hex');
  const seeds = [
    { item: ethers.utils.toUtf8Bytes('EXTERNAL_AUTHORITY') },
    { item: evmAddr.toLowerCase() },
  ];
  const [pdaB32] = await sys.find_program_address(programIdBytes32, seeds);
  const pda = new PublicKey(Buffer.from(pdaB32.slice(2), 'hex'));
  const usdcMintPk = new PublicKey(USDC_MINT);
  const ata = getAssociatedTokenAddressSync(usdcMintPk, pda, true);
  console.log(`  ${evmAddr}: PDA=${pda.toBase58()}, ATA=${ata.toBase58()}`);

  const conn = new Connection(SOL_PUBLIC, 'confirmed');
  const existing = await conn.getAccountInfo(ata);
  if (existing) {
    console.log('  ATA already exists');
    return ata;
  }
  console.log('  Creating ATA...');
  const ix = createAssociatedTokenAccountInstruction(payer.publicKey, ata, pda, usdcMintPk, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const tx = new Transaction().add(ix);
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  tx.sign(payer);
  const sig = await conn.sendRawTransaction(tx.serialize());
  console.log(`  Sent: ${sig}`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const { value } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: false });
    const st = value[0];
    if (st?.err) throw new Error(JSON.stringify(st.err));
    if (st?.confirmationStatus === 'confirmed' || st?.confirmationStatus === 'finalized') break;
    await new Promise(r => setTimeout(r, 2000));
  }
  return ata;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const out: any = { measurements: {} };

  // Step 1: deploy SimplePullProxy
  console.log('Step 1: deploying SimplePullProxy...');
  const Pull = await ethers.getContractFactory('SimplePullProxy');
  const pull = await Pull.deploy({ gasLimit: 8_000_000 });
  await pull.deployed();
  console.log('  Pull:', pull.address);
  out.pullAddr = pull.address;

  // Step 2: bootstrap pull's ATA
  console.log('\nStep 2: bootstrap pull ATA...');
  const payerPath = process.env.SOLANA_PAYER_KEYPAIR_PATH;
  if (!payerPath) throw new Error('SOLANA_PAYER_KEYPAIR_PATH required');
  const payer = loadKp(payerPath);
  await bootstrapAta(pull.address, payer);

  // Step 3: deployer.approve(pull, 50000) — SPL delegate to pull's PDA
  console.log('\nStep 3: deployer.approve(pull, 50000)...');
  const tokenAbi = ['function approve(address spender, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
  const token = new ethers.Contract(UNIFIED_TOKEN_V2, tokenAbi, signer);
  const approveTx = await token.approve(pull.address, 50_000n, { gasLimit: 8_000_000 });
  await approveTx.wait();
  out.measurements.approveToPull = await measure(approveTx.hash, 'approve(50K, pull)');

  // Step 4: pull.pull(token, deployer, 10000) — pull contract calls transferFrom
  console.log('\nStep 4: pull.pull(token, deployer, 10000)...');
  try {
    const pullAbi = ['function pull(address token, address from, uint256 amount)'];
    const p = new ethers.Contract(pull.address, pullAbi, signer);
    const ptx = await p.pull(UNIFIED_TOKEN_V2, signer.address, 10_000n, { gasLimit: 12_000_000 });
    await ptx.wait();
    out.measurements.pullTransferFrom = await measure(ptx.hash, 'pull.pull (transferFrom via contract)');
  } catch (e: any) {
    out.pullErr = JSON.stringify({ m: e.message, c: e.code, d: e.data, info: e.info?.error?.message }).slice(0, 800);
    console.log('  pull failed:', out.pullErr);
  }

  console.log('\nFinal:', JSON.stringify(out, null, 2).slice(0, 2000));
  fs.writeFileSync('scripts/marcus-phase2/phase2-pull-results.json', JSON.stringify(out, null, 2));
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
