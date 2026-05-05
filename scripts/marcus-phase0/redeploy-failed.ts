// Phase 0 — Re-deploy failed contracts after rome-sdk proxy-keypair funding fix.
//
// Context: original Phase 0 run on 2026-05-04 failed CometProxy and CometRewards
// with mollusk Custom(1) emulator drift. Operator identified the root cause:
// rome-sdk's 3 proxy-keypairs were unfunded → emulator-side preflight rejected
// the deploys. They are now funded:
//   - 5bVPWr9w9xDPXFjwCmm7yQ1QmieKp5zrrmAKpAr3R2qK : 9.95 SOL
//   - J5U9d26bUJemGUSYZ2zCDjqKeZYqrJnMtUYptBMANKEE : 9.81 SOL
//   - 8jKVFPN1TamfJPyJiXa2n8bH8ko3GT34dUGS7MpS9Qvv : 9.90 SOL
//
// This script picks up from the existing deployed-contract state recorded in
// phase0-measurements.json + the deploy-and-bench.ts addresses and re-deploys
// only the missing pieces:
//   - CometProxy (TransparentUpgradeableProxy bound to existing Comet impl)
//   - CometRewards
// CometFactory was actually deployed in the original run despite operator's
// task framing — verified live bytecode at 0x0497eC78... so we skip it.
//
// After deploys: wire CometFactory into Configurator (setFactory) and run a
// supply tx through the proxy to confirm production shape works.
//
// Run:
//   ETH_PK=$(cat /Users/anilkumar/rome/.secrets/marcus/deployer.key) \
//   npx hardhat run scripts/marcus-phase0/redeploy-failed.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// ===== Pre-existing addresses (verified on-chain via eth_getCode) =====
const ADDR = {
  USDC: '0x14D9359B6F72CbAa25c54fedd5846B26965716e4',
  WJITOSOL: '0x408724bD7A645761873a639dCB50C31FD3E371f4',
  COMP: '0xfc3D32a2fc5790485f1683e52bFBA2B1F613621e',
  USDC_FEED: '0xCD7bE9AC42dc73a4E618b8164820F8b3CF742714',
  SOL_USD_FEED: '0x6FcE6648C0350e3f7dA0C0f432405df98dD0D12E',
  COMET_PROXY_ADMIN: '0xC75611c265C3c03357D5f9CF5883967150E6782C',
  COMET_EXT: '0x85D80481244761Bc40800Ec108BF6bFB2AFD9339',
  COMET_FACTORY: '0x0497eC7884693e630c7BF074F1E61169966f4a78',
  COMET_IMPL: '0x4e81Db7fd317B61BcDd73eA9983A6B077b4a5A39',
  CONFIGURATOR_IMPL: '0x12B81aaCC822C1Ff19Dc70B46Da7BC4feBB8AC56',
  CONFIGURATOR_PROXY: '0x53FF4076E6D82908806aEA3b5447AD919FdC10F8',
};

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';

function exp(amount: number, decimals: number): bigint {
  if (Number.isInteger(amount)) return BigInt(amount) * 10n ** BigInt(decimals);
  return BigInt(Math.round(amount * 1e6)) * 10n ** BigInt(decimals - 6);
}

async function rawRpc(url: string, method: string, params: any[]): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return await r.json();
}

