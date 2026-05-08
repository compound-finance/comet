// Phase E smoke: verify direct user-initiated comet.supply lands on Marcus
// post PR #4 (CPI shortcut adoption). Mirrors what the EVM-lane Supply
// button in the demo UI calls — no relayer involved, just:
//   1. unifiedToken.approve(comet, amount)  (skipped if already approved)
//   2. comet.supply(unifiedToken, amount)
//
// Captures the per-Solana-tx CU breakdown so we know if direct supply
// fits the 1.4M ceiling without the T1/T2/T3 relayer split.

import { ethers } from 'hardhat';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_RPC    = 'https://api.devnet.solana.com';

const ADDR = {
  // The supply-only Comet from bench-supply (pre-collateral).
  unifiedToken: '0xe76bb4c8C0f50C75eE348E91ddd34f4043582aCC',
  cometProxy:   '0xDf203b46C89921537F24beA30046eb1FF8c3FCD3',
};

const AMOUNT_RAW = 10_000n; // 0.01 USDC

async function rpc(method: string, params: any[], rpcUrl = MARCUS_RPC): Promise<any> {
  const r = await fetch(rpcUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  }).then((x: any) => x.json());
  if (r.error) throw new Error(`${method}: ${JSON.stringify(r.error)}`);
  return r.result;
}

async function getSolanaCu(evmTxHash: string) {
  const sigs: string[] = await rpc('rome_solanaTxForEvmTx', [evmTxHash]).catch(() => []);
  const perSig: { sig: string; cu: number | null }[] = [];
  let maxCu = 0; let totalCu = 0;
  for (const sig of sigs) {
    let meta: any = null;
    for (let i = 0; i < 8; i++) {
      const tx = await rpc('getTransaction', [sig, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }], SOL_RPC).catch(() => null);
      if (tx?.meta) { meta = tx.meta; break; }
      await new Promise(r => setTimeout(r, 1500));
    }
    const cu = meta?.computeUnitsConsumed ?? null;
    perSig.push({ sig, cu });
    if (cu) { maxCu = Math.max(maxCu, cu); totalCu += cu; }
  }
  return { sigs, perSig, maxCu, totalCu };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer:      ${deployer.address}`);
  const ut = await ethers.getContractAt('contracts/unified-token/UnifiedToken.sol:UnifiedToken', ADDR.unifiedToken, deployer);
  const comet = await ethers.getContractAt('contracts/Comet.sol:Comet', ADDR.cometProxy, deployer);

  const utBalance = await ut.balanceOf(deployer.address);
  console.log(`UT balance:    ${ethers.utils.formatUnits(utBalance, 6)} USDC`);
  if (utBalance.lt(AMOUNT_RAW)) throw new Error(`Insufficient UT: have ${utBalance}, need ${AMOUNT_RAW}`);

  const allowance = await ut.allowance(deployer.address, ADDR.cometProxy);
  console.log(`Allowance:     ${allowance.toString()}`);
  if (allowance.lt(AMOUNT_RAW)) {
    console.log(`\n[1/2] approve(comet, max)…`);
    const tx = await ut.approve(ADDR.cometProxy, ethers.constants.MaxUint256, { gasLimit: 5_000_000 });
    const r = await tx.wait();
    const cu = await getSolanaCu(tx.hash);
    console.log(`  evm tx ${tx.hash}  block ${r.blockNumber}  gasUsed ${r.gasUsed}`);
    console.log(`  solana sigs ${cu.sigs.length}  maxCU ${cu.maxCu.toLocaleString()}  totalCU ${cu.totalCu.toLocaleString()}`);
  } else {
    console.log(`[1/2] allowance sufficient — skip approve`);
  }

  console.log(`\n[2/2] comet.supply(USDC, ${AMOUNT_RAW})…`);
  try {
    const tx = await comet.supply(ADDR.unifiedToken, AMOUNT_RAW, { gasLimit: 30_000_000 });
    const r = await tx.wait();
    const cu = await getSolanaCu(tx.hash);
    console.log(`  ✓ evm tx ${tx.hash}  block ${r.blockNumber}  gasUsed ${r.gasUsed}`);
    console.log(`  solana sigs: ${cu.sigs.length}`);
    for (const ps of cu.perSig) {
      console.log(`    ${ps.sig}  cu=${ps.cu?.toLocaleString() ?? 'unknown'}`);
    }
    console.log(`  maxCU ${cu.maxCu.toLocaleString()}  totalCU ${cu.totalCu.toLocaleString()}  ceiling 1,400,000`);
    console.log(`  fits ceiling: ${cu.maxCu < 1_400_000 ? '✅ YES' : '❌ NO'}`);
  } catch (e: any) {
    console.log(`  ✗ SUPPLY FAILED: ${e.message?.slice(0, 300) ?? e}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
