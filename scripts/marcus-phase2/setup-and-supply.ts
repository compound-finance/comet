// Phase 2.3 — Reset SPL delegate to comet, then run supply.
// Captures CU/account-count/version via getTransaction.
import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';
const MAX = ethers.constants.MaxUint256;

async function getRomeSolanaSigs(evmTxHash: string): Promise<string[]> {
  const r = await fetch(MARCUS_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'rome_solanaTxForEvmTx', params: [evmTxHash] }),
  });
  const j: any = await r.json();
  return j.result || [];
}

async function getSolanaTxMeta(sig: string) {
  const r = await fetch(SOLANA_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTransaction',
      params: [sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'json' }],
    }),
  });
  const j: any = await r.json();
  if (!j.result) return null;
  const meta = j.result.meta;
  const tx = j.result.transaction;
  const keys = tx?.message?.accountKeys?.map((k: any) => (typeof k === 'string' ? k : k.pubkey)) ?? [];
  const altLookups = tx?.message?.addressTableLookups?.length ?? 0;
  const loadedReadonly = meta?.loadedAddresses?.readonly?.length ?? 0;
  const loadedWritable = meta?.loadedAddresses?.writable?.length ?? 0;
  return {
    cu: meta?.computeUnitsConsumed ?? null,
    err: meta?.err ?? null,
    accountCount: keys.length + loadedReadonly + loadedWritable,
    altLookups,
    txVersion: tx?.version ?? 'legacy',
  };
}

async function measure(evmTxHash: string, label: string) {
  const provider = ethers.provider;
  const rcpt = await provider.getTransactionReceipt(evmTxHash);
  console.log(`  ${label}: tx=${evmTxHash} block=${rcpt.blockNumber} status=${rcpt.status}`);
  await new Promise(r => setTimeout(r, 4_000));
  const sigs = await getRomeSolanaSigs(evmTxHash);
  const cus: number[] = [];
  let accts = 0; let alts = 0; let ver: any = 'legacy';
  for (const sig of sigs) {
    let meta = null;
    for (let i = 0; i < 6; i++) {
      meta = await getSolanaTxMeta(sig);
      if (meta) break;
      await new Promise(r => setTimeout(r, 2_000));
    }
    if (!meta) continue;
    cus.push(meta.cu ?? 0);
    accts = Math.max(accts, meta.accountCount);
    alts = Math.max(alts, meta.altLookups);
    ver = meta.txVersion;
    console.log(`    sig=${sig.slice(0, 12)}… cu=${meta.cu} accts=${meta.accountCount} alts=${meta.altLookups} ver=${meta.txVersion}`);
  }
  return { txHash: evmTxHash, evmGas: rcpt.gasUsed.toString(), block: rcpt.blockNumber, reverted: rcpt.status === 0, sigs, cus, accountCount: accts, altLookups: alts, txVersion: ver };
}

async function main() {
  const [signer] = await ethers.getSigners();
  const tokenAbi = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address, address) view returns (uint256)',
  ];
  const token = new ethers.Contract(UNIFIED_TOKEN_V2, tokenAbi, signer);
  const cometAbi = [
    'function supply(address asset, uint amount)',
    'function withdraw(address asset, uint amount)',
    'function balanceOf(address) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function totalBorrow() view returns (uint256)',
    'function baseToken() view returns (address)',
  ];
  const comet = new ethers.Contract(COMET_PROXY, cometAbi, signer);

  const out: any = { timestamp: new Date().toISOString(), measurements: {} };

  console.log(`Deployer USDC ATA balance: ${(await token.balanceOf(signer.address)).toString()}`);
  console.log(`Allowance(deployer, comet): ${(await token.allowance(signer.address, COMET_PROXY)).toString()}`);

  // (Re)approve comet as delegate for max
  console.log('\nStep 1: approve(comet, MAX) — SPL delegate to comet PDA');
  const approveTx = await token.approve(COMET_PROXY, MAX, { gasLimit: 8_000_000 });
  await approveTx.wait();
  out.measurements.approveMaxToComet = await measure(approveTx.hash, 'approve(MAX,comet)');

  // Run supply
  console.log('\nStep 2: cometProxy.supply(USDC, 1e6)');
  try {
    const supplyTx = await comet.supply(UNIFIED_TOKEN_V2, 1_000_000n, { gasLimit: 12_000_000 });
    console.log(`  supply tx: ${supplyTx.hash}`);
    await supplyTx.wait();
    out.measurements.supplyViaProxy = await measure(supplyTx.hash, 'cometProxy.supply(USDC,1e6)');
  } catch (e: any) {
    const errMsg = JSON.stringify({ message: e.message, reason: e.reason, code: e.code, data: e.data }).slice(0, 800);
    console.log(`  supply failed: ${errMsg}`);
    out.measurements.supplyError = errMsg;
  }
  out.totalSupplyAfter = (await comet.totalSupply()).toString();
  out.cometBalance = (await comet.balanceOf(signer.address)).toString();

  // Withdraw 0.5 USDC
  console.log('\nStep 3: cometProxy.withdraw(USDC, 5e5)');
  try {
    const w = await comet.withdraw(UNIFIED_TOKEN_V2, 500_000n, { gasLimit: 12_000_000 });
    console.log(`  withdraw tx: ${w.hash}`);
    await w.wait();
    out.measurements.withdrawViaProxy = await measure(w.hash, 'cometProxy.withdraw(USDC,5e5)');
  } catch (e: any) {
    out.measurements.withdrawError = JSON.stringify({ m: e.message, r: e.reason }).slice(0, 600);
    console.log(`  withdraw failed: ${out.measurements.withdrawError}`);
  }

  const outPath = path.join(__dirname, 'phase2-supply-final.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
}
main().catch(err => { console.error(err); process.exit(1); });
