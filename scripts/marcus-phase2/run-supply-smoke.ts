// Phase 2 — Supply smoke test against UnifiedToken v2 + upgraded Comet impl.
//
// Prereqs (already done):
//   - UnifiedToken v2 deployed (0xfbd4De54...)
//   - Comet impl upgraded; baseToken = UnifiedToken v2
//   - Deployer's AUTHORITY_PDA's USDC ATA exists + has 5 USDC
//   - approve(MAX, comet) already issued (delegate live)
//   - CometProxy's AUTHORITY_PDA's USDC ATA exists (just bootstrapped)
//
// Just run supply(USDC, 1e6) and capture CU.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';

async function getRomeSolanaSigs(evmTxHash: string): Promise<string[]> {
  const r = await fetch(MARCUS_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'rome_solanaTxForEvmTx', params: [evmTxHash],
    }),
  });
  const j: any = await r.json();
  if (j.error) return [];
  return j.result || [];
}

async function getSolanaTxMeta(sig: string) {
  const r = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTransaction',
      params: [sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'json' }],
    }),
  });
  const j: any = await r.json();
  if (!j.result) return null;
  const meta = j.result.meta;
  const tx = j.result.transaction;
  const staticAccountKeys =
    tx?.message?.accountKeys?.map((k: any) => (typeof k === 'string' ? k : k.pubkey)) ?? [];
  return {
    computeUnitsConsumed: meta?.computeUnitsConsumed ?? null,
    err: meta?.err ?? null,
    accountCount: staticAccountKeys.length,
    txVersion: tx?.version ?? 'legacy',
  };
}

async function measureEvmTx(evmTxHash: string, label: string) {
  const provider = ethers.provider;
  const rcpt = await provider.getTransactionReceipt(evmTxHash);
  console.log(`  ${label}: evmTx=${evmTxHash} block=${rcpt.blockNumber} status=${rcpt.status}`);
  await new Promise(r => setTimeout(r, 4_000));
  const sigs = await getRomeSolanaSigs(evmTxHash);
  console.log(`  ${label}: solana sigs (${sigs.length})`);
  const cus: number[] = [];
  let accountCount = 0;
  let txVersion: 'legacy' | number = 'legacy';
  for (const sig of sigs) {
    let meta = null;
    for (let i = 0; i < 6; i++) {
      meta = await getSolanaTxMeta(sig);
      if (meta) break;
      await new Promise(r => setTimeout(r, 2_000));
    }
    if (!meta) continue;
    cus.push(meta.computeUnitsConsumed ?? 0);
    accountCount = Math.max(accountCount, meta.accountCount);
    txVersion = meta.txVersion;
    console.log(`  ${label}: sig=${sig.slice(0, 12)}… cu=${meta.computeUnitsConsumed} accts=${meta.accountCount} ver=${meta.txVersion}`);
  }
  return {
    txHash: evmTxHash,
    evmGas: rcpt.gasUsed.toString(),
    blockNumber: rcpt.blockNumber,
    reverted: rcpt.status === 0,
    solanaTxs: sigs,
    computeUnits: cus,
    accountCount,
    txVersion,
  };
}

async function main() {
  const [signer] = await ethers.getSigners();
  const cometViaProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', COMET_PROXY);

  const tokenAbi = ['function balanceOf(address) view returns (uint256)'];
  const token = new ethers.Contract(UNIFIED_TOKEN_V2, tokenAbi, signer);
  const myBalance = await token.balanceOf(signer.address);
  console.log(`Deployer USDC ATA balance: ${myBalance.toString()}`);

  const out: any = { timestamp: new Date().toISOString(), measurements: {} as any };

  // supply(USDC, 1e6) = 1 USDC
  const supplyAmount = 1_000_000n;
  console.log(`\nSubmitting supply(USDC, ${supplyAmount})...`);
  try {
    const supplyTx = await cometViaProxy.supply(UNIFIED_TOKEN_V2, supplyAmount, { gasLimit: 8_000_000 });
    console.log(`  supply tx hash: ${supplyTx.hash}`);
    await supplyTx.wait();
    out.measurements.supplyViaProxy = await measureEvmTx(supplyTx.hash, 'cometProxy.supply(USDC,1e6)');
  } catch (e) {
    const ee = e as any;
    const errMsg = JSON.stringify({
      message: ee.message,
      reason: ee.reason,
      code: ee.code,
      data: ee.data,
      method: ee.method,
      transaction: ee.transaction,
    }).slice(0, 800);
    console.log(`  supply failed: ${errMsg}`);
    out.measurements.supplyError = errMsg;
  }

  // After supply, check totalSupply
  try {
    const totalSupply = await cometViaProxy.totalSupply();
    console.log(`\nTotal supply after: ${totalSupply.toString()}`);
    out.totalSupplyAfter = totalSupply.toString();
  } catch (e) {
    console.log(`totalSupply read failed: ${(e as Error).message?.slice(0, 200)}`);
  }

  // Check our balance via Comet.balanceOf (Comet's view of supplier balance, not the unified token)
  try {
    const myCometBalance = await cometViaProxy.balanceOf(signer.address);
    console.log(`Comet balance for deployer: ${myCometBalance.toString()}`);
    out.cometBalance = myCometBalance.toString();
  } catch (e) {
    console.log(`Comet.balanceOf failed: ${(e as Error).message?.slice(0, 200)}`);
  }

  const outPath = path.join(__dirname, 'phase2-supply-smoke.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
