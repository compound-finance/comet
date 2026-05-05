// Phase 3 — Measure cometProxy.supply via the V3 doTransferIn pre-deposited
// path (no orchestrator yet — this is the EVM-side verification that the V3
// patch closes the Q1 1.4M-CU gate).
//
// Strategy: bypass the orchestrator. We call directly:
//   1. unifiedToken.snapshotAta(cometAta) — push a snapshot.
//   2. cometProxy.supply(USDC, amount) — V3 doTransferIn pulls via
//      transferFromPreDeposited, popping the snapshot. The deployer's USDC
//      already lives at the comet PDA-ATA from Phase 2's deposits, so the
//      pre-existing balance covers `amount`.
//
// CU comparison: Phase 2 supply via V2 hit the 1.4M ceiling and rejected
// at preflight. Phase 3 supply via V3 should land on-chain — Solana tx
// CU should be visibly under 1.4M.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const ADDR = {
  COMET_PROXY: '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c',
  UNIFIED_TOKEN_V2: '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31',
};

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';

async function getRomeSolanaSigs(evmTxHash: string): Promise<string[]> {
  const r = await fetch(MARCUS_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'rome_solanaTxForEvmTx', params: [evmTxHash] }),
  });
  const j: any = await r.json();
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
  return {
    cu: meta?.computeUnitsConsumed ?? null,
    err: meta?.err ?? null,
    accts: tx?.message?.accountKeys?.length ?? 0,
    altLookups: meta?.loadedAddresses?.writable?.length ?? 0,
    altReadonly: meta?.loadedAddresses?.readonly?.length ?? 0,
    version: tx?.version ?? 'legacy',
  };
}

async function measureEvmTx(evmTxHash: string, label: string) {
  console.log(`  ${label}: ${evmTxHash}`);
  await new Promise(r => setTimeout(r, 4_000));
  const sigs = await getRomeSolanaSigs(evmTxHash);
  console.log(`  ${label}: ${sigs.length} solana sigs`);
  const sigMetas: any[] = [];
  for (const sig of sigs) {
    let m = null;
    for (let i = 0; i < 6; i++) {
      m = await getSolanaTxMeta(sig);
      if (m) break;
      await new Promise(r => setTimeout(r, 2_000));
    }
    if (!m) continue;
    console.log(`    sig=${sig.slice(0, 12)}… cu=${m.cu} accts=${m.accts}+ALT(rw=${m.altLookups},ro=${m.altReadonly}) ver=${m.version} err=${JSON.stringify(m.err)}`);
    sigMetas.push({ sig, ...m });
  }
  return { txHash: evmTxHash, sigMetas };
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Deployer: ${signer.address}`);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: signer.address,
    inputs: ADDR,
    measurements: {} as any,
  };

  const tokenAbi = [
    'function balanceOf(address) view returns (uint256)',
    'function snapshotAta(bytes32) external',
    'function solanaAtaOf(address) view returns (bytes32)',
    'function isPreDepositedCaller(address) view returns (bool)',
    'function grantPreDepositedCaller(address) external',
  ];
  const token = new ethers.Contract(ADDR.UNIFIED_TOKEN_V2, tokenAbi, signer);

  // Grant deployer pre-deposited caller role for this measurement script.
  // (Production flow uses the router; this script bypasses the router.)
  if (!(await token.isPreDepositedCaller(signer.address))) {
    console.log('[setup] Granting deployer pre-deposited caller role…');
    const t = await token.grantPreDepositedCaller(signer.address, { gasLimit: 5_000_000 });
    await t.wait();
  }

  const myBalance = await token.balanceOf(signer.address);
  console.log(`Deployer USDC balance (UnifiedToken view): ${ethers.utils.formatUnits(myBalance, 6)} USDC`);

  const cometAta = await token.solanaAtaOf(ADDR.COMET_PROXY);
  const myAta = await token.solanaAtaOf(signer.address);
  console.log(`Comet PDA-ATA: 0x${cometAta.slice(2)}`);
  console.log(`Deployer PDA-ATA: 0x${myAta.slice(2)}`);

  // Step A: snapshot the comet PDA-ATA.
  console.log('\n[A] snapshotAta(cometAta)…');
  const snapshotTx = await token.snapshotAta(cometAta, { gasLimit: 10_000_000 });
  await snapshotTx.wait();
  console.log(`  snapshot tx: ${snapshotTx.hash}`);
  out.measurements.snapshot = await measureEvmTx(snapshotTx.hash, 'snapshotAta');

  // Step B: SPL transfer 0.5 USDC from deployer ATA to comet ATA via UnifiedToken.transfer.
  // (This is the substitute for the orchestrator's SPL ix1 — calls SPL CPI to move
  //  USDC from auth-PDA(deployer)'s ATA → auth-PDA(comet)'s ATA, signed as auth-PDA(deployer).)
  const transferAbi = [
    'function transfer(address to, uint256 value) returns (bool)',
  ];
  const tokenTransfer = new ethers.Contract(ADDR.UNIFIED_TOKEN_V2, transferAbi, signer);
  console.log('\n[B] transfer(comet, 0.5 USDC)… (mimics orchestrator SPL ix1)');
  const transferTx = await tokenTransfer.transfer(ADDR.COMET_PROXY, 500_000n, { gasLimit: 10_000_000 });
  await transferTx.wait();
  console.log(`  transfer tx: ${transferTx.hash}`);
  out.measurements.transferToComet = await measureEvmTx(transferTx.hash, 'unified.transfer→comet');

  // Step C: cometProxy.supply(USDC, 0.5e6) — V3 path: doTransferIn calls
  // transferFromPreDeposited (no SPL CPI). Should land under 1.4M CU.
  const cometAbi = [
    'function supply(address asset, uint256 amount) external',
    'function balanceOf(address) view returns (uint256)',
  ];
  const cometViaProxy = new ethers.Contract(ADDR.COMET_PROXY, cometAbi, signer);
  console.log('\n[C] cometProxy.supply(USDC, 0.5e6) — V3 path…');
  try {
    const supplyTx = await cometViaProxy.supply(ADDR.UNIFIED_TOKEN_V2, 500_000n, { gasLimit: 30_000_000 });
    const rcpt = await supplyTx.wait();
    console.log(`  supply tx: ${supplyTx.hash} block=${rcpt.blockNumber} status=${rcpt.status}`);
    out.measurements.supplyV3 = await measureEvmTx(supplyTx.hash, 'cometProxy.supply');

    // Read post-state
    const myCometBal = await cometViaProxy.balanceOf(signer.address);
    console.log(`  deployer Comet balance: ${ethers.utils.formatUnits(myCometBal, 6)} USDC`);
    out.measurements.supplyV3.postCometBalance = myCometBal.toString();
  } catch (e) {
    console.log(`  supply failed: ${(e as Error).message?.slice(0, 250)}`);
    out.measurements.supplyV3 = { error: (e as Error).message?.slice(0, 250) };
  }

  fs.writeFileSync(
    path.join(__dirname, 'phase3-supply-measurement.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(`\nResults: ${path.join(__dirname, 'phase3-supply-measurement.json')}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
