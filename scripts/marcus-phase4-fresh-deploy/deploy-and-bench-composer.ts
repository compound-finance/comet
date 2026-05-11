// Deploy CompoundComposer + bench supply+borrow compose on Marcus.
// Goal: confirm whether bypassing Bulker dispatch overhead closes the
// gap to 1.4M atomic ceiling on wUSDC base + PCOL collateral.
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/deploy-and-bench-composer.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_RPC    = 'https://api.devnet.solana.com';

const ADDR = {
  wusdc:        '0x39844f1d605a11acd87f766494291bbd11b406f4',
  pcol:         '0x28fBb35045Ae4e7DAE076e3c0BC6CaA371B8A75c',
  cometProxy:   '0xbF768582378a094823788a398D65B67099B2E45A', // Comet-wUSDC-collat
};

async function rpc(method: string, params: any[], rpcUrl = MARCUS_RPC): Promise<any> {
  const r = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((x: any) => x.json());
  if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
  return r.result;
}

async function getCu(evmHash: string) {
  let sigs: string[] = [];
  try { sigs = await rpc('rome_solanaTxForEvmTx', [evmHash]); } catch (e) { return { sigs: [], maxCu: 0, totalCu: 0, perSig: [] }; }
  const perSig: any[] = [];
  let maxCu = 0, totalCu = 0;
  for (const sig of sigs) {
    let meta: any = null;
    for (let i = 0; i < 8; i++) {
      const tx = await rpc('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }], SOL_RPC).catch(() => null);
      if (tx?.meta) { meta = tx.meta; break; }
      await new Promise(r => setTimeout(r, 1500));
    }
    const cu = meta?.computeUnitsConsumed ?? 0;
    perSig.push({ sig, cu });
    if (cu) { maxCu = Math.max(maxCu, cu); totalCu += cu; }
  }
  return { sigs, perSig, maxCu, totalCu };
}

async function captureStep(label: string, run: () => Promise<any>) {
  console.log(`\n[${label}]`);
  try {
    const tx = await run();
    const r = await tx.wait();
    const cu = await getCu(tx.hash);
    console.log(`  ✅ tx ${tx.hash}  block ${r.blockNumber}  maxCU ${cu.maxCu.toLocaleString()}  totalCU ${cu.totalCu.toLocaleString()}`);
    return { ok: true, txHash: tx.hash, gasUsed: r.gasUsed.toString(), ...cu };
  } catch (e: any) {
    const msg = e?.error?.message || e?.message || JSON.stringify(e);
    console.log(`  ❌ rejected: ${msg.slice(0, 250)}`);
    return { ok: false, error: msg.slice(0, 600), txHash: null };
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);

  // 1. Deploy CompoundComposer
  console.log('\n══════ Deploy CompoundComposer ══════');
  const Composer = await ethers.getContractFactory('contracts/composer/CompoundComposer.sol:CompoundComposer');
  const composer = await Composer.deploy({ gasLimit: 30_000_000 });
  await composer.deployed();
  console.log(`  CompoundComposer: ${composer.address}`);

  const out: any = {
    timestamp: new Date().toISOString(),
    addresses: { ...ADDR, composer: composer.address },
    setup: {} as any,
    bench: {} as any,
  };

  // 2. Setup: comet.allow(composer, true)
  console.log('\n══════ Setup ══════');
  const cometExt = await ethers.getContractAt('contracts/CometExt.sol:CometExt', ADDR.cometProxy, deployer);
  const comet    = await ethers.getContractAt('contracts/Comet.sol:Comet',     ADDR.cometProxy, deployer);
  const isAllowed = await comet.hasPermission(deployer.address, composer.address);
  if (!isAllowed) {
    out.setup.allowComposer = await captureStep('comet.allow(composer, true)', () =>
      cometExt.allow(composer.address, true, { gasLimit: 30_000_000 }));
  } else { console.log('[allow] already granted — skip'); }

  // 3. Bench: composer.supplyCollateralAndBorrow
  console.log('\n══════ BENCH: supply+borrow via Composer (single EVM tx) ══════');
  const COLL_AMT   = ethers.utils.parseUnits('100', 18); // 100 PCOL
  const BORROW_AMT = 10_000n;                            // 0.01 wUSDC

  out.bench.supplyAndBorrow = await captureStep(
    'composer.supplyCollateralAndBorrow(comet, pcol, 100, wusdc, 10000)',
    () => composer.supplyCollateralAndBorrow(
      ADDR.cometProxy, ADDR.pcol, COLL_AMT, ADDR.wusdc, BORROW_AMT,
      { gasLimit: 200_000_000 },
    ),
  );

  // 4. Bench: a smaller iteration (warm path) to see steady-state CU
  out.bench.supplyAndBorrowSmall = await captureStep(
    'composer.supplyCollateralAndBorrow(comet, pcol, 1, wusdc, 1000)',
    () => composer.supplyCollateralAndBorrow(
      ADDR.cometProxy, ADDR.pcol, ethers.utils.parseUnits('1', 18), ADDR.wusdc, 1_000n,
      { gasLimit: 200_000_000 },
    ),
  );

  // ───── Summary ─────
  console.log(`\n══════ SUMMARY ══════`);
  const a = out.bench.supplyAndBorrow;
  const b = out.bench.supplyAndBorrowSmall;
  if (a.ok) {
    console.log(`  Composer compose (100/0.01):  ${a.maxCu.toLocaleString()} CU  ${a.maxCu < 1_400_000 ? '✅ FITS 1.4M' : '❌ over by ' + (a.maxCu - 1_400_000).toLocaleString()}`);
  } else {
    console.log(`  Composer compose (100/0.01):  REJECTED — ${a.error?.slice(0, 100)}`);
  }
  if (b.ok) {
    console.log(`  Composer compose (1/0.001):   ${b.maxCu.toLocaleString()} CU  ${b.maxCu < 1_400_000 ? '✅ FITS 1.4M' : '❌ over by ' + (b.maxCu - 1_400_000).toLocaleString()}`);
  } else {
    console.log(`  Composer compose (1/0.001):   REJECTED — ${b.error?.slice(0, 100)}`);
  }
  console.log(`\n  Reference:`);
  console.log(`    Direct supplyFrom (warm):     576,144 CU`);
  console.log(`    Direct withdrawFrom (warm):   982,601 CU`);
  console.log(`    Bulker [SUPPLY,WITHDRAW]:     REJECTED (>1.4M)`);

  out.summary = {
    composerComposeCU: a.maxCu || null,
    composerComposeFitsAtomic: a.ok && (a.maxCu < 1_400_000),
    composerSmallCU: b.maxCu || null,
    composerSmallFitsAtomic: b.ok && (b.maxCu < 1_400_000),
  };

  const outPath = path.join(__dirname, 'bench-composer.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
