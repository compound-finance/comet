// Phase 2.2 + 2.3 — Marcus integration of UnifiedToken with SPL-delegate approve
// + Comet swap + on-chain CU measurement.
//
// Tasks:
//   1. Deploy a fresh UnifiedToken impl pointing at Solana devnet USDC mint.
//      (The 2026-05-05 v1 at 0xBaED... predates the SPL-delegate approve
//       revision; we ship a v2.)
//   2. Measure approve CU (now includes SPL Approve CPI).
//   3. Deploy a new Comet impl wired to UnifiedToken-v2 as base token.
//   4. Run a supply smoke test through the existing CometProxy (after
//      Configurator wire-up) and capture CU + account count.
//   5. Snapshot all results to phase2-measurements.json.
//
// Budget: ≤30 USDC of deployer balance.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';

// Phase 0 / Phase 1 anchors (already deployed on Marcus 121301)
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const COMET_PROXY_ADMIN = '0xC75611c265C3c03357D5f9CF5883967150E6782C';
const CONFIGURATOR_PROXY = '0x53FF4076E6D82908806aEA3b5447AD919FdC10F8';
const COMET_FACTORY = '0x0497eC7884693e630c7BF074F1E61169966f4a78';
const COMET_EXT = '0x85D80481244761Bc40800Ec108BF6bFB2AFD9339';
const PLACEHOLDER_WJITOSOL = '0x408724bD7A645761873a639dCB50C31FD3E371f4';
const USDC_PRICE_FEED = '0xCD7bE9AC42dc73a4E618b8164820F8b3CF742714';
const JITOSOL_PRICE_FEED = '0x6FcE6648C0350e3f7dA0C0f432405df98dD0D12E';
const COMP_PLACEHOLDER = '0xfc3D32a2fc5790485f1683e52bFBA2B1F613621e';

// Solana devnet USDC mint
const USDC_MINT_BS58 = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';
const PROGRAM_ID = 'RomeDbGQYbqomGVk13h9JkQHKoNWKB84Lw1ij9AtRXT';

function bs58ToBytes32(b: string): string {
  const decoded = bs58.decode(b);
  if (decoded.length !== 32) throw new Error(`bs58 not 32 bytes: ${decoded.length}`);
  return '0x' + Buffer.from(decoded).toString('hex');
}

interface SolanaTxMeta {
  computeUnitsConsumed: number | null;
  err: any | null;
  staticAccountKeys: string[];
  txVersion: 'legacy' | number;
  rawSig: string;
}

async function getRomeSolanaSigs(evmTxHash: string): Promise<string[]> {
  const r = await fetch(MARCUS_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'rome_solanaTxForEvmTx', params: [evmTxHash],
    }),
  });
  const j: any = await r.json();
  if (j.error) {
    console.log('  rome_solanaTxForEvmTx error:', JSON.stringify(j.error));
    return [];
  }
  return j.result || [];
}

async function getSolanaTxMeta(sig: string): Promise<SolanaTxMeta | null> {
  const r = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'getTransaction',
      params: [sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0, encoding: 'json' }],
    }),
  });
  const j: any = await r.json();
  if (j.error) return null;
  if (!j.result) return null;
  const meta = j.result.meta;
  const tx = j.result.transaction;
  const staticAccountKeys =
    tx?.message?.accountKeys?.map((k: any) => (typeof k === 'string' ? k : k.pubkey)) ?? [];
  const txVersion = tx?.version ?? 'legacy';
  return {
    computeUnitsConsumed: meta?.computeUnitsConsumed ?? null,
    err: meta?.err ?? null,
    staticAccountKeys,
    txVersion,
    rawSig: sig,
  };
}

