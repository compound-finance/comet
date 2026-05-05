import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';
const MAX = ethers.constants.MaxUint256;

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

async function main() {
  const [signer] = await ethers.getSigners();
  const tokenAbi = ['function approve(address spender, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function allowance(address, address) view returns (uint256)'];
  const token = new ethers.Contract(UNIFIED_TOKEN_V2, tokenAbi, signer);
  const cometAbi = [
    'function supply(address asset, uint amount)',
    'function withdraw(address asset, uint amount)',
    'function balanceOf(address) view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function totalBorrow() view returns (uint256)',
  ];
  const comet = new ethers.Contract(COMET_PROXY, cometAbi, signer);
  const out: any = { timestamp: new Date().toISOString(), measurements: {}, balances: {} };

  out.balances.deployerUsdcBefore = (await token.balanceOf(signer.address)).toString();
  out.balances.cometUsdcBefore = (await token.balanceOf(COMET_PROXY)).toString();
  console.log('balances before:', out.balances);

  console.log('\nStep 1: re-approve(comet, MAX) — restore SPL delegate');
  const ax = await token.approve(COMET_PROXY, MAX, { gasLimit: 12_000_000 });
  await ax.wait();
  out.measurements.approveMaxToComet = await measure(ax.hash, 'approve(MAX, comet)');

  console.log('\nStep 2: supply(USDC, 1e5)');
  try {
    const sx = await comet.supply(UNIFIED_TOKEN_V2, 100_000n, { gasLimit: 30_000_000 });
    console.log(`  supply tx: ${sx.hash}`);
    await sx.wait();
    out.measurements.supplyViaProxy = await measure(sx.hash, 'cometProxy.supply(USDC, 1e5)');
  } catch (e: any) {
    out.supplyErr = JSON.stringify({ m: e.message, c: e.code, d: e.data, info: e.info?.error?.message }).slice(0, 800);
    console.log('  ERR:', out.supplyErr);
  }

  out.balances.deployerUsdcAfter = (await token.balanceOf(signer.address)).toString();
  out.balances.cometUsdcAfter = (await token.balanceOf(COMET_PROXY)).toString();
  out.balances.cometBalanceForDeployer = (await comet.balanceOf(signer.address)).toString();
  out.balances.totalSupplyAfter = (await comet.totalSupply()).toString();
  console.log('balances after:', out.balances);

  fs.writeFileSync(path.join(__dirname, 'phase2-reapprove-supply.json'), JSON.stringify(out, null, 2));
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
