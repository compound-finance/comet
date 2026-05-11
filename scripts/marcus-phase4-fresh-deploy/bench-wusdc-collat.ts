// Bench Comet-wUSDC-collat — full Compound flow on wUSDC base + PCOL collateral.
//
// Setup (one-time, idempotent):
//   S0a. PCOL.approve(comet-collat, MAX)
//   S0b. wUSDC.approve(comet-collat, MAX)             [for direct repay later]
//   S0c. wUSDC.approve(bulker, MAX)                   [for Bulker compose]
//   S0d. PCOL.approve(bulker, MAX)                    [for Bulker compose]
//   S0e. comet.allow(bulker, true)                    [grant Bulker as Compound manager]
//   S0f. wUSDC.transfer(comet-collat, seed)           [seed reserves so Comet can lend]
//
// Direct bench (each its own EVM tx):
//   D1. comet.supply(PCOL, COLLATERAL_AMT)            [supplyCollateral]
//   D2. comet.withdraw(wUSDC, BORROW_AMT)             [collateralized borrow]
//
// Bulker compose bench:
//   B1. bulker.invoke([SUPPLY_ASSET pcol, WITHDRAW_ASSET wusdc])  [single EVM tx — composed]
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/bench-wusdc-collat.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_RPC    = 'https://api.devnet.solana.com';

const ADDR = {
  wusdc:        '0x39844f1d605a11acd87f766494291bbd11b406f4',
  pcol:         '0x28fBb35045Ae4e7DAE076e3c0BC6CaA371B8A75c',
  cometProxy:   '0xbF768582378a094823788a398D65B67099B2E45A', // Comet-wUSDC-collat
  bulker:       '0x8867aD6C154Ff5D9880b971653D88036da38c2c4',
};

const COLLATERAL_AMT = ethers.utils.parseUnits('100', 18); // 100 PCOL
const SEED_AMT       = 100_000n; // 0.1 wUSDC seed
const BORROW_AMT     = 10_000n;  // 0.01 wUSDC borrow (well under collateral × 0.7 BCF)

async function rpc(method: string, params: any[], rpcUrl = MARCUS_RPC): Promise<any> {
  const r = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((x: any) => x.json());
  if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
  return r.result;
}

