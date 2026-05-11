// Profile the composed flow component-by-component:
//   1. Single-action Bulker SUPPLY_ASSET    — already 657K (warm)
//   2. Single-action Bulker WITHDRAW_ASSET  — measure
//   3. 2x SUPPLY_ASSET compose              — light pair, see if compose overhead is bulker-specific
//   4. SUPPLY_ASSET + TRANSFER_ASSET compose — light pair w/ heterogeneous actions
//   5. Direct comet.supplyFrom (no Bulker)  — gauge Bulker contract overhead
//   6. Direct comet.withdrawFrom (no Bulker) — same
//
// Compares against direct legs already measured: supply=584K warm, borrow=1006K warm.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_RPC    = 'https://api.devnet.solana.com';

const ADDR = {
  wusdc:        '0x39844f1d605a11acd87f766494291bbd11b406f4',
  pcol:         '0x28fBb35045Ae4e7DAE076e3c0BC6CaA371B8A75c',
  cometProxy:   '0xbF768582378a094823788a398D65B67099B2E45A',
  bulker:       '0x8867aD6C154Ff5D9880b971653D88036da38c2c4',
};

async function rpc(method: string, params: any[], rpcUrl = MARCUS_RPC): Promise<any> {
  const r = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((x: any) => x.json());
  if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
  return r.result;
}

async function getCu(evmHash: string): Promise<{ maxCu: number; totalCu: number; sigs: string[] }> {
  let sigs: string[] = [];
  try { sigs = await rpc('rome_solanaTxForEvmTx', [evmHash]); } catch (e) { return { maxCu: 0, totalCu: 0, sigs: [] }; }
  let maxCu = 0, totalCu = 0;
  for (const sig of sigs) {
    let meta: any = null;
    for (let i = 0; i < 8; i++) {
      const tx = await rpc('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }], SOL_RPC).catch(() => null);
      if (tx?.meta) { meta = tx.meta; break; }
      await new Promise(r => setTimeout(r, 1500));
    }
    const cu = meta?.computeUnitsConsumed ?? 0;
    if (cu) { maxCu = Math.max(maxCu, cu); totalCu += cu; }
  }
  return { maxCu, totalCu, sigs };
}

async function tryStep(label: string, fn: () => Promise<any>): Promise<{ ok: boolean; cu?: { maxCu: number; totalCu: number }; err?: string; tx?: string }> {
  console.log(`\n[${label}]`);
  try {
    const tx = await fn();
    const r = await tx.wait();
    const cu = await getCu(tx.hash);
    console.log(`  ✅ tx ${tx.hash}  block ${r.blockNumber}  maxCU ${cu.maxCu.toLocaleString()}  totalCU ${cu.totalCu.toLocaleString()}`);
    return { ok: true, cu, tx: tx.hash };
  } catch (e: any) {
    const msg = e?.error?.message || e?.message || JSON.stringify(e);
    console.log(`  ❌ rejected: ${msg.slice(0, 200)}`);
    return { ok: false, err: msg.slice(0, 400) };
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const comet = await ethers.getContractAt('contracts/Comet.sol:Comet', ADDR.cometProxy, deployer);
  const bulker = await ethers.getContractAt('contracts/bulkers/BaseBulker.sol:BaseBulker', ADDR.bulker, deployer);

  const ACTION_SUPPLY_ASSET   = ethers.utils.formatBytes32String('ACTION_SUPPLY_ASSET');
  const ACTION_WITHDRAW_ASSET = ethers.utils.formatBytes32String('ACTION_WITHDRAW_ASSET');
  const ACTION_TRANSFER_ASSET = ethers.utils.formatBytes32String('ACTION_TRANSFER_ASSET');

  const supplyData = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256'],
    [ADDR.cometProxy, deployer.address, ADDR.pcol, ethers.utils.parseUnits('10', 18)],
  );
  const withdrawData = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256'],
    [ADDR.cometProxy, deployer.address, ADDR.wusdc, 1_000n],
  );
  const transferData = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256'],
    [ADDR.cometProxy, deployer.address /* self-transfer = no-op state-wise but exercises the action */, ADDR.pcol, ethers.utils.parseUnits('1', 18)],
  );

  const out: any = { timestamp: new Date().toISOString(), addresses: ADDR, probes: {} };

  // Probe 1: Single-action Bulker SUPPLY_ASSET (small amount)
  out.probes.bulker_supply_only = await tryStep('Probe 1: bulker.invoke([SUPPLY_ASSET]) — 10 PCOL', () =>
    bulker.invoke([ACTION_SUPPLY_ASSET], [supplyData], { gasLimit: 200_000_000 }));

  // Probe 2: Single-action Bulker WITHDRAW_ASSET
  out.probes.bulker_withdraw_only = await tryStep('Probe 2: bulker.invoke([WITHDRAW_ASSET]) — 0.001 wUSDC', () =>
    bulker.invoke([ACTION_WITHDRAW_ASSET], [withdrawData], { gasLimit: 200_000_000 }));

  // Probe 3: 2x SUPPLY_ASSET compose (homogeneous, both light)
  out.probes.bulker_2x_supply = await tryStep('Probe 3: bulker.invoke([SUPPLY_ASSET, SUPPLY_ASSET])', () =>
    bulker.invoke([ACTION_SUPPLY_ASSET, ACTION_SUPPLY_ASSET], [supplyData, supplyData], { gasLimit: 200_000_000 }));

  // Probe 4: SUPPLY_ASSET + TRANSFER_ASSET compose (heterogeneous, transfer is no-SPL-CPI)
  out.probes.bulker_supply_transfer = await tryStep('Probe 4: bulker.invoke([SUPPLY_ASSET, TRANSFER_ASSET])', () =>
    bulker.invoke([ACTION_SUPPLY_ASSET, ACTION_TRANSFER_ASSET], [supplyData, transferData], { gasLimit: 200_000_000 }));

  // Probe 5: SUPPLY + WITHDRAW compose (the target)
  out.probes.bulker_supply_withdraw = await tryStep('Probe 5: bulker.invoke([SUPPLY_ASSET, WITHDRAW_ASSET]) — TARGET', () =>
    bulker.invoke([ACTION_SUPPLY_ASSET, ACTION_WITHDRAW_ASSET], [supplyData, withdrawData], { gasLimit: 200_000_000 }));

  // Probe 6: Direct comet.supplyFrom (Bulker-equivalent without Bulker contract)
  out.probes.direct_supplyFrom = await tryStep('Probe 6: comet.supplyFrom(deployer, deployer, pcol, 10)', () =>
    comet.supplyFrom(deployer.address, deployer.address, ADDR.pcol, ethers.utils.parseUnits('10', 18), { gasLimit: 50_000_000 }));

  // Probe 7: Direct comet.withdrawFrom
  out.probes.direct_withdrawFrom = await tryStep('Probe 7: comet.withdrawFrom(deployer, deployer, wusdc, 1000)', () =>
    comet.withdrawFrom(deployer.address, deployer.address, ADDR.wusdc, 1_000n, { gasLimit: 50_000_000 }));

  // Summary
  console.log(`\n══════ SUMMARY ══════`);
  for (const [k, v] of Object.entries(out.probes) as [string, any][]) {
    if (v.ok) console.log(`  ${k.padEnd(40)} ${(v.cu?.maxCu || 0).toLocaleString().padStart(10)} CU`);
    else      console.log(`  ${k.padEnd(40)} REJECTED  (${(v.err || '').slice(0, 80)})`);
  }

  const outPath = path.join(__dirname, 'profile-compose.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