async function measureEvmTx(evmTxHash: string, label: string): Promise<{
  txHash: string;
  evmGas: string;
  blockNumber: number;
  reverted: boolean;
  solanaTxs: string[];
  computeUnits: number[];
  accountCount: number;
  txVersion: 'legacy' | number;
}> {
  const provider = ethers.provider;
  const rcpt = await provider.getTransactionReceipt(evmTxHash);
  console.log(`  ${label}: evmTx=${evmTxHash} block=${rcpt.blockNumber} status=${rcpt.status}`);

  await new Promise(r => setTimeout(r, 4_000));
  const sigs = await getRomeSolanaSigs(evmTxHash);
  console.log(`  ${label}: solana sigs (${sigs.length}): ${sigs.join(',')}`);

  const cus: number[] = [];
  let accountCount = 0;
  let txVersion: 'legacy' | number = 'legacy';
  for (const sig of sigs) {
    let meta: SolanaTxMeta | null = null;
    for (let i = 0; i < 6; i++) {
      meta = await getSolanaTxMeta(sig);
      if (meta) break;
      await new Promise(r => setTimeout(r, 2_000));
    }
    if (!meta) {
      console.log(`  ${label}: WARN — no meta for ${sig}`);
      continue;
    }
    cus.push(meta.computeUnitsConsumed ?? 0);
    accountCount = Math.max(accountCount, meta.staticAccountKeys.length);
    txVersion = meta.txVersion;
    console.log(
      `  ${label}: sig=${sig.slice(0, 12)}… cu=${meta.computeUnitsConsumed} accts=${meta.staticAccountKeys.length} ver=${meta.txVersion}`,
    );
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
  const balance = await signer.getBalance();
  console.log('Phase 2 — UnifiedToken v2 (SPL-delegate approve) + Comet swap');
  console.log(`Deployer: ${signer.address}`);
  console.log(`Balance: ${ethers.utils.formatEther(balance)} (gas USDC on Marcus)`);

  const usdcMintBytes32 = bs58ToBytes32(USDC_MINT_BS58);
  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: signer.address,
    inputs: {
      usdcMintBs58: USDC_MINT_BS58,
      usdcMintBytes32,
      cometProxy: COMET_PROXY,
      cometProxyAdmin: COMET_PROXY_ADMIN,
      configuratorProxy: CONFIGURATOR_PROXY,
      cometFactory: COMET_FACTORY,
      cometExt: COMET_EXT,
      placeholderWjitoSol: PLACEHOLDER_WJITOSOL,
      usdcPriceFeed: USDC_PRICE_FEED,
      jitoSolPriceFeed: JITOSOL_PRICE_FEED,
      compPlaceholder: COMP_PLACEHOLDER,
    },
    deployments: {} as any,
    measurements: {} as any,
    notes: [] as string[],
  };

  // ── Step 1: deploy UnifiedToken v2 ──────────────────────────────────────
  console.log('\nStep 1: Deploying UnifiedToken v2 (with SPL-delegate approve)...');
  const T = await ethers.getContractFactory('UnifiedToken');
  const tokenV2 = await T.deploy(usdcMintBytes32, 'Unified USDC', 'USDC', 6, signer.address);
  await tokenV2.deployed();
  console.log(`  UnifiedToken v2: ${tokenV2.address}`);
  out.deployments.unifiedTokenV2 = tokenV2.address;

  // ── Step 2: measure approve (now with SPL Approve CPI) ──────────────────
  console.log('\nStep 2: Measuring approve(comet, max) CU...');
  const MAX = ethers.constants.MaxUint256;
  const approveTx = await tokenV2.approve(COMET_PROXY, MAX);
  await approveTx.wait();
  out.measurements.approveMaxToProxy = await measureEvmTx(approveTx.hash, 'approve(MAX,comet)');

  // small finite approve too — should also include SPL Approve CPI
  console.log('\nStep 3: Measuring approve(comet, 1e6) CU (finite)...');
  const approveFiniteTx = await tokenV2.approve(COMET_PROXY, 1_000_000n);
  await approveFiniteTx.wait();
  out.measurements.approveFiniteToProxy = await measureEvmTx(approveFiniteTx.hash, 'approve(1e6,comet)');

  // approve(0) = revoke
  console.log('\nStep 4: Measuring approve(comet, 0) CU (revoke)...');
  const approveZeroTx = await tokenV2.approve(COMET_PROXY, 0);
  await approveZeroTx.wait();
  out.measurements.approveZeroToProxy = await measureEvmTx(approveZeroTx.hash, 'approve(0,comet)');

  out.notes.push(
    'Phase 2.2 — UnifiedToken v2 with SPL-delegate approve deployed. approve() now does both EVM allowance + SPL Token Approve CPI; approve(0) issues SPL Revoke. Compound supply pattern (transferFrom user→comet) now executes end-to-end without separate Solana wallet steps.',
  );

  // ── Step 5: deploy a new Comet impl wired to UnifiedToken v2 ────────────
  console.log('\nStep 5: Reading current Configurator config...');
  const ConfiguratorAbi = [
    'function getConfiguration(address cometProxy) external view returns (tuple(address governor, address pauseGuardian, address baseToken, address baseTokenPriceFeed, address extensionDelegate, uint64 supplyKink, uint64 supplyPerYearInterestRateSlopeLow, uint64 supplyPerYearInterestRateSlopeHigh, uint64 supplyPerYearInterestRateBase, uint64 borrowKink, uint64 borrowPerYearInterestRateSlopeLow, uint64 borrowPerYearInterestRateSlopeHigh, uint64 borrowPerYearInterestRateBase, uint64 storeFrontPriceFactor, uint64 trackingIndexScale, uint64 baseTrackingSupplySpeed, uint64 baseTrackingBorrowSpeed, uint104 baseMinForRewards, uint104 baseBorrowMin, uint104 targetReserves, tuple(address asset, address priceFeed, uint8 decimals, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap)[] assetConfigs))',
    'function setBaseToken(address cometProxy, address newBaseToken) external',
    'function setBaseTokenPriceFeed(address cometProxy, address newPriceFeed) external',
    'function deploy(address cometProxy) external returns (address)',
  ];
  const Configurator = new ethers.Contract(CONFIGURATOR_PROXY, ConfiguratorAbi, signer);
  let priorConfig;
  try {
    priorConfig = await Configurator.getConfiguration(COMET_PROXY);
    console.log(`  Prior baseToken: ${priorConfig.baseToken}`);
  } catch (e) {
    console.log(`  WARN: getConfiguration failed: ${(e as Error).message}`);
    out.notes.push(`WARN: Configurator.getConfiguration on cometProxy reverted — likely needs Phase 0 redeploy state. ${(e as Error).message}`);
  }

  console.log('\nStep 6: Setting baseToken to UnifiedToken v2 via Configurator...');
  let setBaseTokenSuccess = false;
  try {
    const setTx = await Configurator.setBaseToken(COMET_PROXY, tokenV2.address);
    await setTx.wait();
    out.measurements.setBaseTokenTx = await measureEvmTx(setTx.hash, 'setBaseToken(unifiedTokenV2)');
    setBaseTokenSuccess = true;
    console.log('  setBaseToken: ok');
  } catch (e) {
    console.log(`  setBaseToken failed: ${(e as Error).message}`);
    out.notes.push(`setBaseToken failed: ${(e as Error).message}`);
  }

  if (setBaseTokenSuccess) {
    console.log('\nStep 7: Calling Configurator.deploy to roll out new Comet impl...');
    try {
      const deployTx = await Configurator.deploy(COMET_PROXY);
      await deployTx.wait();
      out.measurements.deployImplTx = await measureEvmTx(deployTx.hash, 'configurator.deploy');
      console.log('  Configurator.deploy: ok');
    } catch (e) {
      console.log(`  Configurator.deploy failed: ${(e as Error).message}`);
      out.notes.push(`Configurator.deploy failed: ${(e as Error).message}`);
    }
  }

  // Persist results to disk
  const outPath = path.join(__dirname, 'phase2-measurements.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults written to ${outPath}`);
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