async function getSolanaCu(evmTxHash: string) {
  let sigs: string[] = [];
  try { sigs = await rpc('rome_solanaTxForEvmTx', [evmTxHash]); } catch (e) { return { sigs: [], perSig: [], maxCu: 0, totalCu: 0 }; }
  const perSig = [] as { sig: string; cu: number | null; err: any }[];
  let maxCu = 0;
  let totalCu = 0;
  for (const sig of sigs) {
    let meta: any = null;
    for (let i = 0; i < 8; i++) {
      const tx = await rpc('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }], SOL_RPC).catch(() => null);
      if (tx?.meta) { meta = tx.meta; break; }
      await new Promise(r => setTimeout(r, 1500));
    }
    const cu = meta?.computeUnitsConsumed ?? null;
    perSig.push({ sig, cu, err: meta?.err });
    if (cu) { maxCu = Math.max(maxCu, cu); totalCu += cu; }
  }
  return { sigs, perSig, maxCu, totalCu };
}

async function captureStep(label: string, run: () => Promise<any>) {
  console.log(`[${label}]`);
  const tx = await run();
  const r = await tx.wait();
  console.log(`  evm tx: ${tx.hash}  block: ${r.blockNumber}  gasUsed: ${r.gasUsed}`);
  const cu = await getSolanaCu(tx.hash);
  console.log(`  solana sigs: ${cu.sigs.length}  maxCU: ${cu.maxCu.toLocaleString()}  totalCU: ${cu.totalCu.toLocaleString()}`);
  return { txHash: tx.hash, gasUsed: r.gasUsed.toString(), ...cu };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer (test user): ${deployer.address}\n`);

  const wusdc = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', ADDR.wusdc, deployer);
  const pcol  = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', ADDR.pcol,  deployer);
  const comet = await ethers.getContractAt('contracts/Comet.sol:Comet', ADDR.cometProxy, deployer);
  const cometExt = await ethers.getContractAt('contracts/CometExt.sol:CometExt', ADDR.cometProxy, deployer);
  const bulker = await ethers.getContractAt('contracts/bulkers/BaseBulker.sol:BaseBulker', ADDR.bulker, deployer);

  // Sanity
  const wBal = await wusdc.balanceOf(deployer.address);
  const pBal = await pcol.balanceOf(deployer.address);
  console.log(`Deployer wUSDC: ${ethers.utils.formatUnits(wBal, 6)}`);
  console.log(`Deployer PCOL:  ${ethers.utils.formatUnits(pBal, 18)}`);
  if (wBal.lt(SEED_AMT)) throw new Error(`Insufficient wUSDC for seed`);
  if (pBal.lt(COLLATERAL_AMT.mul(2))) throw new Error(`Insufficient PCOL — need 200 PCOL min`);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    addresses: ADDR,
    setup: {} as any,
    direct: {} as any,
    bulker: {} as any,
  };

  // ────────────── SETUP ──────────────
  console.log('═══════ SETUP ═══════');

  // S0a: PCOL approve on comet
  if ((await pcol.allowance(deployer.address, ADDR.cometProxy)).lt(COLLATERAL_AMT.mul(10))) {
    out.setup.pcolApproveComet = await captureStep('S0a. pcol.approve(comet, MAX)', () =>
      pcol.approve(ADDR.cometProxy, ethers.constants.MaxUint256, { gasLimit: 5_000_000 }));
  } else { console.log('[S0a] PCOL allowance on comet — skip'); }

  // S0b: wUSDC approve on comet — always run; allowance() reverts if spender
  // hasn't been registered in SPL_ERC20.ERC20Users mapping yet (idempotent
  // anyway, approve auto-registers both sides via ensure_user).
  out.setup.wusdcApproveComet = await captureStep('S0b. wusdc.approve(comet, MAX)', () =>
    wusdc.approve(ADDR.cometProxy, ethers.constants.MaxUint256, { gasLimit: 80_000_000 }));

  // S0c: wUSDC approve on bulker — same reason
  out.setup.wusdcApproveBulker = await captureStep('S0c. wusdc.approve(bulker, MAX)', () =>
    wusdc.approve(ADDR.bulker, ethers.constants.MaxUint256, { gasLimit: 80_000_000 }));

  // S0d: PCOL approve on bulker
  if ((await pcol.allowance(deployer.address, ADDR.bulker)).lt(COLLATERAL_AMT.mul(10))) {
    out.setup.pcolApproveBulker = await captureStep('S0d. pcol.approve(bulker, MAX)', () =>
      pcol.approve(ADDR.bulker, ethers.constants.MaxUint256, { gasLimit: 5_000_000 }));
  } else { console.log('[S0d] PCOL allowance on bulker — skip'); }

  // S0e: comet.allow(bulker, true) — call via CometExt ABI on the proxy
  const isAllowed = await comet.hasPermission(deployer.address, ADDR.bulker);
  if (!isAllowed) {
    out.setup.allowBulker = await captureStep('S0e. comet.allow(bulker, true)', () =>
      cometExt.allow(ADDR.bulker, true, { gasLimit: 30_000_000 }));
  } else { console.log('[S0e] Bulker already allowed as manager — skip'); }

  // S0f: wUSDC transfer to comet (seed reserves)
  const cometWusdcBal = await wusdc.balanceOf(ADDR.cometProxy);
  if (cometWusdcBal.lt(SEED_AMT)) {
    out.setup.seedComet = await captureStep('S0f. wusdc.transfer(comet, seed)', () =>
      wusdc.transfer(ADDR.cometProxy, SEED_AMT, { gasLimit: 30_000_000 }));
  } else { console.log(`[S0f] Comet has ${cometWusdcBal} wUSDC — skip seed`); }

  // ────────────── DIRECT LEGS ──────────────
  console.log('\n═══════ DIRECT LEGS ═══════');

  // D1: PCOL supplyCollateral
  out.direct.supplyCollateral = await captureStep('D1. comet.supply(PCOL, 100e18)', () =>
    comet.supply(ADDR.pcol, COLLATERAL_AMT, { gasLimit: 50_000_000 }));

  // D2: wUSDC borrow via withdraw
  out.direct.borrow = await captureStep(`D2. comet.withdraw(wUSDC, ${BORROW_AMT})`, () =>
    comet.withdraw(ADDR.wusdc, BORROW_AMT, { gasLimit: 50_000_000 }));

  // ────────────── BULKER COMPOSE ──────────────
  console.log('\n═══════ BULKER COMPOSE ═══════');

  // Reset state: repay borrow + withdraw collateral so we can re-supply via Bulker
  // But that adds complexity. Instead, supply MORE collateral via Bulker + borrow MORE.
  const ACTION_SUPPLY_ASSET   = ethers.utils.formatBytes32String('ACTION_SUPPLY_ASSET');
  const ACTION_WITHDRAW_ASSET = ethers.utils.formatBytes32String('ACTION_WITHDRAW_ASSET');

  // Bulker actions:
  //   1. SUPPLY_ASSET (comet, to=user, asset=pcol, amount=100 PCOL)
  //   2. WITHDRAW_ASSET (comet, to=user, asset=wusdc, amount=BORROW)
  const supplyData = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256'],
    [ADDR.cometProxy, deployer.address, ADDR.pcol, COLLATERAL_AMT],
  );
  const withdrawData = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256'],
    [ADDR.cometProxy, deployer.address, ADDR.wusdc, BORROW_AMT],
  );

  // Try Bulker compose; on revert/preflight-reject, capture the error rather than failing.
  try {
    out.bulker.compose = await captureStep('B1. bulker.invoke([SUPPLY_ASSET, WITHDRAW_ASSET])', () =>
      bulker.invoke(
        [ACTION_SUPPLY_ASSET, ACTION_WITHDRAW_ASSET],
        [supplyData, withdrawData],
        { gasLimit: 200_000_000 },
      ));
  } catch (e: any) {
    const msg = (e?.message || JSON.stringify(e)).slice(0, 600);
    console.log(`  ❌ Bulker compose REJECTED: ${msg}`);
    out.bulker.compose = { error: msg, txHash: null, gasUsed: '0', sigs: [], perSig: [], maxCu: 0, totalCu: 0 };
  }

  // ────────────── SUMMARY ──────────────
  const directMaxCu = Math.max(out.direct.supplyCollateral.maxCu, out.direct.borrow.maxCu);
  const composeMaxCu = out.bulker.compose.maxCu;
  console.log(`\n═══════ SUMMARY ═══════`);
  console.log(`  Direct supplyCollateral (PCOL):  ${out.direct.supplyCollateral.maxCu.toLocaleString()} CU`);
  console.log(`  Direct borrow (wUSDC):           ${out.direct.borrow.maxCu.toLocaleString()} CU`);
  console.log(`  Direct max single Solana tx:     ${directMaxCu.toLocaleString()} CU`);
  console.log(`  Bulker compose (single EVM tx):  ${composeMaxCu.toLocaleString()} CU`);
  console.log(`  Bulker fits 1.4M atomic?         ${composeMaxCu < 1_400_000 ? '✅ YES' : '❌ NO (over by ' + (composeMaxCu - 1_400_000).toLocaleString() + ')'}`);
  out.summary = {
    directSupplyCollateralCU: out.direct.supplyCollateral.maxCu,
    directBorrowCU:           out.direct.borrow.maxCu,
    bulkerComposeCU:          composeMaxCu,
    bulkerFitsAtomic:         composeMaxCu < 1_400_000,
  };

  const outPath = path.join(__dirname, 'bench-wusdc-collat.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