// Deploy retry: max 3 per task per operator's hard rule
async function deployWithRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      console.log(`  [${label}] attempt ${i + 1}/${attempts}...`);
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = (e.message || JSON.stringify(e)).slice(0, 200);
      console.log(`  [${label}] attempt ${i + 1} FAILED: ${msg}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(`${label} failed all ${attempts} attempts: ${lastErr?.message?.slice(0, 200)}`);
}

async function captureSolanaSig(sig: string): Promise<{ cu?: number; accts?: number; size?: number }> {
  const txInfo = await rawRpc(SOLANA_RPC, 'getTransaction', [
    sig,
    { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ]);
  const info = txInfo?.result;
  if (!info) return {};
  const cu = info.meta?.computeUnitsConsumed;
  const accts =
    info.transaction?.message?.accountKeys?.length ??
    info.transaction?.message?.staticAccountKeys?.length;
  const enc = await rawRpc(SOLANA_RPC, 'getTransaction', [
    sig,
    { encoding: 'base64', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ]);
  const b64 = enc?.result?.transaction?.[0];
  const size = b64 ? Buffer.from(b64, 'base64').length : undefined;
  return { cu, accts, size };
}

async function captureTxMeasurement(label: string, tx: any) {
  const receipt = await tx.wait();
  await new Promise((r) => setTimeout(r, 4000));
  const solRes = await rawRpc(MARCUS_RPC, 'rome_solanaTxForEvmTx', [tx.hash]);
  const sigs: string[] = solRes.result || [];
  const cus: number[] = [];
  const accts: number[] = [];
  const sizes: number[] = [];
  for (const sig of sigs) {
    const cap = await captureSolanaSig(sig);
    if (cap.cu !== undefined) cus.push(cap.cu);
    if (cap.accts !== undefined) accts.push(cap.accts);
    if (cap.size !== undefined) sizes.push(cap.size);
  }
  console.log(
    `    [${label}] tx=${tx.hash.slice(0, 12)}…  evmGas=${receipt.gasUsed}  solSigs=${sigs.length}  CU=${cus.join(',')}  accts=${accts.join(',')}  size=${sizes.join(',')}`
  );
  return {
    txHash: tx.hash,
    evmGas: receipt.gasUsed.toString(),
    blockNumber: receipt.blockNumber,
    solanaTxs: sigs,
    computeUnits: cus,
    accountCounts: accts,
    txSizes: sizes,
  };
}

async function main() {
  const [admin] = await ethers.getSigners();
  const balance = await admin.getBalance();
  console.log('Deployer:', admin.address);
  console.log('Balance:', ethers.utils.formatEther(balance), 'USDC (gas)');

  // Verify all the pre-existing contracts have bytecode
  console.log('\n=== Verifying pre-existing contract bytecode ===');
  for (const [name, addr] of Object.entries(ADDR)) {
    const code = await ethers.provider.getCode(addr);
    if (code === '0x' || code === '0x0') {
      throw new Error(`${name} at ${addr} has no bytecode — cannot proceed`);
    }
    console.log(`  ${name.padEnd(20)} ${addr}  (${code.length} bytes)`);
  }

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: admin.address,
    preExisting: { ...ADDR },
    redeployed: {},
    wiring: {},
    proxyShapeMeasurement: {},
    notes: [
      'Re-deploy after operator funded rome-sdk proxy keypairs (each ~9.9 SOL, was empty).',
      'Original failure root cause: empty proxy keypairs caused emulator-side preflight to fail with mollusk Custom(1).',
      'CometFactory verified live at 0x0497eC78... despite operator listing it as failed; deployed in original run.',
    ],
  };
  const outPath = path.join(__dirname, 'redeploy-results.json');

  // ============================================================
  // STEP 1: Deploy CometRewards (simple, no dependencies on Comet)
  // ============================================================
  console.log('\n=== STEP 1: Deploy CometRewards ===');
  const CometRewards = await ethers.getContractFactory('contracts/CometRewards.sol:CometRewards');
  const rewards = await deployWithRetry('CometRewards.deploy', async () => {
    const c = await CometRewards.deploy(admin.address, { gasLimit: 100_000_000 });
    await c.deployed();
    return c;
  });
  console.log(`  CometRewards: ${rewards.address}`);
  out.redeployed.cometRewards = rewards.address;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  // Verify bytecode
  const rewardsCode = await ethers.provider.getCode(rewards.address);
  if (rewardsCode === '0x' || rewardsCode.length < 10) {
    throw new Error(`CometRewards bytecode missing at ${rewards.address}`);
  }
  console.log(`  → bytecode confirmed (${rewardsCode.length} bytes)`);

  // ============================================================
  // STEP 2: Deploy TransparentUpgradeableProxy (CometProxy)
  //   - logic = COMET_IMPL
  //   - admin = COMET_PROXY_ADMIN
  //   - data  = '0x'  (no init via proxy ctor; we'll call initializeStorage after)
  // ============================================================
  console.log('\n=== STEP 2: Deploy CometProxy (TransparentUpgradeableProxy) ===');
  const TUP = await ethers.getContractFactory(
    'contracts/vendor/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy'
  );
  const cometProxy = await deployWithRetry('CometProxy.deploy', async () => {
    const c = await TUP.deploy(ADDR.COMET_IMPL, ADDR.COMET_PROXY_ADMIN, '0x', {
      gasLimit: 100_000_000,
    });
    await c.deployed();
    return c;
  });
  console.log(`  CometProxy: ${cometProxy.address}`);
  out.redeployed.cometProxy = cometProxy.address;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  const proxyCode = await ethers.provider.getCode(cometProxy.address);
  if (proxyCode === '0x' || proxyCode.length < 10) {
    throw new Error(`CometProxy bytecode missing at ${cometProxy.address}`);
  }
  console.log(`  → bytecode confirmed (${proxyCode.length} bytes)`);

  // ============================================================
  // STEP 3: Initialize Comet storage via the proxy
  //   The proxy DELEGATECALLs the impl. The impl has its own initialized state
  //   (we already called initializeStorage on the impl directly in the original
  //   run for VR-3 measurements), but the proxy's storage is fresh — separate
  //   from impl's. Need to initialize storage at the proxy's storage slot space.
  // ============================================================
  console.log('\n=== STEP 3: Initialize Comet storage via proxy ===');
  // Build a Comet handle pointing at the proxy address
  const cometViaProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', cometProxy.address);
  let initOk = false;
  try {
    const initTx = await deployWithRetry('initializeStorage(via proxy)', async () => {
      return await cometViaProxy.initializeStorage({ gasLimit: 5_000_000 });
    });
    const initReceipt = await initTx.wait();
    console.log(`  initializeStorage tx: ${initTx.hash}  block: ${initReceipt.blockNumber}`);
    out.wiring.proxyInitializeStorage = {
      txHash: initTx.hash,
      evmGas: initReceipt.gasUsed.toString(),
      blockNumber: initReceipt.blockNumber,
    };
    initOk = true;
  } catch (e: any) {
    console.log(`  initializeStorage FAILED: ${e.message?.slice(0, 200)}`);
    out.wiring.proxyInitializeStorage = { error: e.message?.slice(0, 200) };
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  // ============================================================
  // STEP 4: Wire CometFactory into Configurator for the proxy
  //   configurator.setFactory(cometProxy, cometFactory)
  // ============================================================
  console.log('\n=== STEP 4: Wire CometFactory into Configurator ===');
  const configurator = await ethers.getContractAt(
    'contracts/Configurator.sol:Configurator',
    ADDR.CONFIGURATOR_PROXY  // Configurator is accessed through its proxy
  );
  try {
    const setFactoryTx = await deployWithRetry(
      'configurator.setFactory',
      async () => {
        return await configurator.setFactory(cometProxy.address, ADDR.COMET_FACTORY, {
          gasLimit: 3_000_000,
        });
      }
    );
    const r = await setFactoryTx.wait();
    console.log(`  setFactory tx: ${setFactoryTx.hash}  block: ${r.blockNumber}`);
    out.wiring.setFactory = { txHash: setFactoryTx.hash, evmGas: r.gasUsed.toString(), blockNumber: r.blockNumber };
  } catch (e: any) {
    console.log(`  setFactory FAILED (non-blocking): ${e.message?.slice(0, 200)}`);
    out.wiring.setFactory = { error: e.message?.slice(0, 200) };
  }
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  // ============================================================
  // STEP 5: Verify the proxy works — supply 1 USDC through CometProxy
  //   Capture CU for the proxy-shape supply (impl shape was 700K iter2; expect
  //   +2-5K for DELEGATECALL overhead).
  // ============================================================
  if (initOk) {
    console.log('\n=== STEP 5: Verify proxy with 1 USDC supply ===');
    const usdc = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', ADDR.USDC);
    // Make sure deployer has USDC and approval to the proxy
    const usdcBal = await usdc.balanceOf(admin.address);
    console.log(`  deployer USDC balance: ${ethers.utils.formatUnits(usdcBal, 6)}`);
    const proxyAllowance = await usdc.allowance(admin.address, cometProxy.address);
    if (proxyAllowance.lt(exp(1, 6))) {
      console.log('  approving USDC to CometProxy...');
      const approveTx = await deployWithRetry(
        'usdc.approve(proxy)',
        async () => {
          return await usdc.approve(cometProxy.address, ethers.constants.MaxUint256, {
            gasLimit: 2_000_000,
          });
        }
      );
      const ar = await approveTx.wait();
      console.log(`  approve tx: ${approveTx.hash}  block: ${ar.blockNumber}`);
      out.proxyShapeMeasurement.approve = await captureTxMeasurement('approve', approveTx);
    } else {
      console.log(`  already approved (allowance=${proxyAllowance.toString()})`);
    }

    try {
      console.log('  supplying 1 USDC through CometProxy...');
      const supplyTx = await deployWithRetry('proxy.supply(USDC, 1e6)', async () => {
        return await cometViaProxy.supply(ADDR.USDC, exp(1, 6), { gasLimit: 5_000_000 });
      });
      out.proxyShapeMeasurement.supply = await captureTxMeasurement('supply', supplyTx);
      console.log('  → supply via proxy SUCCESS');
    } catch (e: any) {
      console.log(`  supply via proxy FAILED: ${e.message?.slice(0, 200)}`);
      out.proxyShapeMeasurement.supply = { error: e.message?.slice(0, 200) };
    }
  } else {
    console.log('\n=== STEP 5: SKIPPED (initializeStorage failed) ===');
  }

  // ============================================================
  // STEP 6: Save final results
  // ============================================================
  console.log('\n=== Saving redeploy results ===');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`  → ${outPath}`);

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`  CometRewards: ${out.redeployed.cometRewards}`);
  console.log(`  CometProxy:   ${out.redeployed.cometProxy}`);
  if (out.proxyShapeMeasurement?.supply?.computeUnits) {
    console.log(`  Proxy-shape supply CU: [${out.proxyShapeMeasurement.supply.computeUnits.join(', ')}]`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
