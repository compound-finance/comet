// Phase 2 — Swap Comet's baseToken from placeholder USDC mock to UnifiedToken v2.
//
// Strategy: bypass Configurator (its config slot for this proxy is empty) and
// deploy a new Comet impl directly with UnifiedToken v2 as base, then upgrade
// the existing CometProxy via ProxyAdmin.upgrade(...).
//
// After upgrade, run a smoke test:
//   1. approve(cometProxy, max) on UnifiedToken v2 (fires SPL Approve CPI)
//   2. supply(USDC, smallAmount) — exercises Comet's full supply path with
//      transferFrom going through UnifiedToken's CPI to SPL Token transfer_checked.
//   3. Capture CU + account count for both ops.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// Pre-existing infra (Phase 0 deployed)
const ADDR = {
  WJITOSOL: '0x408724bD7A645761873a639dCB50C31FD3E371f4',
  COMP: '0xfc3D32a2fc5790485f1683e52bFBA2B1F613621e',
  USDC_FEED: '0xCD7bE9AC42dc73a4E618b8164820F8b3CF742714',
  SOL_USD_FEED: '0x6FcE6648C0350e3f7dA0C0f432405df98dD0D12E',
  COMET_PROXY: '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c',
  COMET_PROXY_ADMIN: '0xC75611c265C3c03357D5f9CF5883967150E6782C',
  COMET_EXT: '0x85D80481244761Bc40800Ec108BF6bFB2AFD9339',
  // UnifiedToken v2 deployed in Phase 2.1 (deploy-and-measure.ts)
  UNIFIED_TOKEN_V2: '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31',
};

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
  const balance = await signer.getBalance();
  console.log(`Deployer: ${signer.address}`);
  console.log(`Balance: ${ethers.utils.formatEther(balance)} (gas USDC)`);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: signer.address,
    inputs: ADDR,
    deployments: {} as any,
    measurements: {} as any,
    notes: [] as string[],
  };

  // Step 1: Build the Configuration struct for the new Comet impl, with
  // baseToken = UnifiedToken v2.
  const config = {
    governor: signer.address,
    pauseGuardian: signer.address,
    baseToken: ADDR.UNIFIED_TOKEN_V2,
    baseTokenPriceFeed: ADDR.USDC_FEED,
    extensionDelegate: ADDR.COMET_EXT,
    supplyKink: BigInt('800000000000000000'),                     // 0.8e18
    supplyPerYearInterestRateSlopeLow: BigInt('40000000000000000'),    // 0.04e18
    supplyPerYearInterestRateSlopeHigh: BigInt('400000000000000000'),  // 0.4e18
    supplyPerYearInterestRateBase: 0n,
    borrowKink: BigInt('800000000000000000'),
    borrowPerYearInterestRateSlopeLow: BigInt('60000000000000000'),
    borrowPerYearInterestRateSlopeHigh: BigInt('400000000000000000'),
    borrowPerYearInterestRateBase: BigInt('20000000000000000'),
    storeFrontPriceFactor: BigInt('500000000000000000'),
    trackingIndexScale: BigInt('1000000000000000'),
    baseTrackingSupplySpeed: 0n,
    baseTrackingBorrowSpeed: 0n,
    baseMinForRewards: 1_000_000n,
    baseBorrowMin: 1_000_000n,
    targetReserves: 0n,
    assetConfigs: [
      {
        asset: ADDR.WJITOSOL,
        priceFeed: ADDR.SOL_USD_FEED,
        decimals: 9,
        borrowCollateralFactor: BigInt('700000000000000000'),
        liquidateCollateralFactor: BigInt('800000000000000000'),
        liquidationFactor: BigInt('900000000000000000'),
        supplyCap: BigInt('100000000000000'), // 100K wjitoSOL
      },
    ],
  };

  console.log('\nStep 1: Deploying new Comet impl with baseToken = UnifiedToken v2...');
  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometImpl = await Comet.deploy(config, { gasLimit: 200_000_000 });
  await cometImpl.deployed();
  console.log(`  New Comet impl: ${cometImpl.address}`);
  out.deployments.cometImplV2 = cometImpl.address;

  // Step 2: Upgrade the proxy via ProxyAdmin
  console.log('\nStep 2: Upgrading CometProxy → new impl via ProxyAdmin...');
  const ProxyAdminAbi = [
    'function upgrade(address proxy, address implementation) external',
    'function getProxyImplementation(address proxy) external view returns (address)',
    'function owner() external view returns (address)',
  ];
  const proxyAdmin = new ethers.Contract(ADDR.COMET_PROXY_ADMIN, ProxyAdminAbi, signer);
  const owner = await proxyAdmin.owner();
  console.log(`  ProxyAdmin owner: ${owner}`);
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(`  ERROR: deployer (${signer.address}) is not ProxyAdmin owner (${owner})`);
    out.notes.push(`BLOCKED: ProxyAdmin owner is ${owner}, deployer is ${signer.address}`);
    fs.writeFileSync(path.join(__dirname, 'phase2-swap-results.json'), JSON.stringify(out, null, 2));
    return;
  }
  const priorImpl = await proxyAdmin.getProxyImplementation(ADDR.COMET_PROXY);
  console.log(`  Prior impl: ${priorImpl}`);
  out.priorImpl = priorImpl;

  const upgradeTx = await proxyAdmin.upgrade(ADDR.COMET_PROXY, cometImpl.address, { gasLimit: 5_000_000 });
  await upgradeTx.wait();
  out.measurements.upgradeProxy = await measureEvmTx(upgradeTx.hash, 'proxyAdmin.upgrade');

  const newImpl = await proxyAdmin.getProxyImplementation(ADDR.COMET_PROXY);
  console.log(`  New impl after upgrade: ${newImpl}`);
  out.newImpl = newImpl;
  if (newImpl.toLowerCase() !== cometImpl.address.toLowerCase()) {
    out.notes.push(`WARN: post-upgrade impl mismatch — got ${newImpl}, expected ${cometImpl.address}`);
  }

  // Step 3: Re-initialize storage on the proxy
  console.log('\nStep 3: Calling initializeStorage on the proxy with new impl...');
  const cometViaProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', ADDR.COMET_PROXY);
  try {
    const initTx = await cometViaProxy.initializeStorage({ gasLimit: 5_000_000 });
    await initTx.wait();
    out.measurements.initializeStorage = await measureEvmTx(initTx.hash, 'proxy.initializeStorage');
  } catch (e) {
    console.log(`  initializeStorage failed (already initialized?): ${(e as Error).message?.slice(0, 200)}`);
    out.notes.push(`initializeStorage: ${(e as Error).message?.slice(0, 200)}`);
  }

  // Step 4: Verify the proxy now reports baseToken = UnifiedToken v2
  console.log('\nStep 4: Verifying proxy.baseToken() returns UnifiedToken v2...');
  const baseTokenAddr = await cometViaProxy.baseToken();
  console.log(`  baseToken: ${baseTokenAddr}`);
  out.verifications = { baseToken: baseTokenAddr };
  if (baseTokenAddr.toLowerCase() !== ADDR.UNIFIED_TOKEN_V2.toLowerCase()) {
    out.notes.push(`WARN: baseToken mismatch — got ${baseTokenAddr}, expected ${ADDR.UNIFIED_TOKEN_V2}`);
  }

  // Step 5: approve + supply smoke test
  console.log('\nStep 5: approve + supply smoke test...');
  const tokenAbi = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
  ];
  const token = new ethers.Contract(ADDR.UNIFIED_TOKEN_V2, tokenAbi, signer);
  const myBalance = await token.balanceOf(signer.address);
  console.log(`  deployer USDC balance (UnifiedToken view): ${myBalance.toString()}`);

  // Approve max (already done in deploy-and-measure but redo to confirm allowance set)
  const approveTx = await token.approve(ADDR.COMET_PROXY, ethers.constants.MaxUint256, { gasLimit: 5_000_000 });
  await approveTx.wait();
  out.measurements.approveBeforeSupply = await measureEvmTx(approveTx.hash, 'approve(MAX,proxy)');

  // Try a tiny supply
  if (myBalance.gt(0)) {
    try {
      const amount = myBalance.gte(1_000_000n) ? 1_000_000n : myBalance.toBigInt();
      console.log(`  attempting supply(USDC, ${amount}) — equivalent to ${ethers.utils.formatUnits(amount, 6)} USDC`);
      const supplyTx = await cometViaProxy.supply(ADDR.UNIFIED_TOKEN_V2, amount, { gasLimit: 8_000_000 });
      await supplyTx.wait();
      out.measurements.supplyViaProxy = await measureEvmTx(supplyTx.hash, 'cometProxy.supply(USDC,1e6)');
    } catch (e) {
      console.log(`  supply failed: ${(e as Error).message?.slice(0, 250)}`);
      out.notes.push(`supply failed: ${(e as Error).message?.slice(0, 250)}`);
    }
  } else {
    console.log('  deployer has no USDC at AUTHORITY_PDA ATA — supply test skipped');
    out.notes.push('supply skipped: deployer USDC ATA balance = 0; need to seed via CCTP or mint');
  }

  // Step 6: Verify the proxy still works for reads
  console.log('\nStep 6: Read totalSupply through proxy...');
  try {
    const totalSupply = await cometViaProxy.totalSupply();
    console.log(`  totalSupply: ${totalSupply.toString()}`);
    out.verifications.totalSupply = totalSupply.toString();
  } catch (e) {
    console.log(`  totalSupply read failed: ${(e as Error).message?.slice(0, 200)}`);
  }

  // Persist
  const outPath = path.join(__dirname, 'phase2-swap-results.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
