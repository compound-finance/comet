// Phase 0 follow-up: VR-3 borrow + absorb measurements on Marcus chain 121301.
//
// STAGES:
//   0. Proxy-shape borrow: borrow via CometProxy (production user-facing path)
//      - The original VR-3 numbers were against `Comet impl` direct.
//      - Today's task: re-measure borrow against the proxy (DELEGATECALL adds ~6.6% CU).
//   1. Impl-direct borrow: already captured in phase0-borrow-absorb.json. Skipped via
//      idempotency check.
//   2. Absorb (liquidation): use CometHarness setBasePrincipal/setCollateralBalance to
//      forge an underwater position cheaply (no full supply/borrow flow needed),
//      drop the jitoSOL price via SimplePriceFeed, then call absorb().
//   3. (Bonus) buyCollateral: secondary-market purchase of seized reserves.
//
// Idempotency: any stage already captured in `phase0-borrow-absorb.json` is skipped.
//
// Run: ETH_PK=$(cat ~/rome/.secrets/marcus/deployer.key) \
//      npx hardhat run scripts/marcus-phase0/measure-borrow-absorb.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// ===== Existing run-2 addresses =====
const USDC = '0x14D9359B6F72CbAa25c54fedd5846B26965716e4';
const WJITOSOL = '0x408724bD7A645761873a639dCB50C31FD3E371f4';
const USDC_FEED = '0xCD7bE9AC42dc73a4E618b8164820F8b3CF742714'; // SimplePriceFeed @ $1.00
const COMP = '0xfc3D32a2fc5790485f1683e52bFBA2B1F613621e';
const COMET_IMPL_V1 = '0x4e81Db7fd317B61BcDd73eA9983A6B077b4a5A39'; // Pyth-feed Comet, used for borrow leg
const COMET_EXT = '0x85D80481244761Bc40800Ec108BF6bFB2AFD9339';
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c'; // production-shape user-facing proxy
const SOL_USD_FEED = '0x6FcE6648C0350e3f7dA0C0f432405df98dD0D12E'; // Rome Pyth Pull (immutable price)

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

interface EmulateResult {
  cu?: number;
  accountList?: number;
  steps?: number;
  iterative?: boolean;
  error?: string;
  raw?: any;
}

async function emulateTx(from: string, to: string, data: string, value = '0x0'): Promise<EmulateResult> {
  try {
    const res = await rawRpc(MARCUS_RPC, 'rome_emulateTx', [{ from, to, data, value, gas: '0x4c4b40' }]);
    if (res.error) return { error: JSON.stringify(res.error).slice(0, 200), raw: res };
    const r = res.result || {};
    return {
      cu: r.compute_units_consumed ?? r.cu ?? r?.vm?.gas_used,
      accountList: Array.isArray(r.accounts) ? r.accounts.length : (Array.isArray(r.account_list) ? r.account_list.length : undefined),
      steps: r.steps,
      iterative: r.is_iterative ?? r.iterative,
      raw: r,
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

interface Measurement {
  txHash?: string;
  evmGas?: string;
  blockNumber?: number;
  solanaTxs?: string[];
  computeUnits?: number[];
  accountCounts?: number[];
  txSizes?: number[];
  versions?: string[];
  emulator?: EmulateResult;
  semantic?: string;
  error?: string;
}

async function captureSolanaSig(sig: string): Promise<{ cu?: number; accts?: number; size?: number; version?: string }> {
  const txInfo = await rawRpc(SOLANA_RPC, 'getTransaction', [
    sig,
    { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ]);
  const info = txInfo?.result;
  if (!info) return {};
  const cu = info.meta?.computeUnitsConsumed;
  const accts =
    info.transaction?.message?.accountKeys?.length ??
    (info.transaction?.message?.staticAccountKeys?.length ?? undefined);
  // Tx size: re-encode using base64 and measure bytes
  const enc = await rawRpc(SOLANA_RPC, 'getTransaction', [
    sig,
    { encoding: 'base64', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ]);
  const b64 = enc?.result?.transaction?.[0];
  const size = b64 ? Buffer.from(b64, 'base64').length : undefined;
  const version = info.version === 'legacy' || info.version === 0 || info.version === undefined ? `legacy` : `v${info.version}`;
  return { cu, accts, size, version };
}

async function measureTxFull(label: string, signer: ethers.Signer, sendFn: () => Promise<any>): Promise<Measurement> {
  console.log(`  [${label}]`);
  const m: Measurement = {};
  try {
    const tx = await sendFn();
    m.txHash = tx.hash;
    const receipt = await tx.wait();
    m.evmGas = receipt.gasUsed.toString();
    m.blockNumber = receipt.blockNumber;
    // Wait for hercules indexing
    await new Promise((r) => setTimeout(r, 4000));
    const solRes = await rawRpc(MARCUS_RPC, 'rome_solanaTxForEvmTx', [tx.hash]);
    m.solanaTxs = solRes.result || [];
    const cus: number[] = [];
    const accts: number[] = [];
    const sizes: number[] = [];
    const versions: string[] = [];
    for (const sig of m.solanaTxs || []) {
      const cap = await captureSolanaSig(sig);
      if (cap.cu !== undefined) cus.push(cap.cu);
      if (cap.accts !== undefined) accts.push(cap.accts);
      if (cap.size !== undefined) sizes.push(cap.size);
      if (cap.version !== undefined) versions.push(cap.version);
    }
    m.computeUnits = cus;
    m.accountCounts = accts;
    m.txSizes = sizes;
    m.versions = versions;
    console.log(
      `    txHash=${tx.hash.slice(0, 12)}…  evmGas=${m.evmGas}  solSigs=${m.solanaTxs.length}  CU=${cus.join(',')}  accts=${accts.join(',')}  size=${sizes.join(',')}`
    );
  } catch (e: any) {
    m.error = e.message?.slice(0, 250);
    console.log(`    ERROR: ${m.error}`);
  }
  return m;
}

async function deploySimplePriceFeed(admin: ethers.Signer, initialPrice: bigint, decimals: number): Promise<ethers.Contract> {
  const SimplePriceFeed = await ethers.getContractFactory('contracts/test/SimplePriceFeed.sol:SimplePriceFeed');
  let feed: any;
  for (let i = 0; i < 8; i++) {
    try {
      feed = await SimplePriceFeed.connect(admin).deploy(initialPrice, decimals, { gasLimit: 50_000_000 });
      await feed.deployed();
      break;
    } catch (e: any) {
      console.log(`    [retry ${i + 1}/8] SimplePriceFeed deploy: ${e.message?.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!feed) throw new Error('SimplePriceFeed deploy failed');
  // Set fresh round data so updatedAt is current
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 5; i++) {
    try {
      const t = await feed.connect(admin).setRoundData(1, initialPrice, now, now, 1, { gasLimit: 2_000_000 });
      await t.wait();
      break;
    } catch (e: any) {
      console.log(`    [setRoundData retry ${i}] ${e.message?.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return feed;
}

async function deployFreshCometForAbsorb(
  admin: ethers.Signer,
  newSolFeedAddr: string,
  useHarness = true
): Promise<{ comet: ethers.Contract; address: string }> {
  console.log(`\n  ## Deploying fresh ${useHarness ? 'CometHarness' : 'Comet'} impl with mutable SOL feed`);
  const cometConfig = {
    governor: await admin.getAddress(),
    pauseGuardian: await admin.getAddress(),
    baseToken: USDC,
    baseTokenPriceFeed: USDC_FEED,
    extensionDelegate: COMET_EXT,
    supplyKink: ethers.BigNumber.from('850000000000000000'),
    supplyPerYearInterestRateSlopeLow: ethers.BigNumber.from('48000000000000000'),
    supplyPerYearInterestRateSlopeHigh: ethers.BigNumber.from('1600000000000000000'),
    supplyPerYearInterestRateBase: 0,
    borrowKink: ethers.BigNumber.from('850000000000000000'),
    borrowPerYearInterestRateSlopeLow: ethers.BigNumber.from('53000000000000000'),
    borrowPerYearInterestRateSlopeHigh: ethers.BigNumber.from('1700000000000000000'),
    borrowPerYearInterestRateBase: ethers.BigNumber.from('15000000000000000'),
    storeFrontPriceFactor: ethers.BigNumber.from('500000000000000000'),
    trackingIndexScale: ethers.BigNumber.from('1000000000000000'),
    baseTrackingSupplySpeed: 0,
    baseTrackingBorrowSpeed: 0,
    baseMinForRewards: ethers.BigNumber.from('100').mul(1_000_000),
    baseBorrowMin: 1,
    targetReserves: ethers.BigNumber.from('5000000').mul(1_000_000),
    assetConfigs: [
      {
        asset: WJITOSOL,
        priceFeed: newSolFeedAddr,
        decimals: 9,
        borrowCollateralFactor: ethers.BigNumber.from('700000000000000000'),
        liquidateCollateralFactor: ethers.BigNumber.from('750000000000000000'),
        liquidationFactor: ethers.BigNumber.from('930000000000000000'),
        supplyCap: ethers.BigNumber.from('100000').mul(ethers.BigNumber.from('1000000000')),
      },
    ],
  };
  const factoryName = useHarness ? 'contracts/test/CometHarness.sol:CometHarness' : 'contracts/Comet.sol:Comet';
  const Comet = await ethers.getContractFactory(factoryName);
  let cometImpl: any;
  const maxRetries = 24;
  for (let i = 0; i < maxRetries; i++) {
    try {
      cometImpl = await Comet.connect(admin).deploy(cometConfig, { gasLimit: 500_000_000 });
      await cometImpl.deployed();
      break;
    } catch (e: any) {
      console.log(`    [retry ${i + 1}/${maxRetries}] Comet deploy: ${e.message?.slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!cometImpl) throw new Error(`${factoryName} deploy failed all ${maxRetries} retries`);
  console.log(`  → fresh impl: ${cometImpl.address}`);

  // Initialize storage
  for (let i = 0; i < 3; i++) {
    try {
      const t = await cometImpl.connect(admin).initializeStorage({ gasLimit: 5_000_000 });
      await t.wait();
      console.log(`  → storage initialized`);
      break;
    } catch (e: any) {
      console.log(`    [init retry ${i}] ${e.message?.slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  return { comet: cometImpl, address: cometImpl.address };
}

async function main() {
  const signers = await ethers.getSigners();
  const admin = signers[0];
  const signer1 = signers[1];
  console.log('Admin:', admin.address);
  console.log('Signer1 (absorb victim):', signer1.address);
  console.log('Admin balance (gas):', ethers.utils.formatEther(await admin.getBalance()), 'ETH');

  const outPath = path.join(__dirname, 'phase0-borrow-absorb.json');
  let out: any = null;
  if (fs.existsSync(outPath)) {
    try {
      out = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    } catch (_) {}
  }
  if (!out) {
    out = {
      timestamp: new Date().toISOString(),
      network: 'marcus',
      chainId: 121301,
      addresses: { USDC, WJITOSOL, USDC_FEED, COMP, COMET_IMPL_V1, COMET_EXT, COMET_PROXY, SOL_USD_FEED },
      measurements: {},
      notes: [],
    };
  } else {
    // ensure new addresses are present
    out.addresses = { ...out.addresses, COMET_PROXY };
  }
  const skipStage1 = !!out.measurements?.borrowFirst?.computeUnits?.length;
  const skipStage0 = !!out.measurements?.borrowProxy?.computeUnits?.length;
  const skipAbsorb = !!out.measurements?.absorb?.computeUnits?.length;

  const usdc = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', USDC);
  const wjitoSol = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', WJITOSOL);
  const cometV1 = await ethers.getContractAt('contracts/Comet.sol:Comet', COMET_IMPL_V1);
  const cometProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', COMET_PROXY);

  // ========== STAGE 0: PROXY-SHAPE BORROW ==========
  if (skipStage0) {
    console.log('\n=== STAGE 0: PROXY borrow — already captured, skipping ===');
  } else {
    console.log('\n=== STAGE 0: PROXY-SHAPE BORROW (CometProxy, production user path) ===');

    // Read state
    const dProxyBal = await cometProxy.balanceOf(admin.address);
    let dProxyBorrow: ethers.BigNumber;
    try {
      dProxyBorrow = await cometProxy.borrowBalanceOf(admin.address);
    } catch (e: any) {
      console.log(`    borrowBalanceOf(deployer) reverted: ${e.message?.slice(0, 80)}`);
      dProxyBorrow = ethers.BigNumber.from(0);
    }
    const dProxyColl = await cometProxy.userCollateral(admin.address, WJITOSOL);
    const proxyUsdc = await usdc.balanceOf(COMET_PROXY);
    const proxyJito = await wjitoSol.balanceOf(COMET_PROXY);
    console.log(`  Proxy state: USDC liq=${ethers.utils.formatUnits(proxyUsdc,6)}, jitoSOL liq=${ethers.utils.formatUnits(proxyJito,9)}`);
    console.log(`  Deployer position via proxy: supply=${ethers.utils.formatUnits(dProxyBal,6)} USDC, borrow=${ethers.utils.formatUnits(dProxyBorrow,6)} USDC, coll=${ethers.utils.formatUnits(dProxyColl.balance,9)} jitoSOL`);

    // 0.1 Approve proxy for both tokens (idempotent)
    const usdcAllow = await usdc.allowance(admin.address, COMET_PROXY);
    if (usdcAllow.eq(0)) {
      console.log('\n  -- approve USDC → proxy --');
      out.measurements.proxyUsdcApprove = await measureTxFull('usdc.approve(proxy, max)', admin, () =>
        usdc.approve(COMET_PROXY, ethers.constants.MaxUint256, { gasLimit: 3_000_000 })
      );
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }
    const jitoAllow = await wjitoSol.allowance(admin.address, COMET_PROXY);
    if (jitoAllow.eq(0)) {
      console.log('\n  -- approve wjitoSOL → proxy --');
      out.measurements.proxyJitoApprove = await measureTxFull('wjitoSol.approve(proxy, max)', admin, () =>
        wjitoSol.approve(COMET_PROXY, ethers.constants.MaxUint256, { gasLimit: 3_000_000 })
      );
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }

    // 0.2 Top up proxy with USDC liquidity (need ~30 USDC for borrow)
    if (proxyUsdc.lt(exp(30, 6))) {
      console.log('\n  -- transfer 30 USDC liquidity to proxy --');
      out.measurements.proxyLiquidityTopup = await measureTxFull('usdc.transfer(proxy, 30e6) — top-up', admin, () =>
        usdc.transfer(COMET_PROXY, exp(30, 6), { gasLimit: 3_000_000 })
      );
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }

    // 0.3 Supply 5 wjitoSOL collateral via proxy (≈ $420 worth — covers $25 borrow easily)
    if (dProxyColl.balance.lt(exp(5, 9))) {
      console.log('\n  -- comet.supply(wjitoSOL, 5e9) via proxy (collateral) --');
      out.measurements.proxySupplyCollateral = await measureTxFull('cometProxy.supply(wjitoSOL, 5e9)', admin, () =>
        cometProxy.supply(WJITOSOL, exp(5, 9), { gasLimit: 8_000_000 })
      );
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }

    // 0.4 First borrow: withdraw 25 USDC. We have 1 USDC supplied + 5 wjitoSOL coll ≈ $420 max LTV @ 0.7 = $294 borrow ceiling.
    // Withdraw 25e6 → drains 1 USDC supply + 24 USDC pure borrow.
    const cometIface = cometProxy.interface;
    const borrowAmount = exp(25, 6);
    const borrowProxyCalldata = cometIface.encodeFunctionData('withdraw', [USDC, borrowAmount]);
    console.log('\n  -- borrow #1 (proxy.withdraw(USDC, 25e6) — 1 supply + 24 pure borrow) --');
    const borrowProxyEmu = await emulateTx(admin.address, COMET_PROXY, borrowProxyCalldata);
    console.log(`    rome_emulateTx CU: ${borrowProxyEmu.cu ?? 'n/a'}, accts: ${borrowProxyEmu.accountList ?? 'n/a'}, error: ${borrowProxyEmu.error?.slice(0,80) ?? 'none'}`);
    const borrowProxyMeas = await measureTxFull('cometProxy.withdraw(USDC, 25e6)', admin, () =>
      cometProxy.withdraw(USDC, borrowAmount, { gasLimit: 8_000_000 })
    );
    out.measurements.borrowProxy = { ...borrowProxyMeas, emulator: borrowProxyEmu, semantic: 'first borrow via production CometProxy: 1 supply withdraw + 24 USDC pure borrow against 5 wjitoSOL coll' };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

    // 0.5 Incremental borrow: withdraw 5 USDC more (pure borrow on already-indebted position)
    const borrowProxy2Calldata = cometIface.encodeFunctionData('withdraw', [USDC, exp(5, 6)]);
    console.log('\n  -- borrow #2 (proxy.withdraw(USDC, 5e6) — incremental pure borrow) --');
    const borrowProxy2Emu = await emulateTx(admin.address, COMET_PROXY, borrowProxy2Calldata);
    console.log(`    rome_emulateTx CU: ${borrowProxy2Emu.cu ?? 'n/a'}, error: ${borrowProxy2Emu.error?.slice(0,80) ?? 'none'}`);
    const borrowProxy2Meas = await measureTxFull('cometProxy.withdraw(USDC, 5e6)', admin, () =>
      cometProxy.withdraw(USDC, exp(5, 6), { gasLimit: 8_000_000 })
    );
    out.measurements.borrowProxyIncremental = { ...borrowProxy2Meas, emulator: borrowProxy2Emu, semantic: 'incremental pure borrow via proxy on already-indebted position' };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

    // 0.6 (optional) repay via proxy: supply 10 USDC to close part of the debt
    const proxyRepayCalldata = cometIface.encodeFunctionData('supply', [USDC, exp(10, 6)]);
    console.log('\n  -- repay (proxy.supply(USDC, 10e6) on debt position) --');
    const proxyRepayEmu = await emulateTx(admin.address, COMET_PROXY, proxyRepayCalldata);
    console.log(`    rome_emulateTx CU: ${proxyRepayEmu.cu ?? 'n/a'}, error: ${proxyRepayEmu.error?.slice(0,80) ?? 'none'}`);
    const proxyRepayMeas = await measureTxFull('cometProxy.supply(USDC, 10e6) — repay', admin, () =>
      cometProxy.supply(USDC, exp(10, 6), { gasLimit: 8_000_000 })
    );
    out.measurements.repayProxy = { ...proxyRepayMeas, emulator: proxyRepayEmu, semantic: 'partial repay via proxy supply against debt position' };
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

    // Verify position
    try {
      const dProxyBalAfter = await cometProxy.balanceOf(admin.address);
      const dProxyBorrowAfter = await cometProxy.borrowBalanceOf(admin.address);
      console.log(`    post-stage0 deployer: supply=${ethers.utils.formatUnits(dProxyBalAfter,6)}, borrow=${ethers.utils.formatUnits(dProxyBorrowAfter,6)}`);
    } catch (e: any) {
      console.log(`    failed to read post-stage0 state: ${e.message?.slice(0, 80)}`);
    }
  }

  // ========== STAGE 1: BORROW (V1) — already captured, skip ==========
  if (skipStage1) {
    console.log('\n=== STAGE 1: IMPL borrow — already captured, skipping ===');
  } else {
    console.log('\n=== STAGE 1: IMPL borrow — would need re-run on V1 (skipped here, run prior session captured this) ===');
  }

  // ========== STAGE 2: ABSORB MEASUREMENTS (CometHarness with mutable feed) ==========
  if (skipAbsorb) {
    console.log('\n=== STAGE 2: ABSORB — already captured, skipping ===');
  } else {
    console.log('\n=== STAGE 2: ABSORB (fresh Comet impl + mutable jitoSOL feed) ===');

    // 2a. Get/deploy SimplePriceFeed for jitoSOL initialized at SOL ≈ $84
    let newSolFeed: ethers.Contract;
    if (out.addresses.newSolFeed) {
      console.log(`  → Reusing prior SOL feed: ${out.addresses.newSolFeed}`);
      newSolFeed = await ethers.getContractAt('contracts/test/SimplePriceFeed.sol:SimplePriceFeed', out.addresses.newSolFeed);
    } else {
      newSolFeed = await deploySimplePriceFeed(admin, 8400000000n, 8); // $84 * 1e8
      console.log(`  → New SOL feed: ${newSolFeed.address}`);
      out.addresses.newSolFeed = newSolFeed.address;
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }

    // 2b. Get/deploy CometHarness impl bound to mutable feed
    let cometV2: ethers.Contract;
    let cometV2Addr: string;
    if (out.addresses.cometImplV2) {
      console.log(`  → Reusing prior CometHarness: ${out.addresses.cometImplV2}`);
      cometV2 = await ethers.getContractAt('contracts/test/CometHarness.sol:CometHarness', out.addresses.cometImplV2);
      cometV2Addr = out.addresses.cometImplV2;
    } else {
      const r = await deployFreshCometForAbsorb(admin, newSolFeed.address, true);
      cometV2 = r.comet;
      cometV2Addr = r.address;
      out.addresses.cometImplV2 = cometV2Addr;
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }

    // 2c. Use CometHarness shortcut: setBasePrincipal + setCollateralBalance
    //     to forge signer1's underwater position WITHOUT going through the full
    //     supply/borrow flow. Saves USDC and bypasses gas-funding signer1.
    //     - setBasePrincipal(signer1, -55e6) → 55 USDC debt
    //     - setCollateralBalance(signer1, jitoSOL, 1e9) → 1 wjitoSOL coll
    //
    // Then drop SOL price → underwater → absorb works.

    // The harness needs to also have aggregate state consistent: if signer1 has
    // -55e6 principal, then totalBorrowBase needs to reflect that, otherwise
    // updateBasePrincipal during absorb may produce odd numbers. But absorb's
    // CU is what we want — we don't care about exact post-state correctness.

    console.log('\n  -- Forge signer1 underwater position via CometHarness shortcuts --');
    // Step 1: setCollateralBalance(signer1, jitoSOL, 1e9). This also calls
    // updateAssetsIn so signer1 is registered as having jitoSOL.
    const s1CollNow = await cometV2.userCollateral(signer1.address, WJITOSOL);
    if (s1CollNow.balance.lt(exp(1, 9))) {
      out.measurements.harnessSetCollateral = await measureTxFull(
        'cometV2.setCollateralBalance(signer1, jitoSOL, 1e9)',
        admin,
        () => cometV2.setCollateralBalance(signer1.address, WJITOSOL, exp(1, 9), { gasLimit: 8_000_000 })
      );
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }

    // Step 2: setBasePrincipal(signer1, -55e6)
    const s1BasicNow = await cometV2.userBasic(signer1.address);
    if (s1BasicNow.principal.gte(0)) {
      const negPrincipal = ethers.BigNumber.from(-55_000_000);
      out.measurements.harnessSetPrincipal = await measureTxFull(
        'cometV2.setBasePrincipal(signer1, -55e6)',
        admin,
        () => cometV2.setBasePrincipal(signer1.address, negPrincipal, { gasLimit: 5_000_000 })
      );
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }

    // Step 3: align aggregates so absorb's `totalBorrowBase -= repayAmount`
    // and `totalsCollateral[asset].totalSupplyAsset -= seizeAmount` don't
    // underflow (panic 17 otherwise).
    //
    // CometExt exposes totalsBasic() but Comet impl doesn't have it directly.
    // Read existing fields via direct eth_call.
    const totalsBasicRaw = await rawRpc(MARCUS_RPC, 'eth_call', [
      { to: cometV2Addr, data: '0xb9f0baf7' }, // totalsBasic()
      'latest',
    ]);
    const tbHex = (totalsBasicRaw.result || '').slice(2);
    const fields: bigint[] = [];
    for (let i = 0; i < tbHex.length; i += 64) fields.push(BigInt('0x' + tbHex.slice(i, i + 64)));
    const [baseSupplyIndex, baseBorrowIndex, trackingSupplyIndex, trackingBorrowIndex, totalSupplyBase, totalBorrowBase, lastAccrualTime, pauseFlags] = fields;
    console.log(`    totalsBasic: borrowBase=${totalBorrowBase}, supplyBase=${totalSupplyBase}, lastAccrualTime=${lastAccrualTime}`);
    if (totalBorrowBase < exp(60, 6)) {
      const newTotals = {
        baseSupplyIndex: ethers.BigNumber.from(baseSupplyIndex),
        baseBorrowIndex: ethers.BigNumber.from(baseBorrowIndex),
        trackingSupplyIndex: ethers.BigNumber.from(trackingSupplyIndex),
        trackingBorrowIndex: ethers.BigNumber.from(trackingBorrowIndex),
        totalSupplyBase: ethers.BigNumber.from(totalSupplyBase),
        totalBorrowBase: exp(60, 6),
        lastAccrualTime: ethers.BigNumber.from(lastAccrualTime),
        pauseFlags: 0,
      };
      out.measurements.harnessSetTotalsBasic = await measureTxFull(
        'cometV2.setTotalsBasic({totalBorrowBase: 60e6, ...})',
        admin,
        () => cometV2.setTotalsBasic(newTotals, { gasLimit: 5_000_000 })
      );
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }
    const totalsCollNow = await cometV2.totalsCollateral(WJITOSOL);
    if (totalsCollNow.totalSupplyAsset.lt(exp(1, 9))) {
      out.measurements.harnessSetTotalsCollateral = await measureTxFull(
        'cometV2.setTotalsCollateral(jitoSOL, {totalSupplyAsset: 1e9, _reserved:0})',
        admin,
        () => cometV2.setTotalsCollateral(WJITOSOL, { totalSupplyAsset: exp(1, 9), _reserved: 0 }, { gasLimit: 5_000_000 })
      );
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    }

    // Read signer1's position to confirm setup
    let s1Borrow: ethers.BigNumber;
    let s1Coll: any;
    try {
      s1Borrow = await cometV2.borrowBalanceOf(signer1.address);
    } catch (e: any) {
      s1Borrow = ethers.BigNumber.from(0);
      console.log(`    borrowBalanceOf(signer1) reverted: ${e.message?.slice(0, 80)}`);
    }
    s1Coll = await cometV2.userCollateral(signer1.address, WJITOSOL);
    console.log(`    signer1 forged: borrow=${ethers.utils.formatUnits(s1Borrow,6)} USDC, coll=${ethers.utils.formatUnits(s1Coll.balance,9)} wjitoSOL`);

    // 2d. Drop jitoSOL price to push signer1 underwater
    // need: borrow > collateralValue × liquidateCollateralFactor (0.75)
    // 55 USDC > 1 jitoSOL × $50 × 0.75 = $37.5 → underwater at $50/SOL
    console.log('\n  -- Drop SOL price feed to $50 (push signer1 underwater) --');
    const newPrice = 5000000000n; // $50.00 with 8 decimals
    const now = Math.floor(Date.now() / 1000);
    await (await newSolFeed.connect(admin).setRoundData(2, newPrice, now, now, 2, { gasLimit: 2_000_000 })).wait();

    // Verify isLiquidatable
    let liq: boolean = false;
    try {
      liq = await cometV2.isLiquidatable(signer1.address);
    } catch (e: any) {
      console.log(`    isLiquidatable reverted: ${e.message?.slice(0, 80)}`);
    }
    console.log(`    isLiquidatable(signer1) = ${liq}`);
    out.notes.push(`signer1 liquidatable post-price-drop: ${liq}`);

    if (!liq) {
      console.log('  ⚠️  signer1 NOT liquidatable — skipping absorb measurement');
      out.measurements.absorb = { error: 'signer1 not liquidatable; price drop or principal forging insufficient' };
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    } else {
      // 2e. ABSORB
      console.log('\n  -- absorber=admin calls cometV2.absorb(admin, [signer1]) --');
      const absorbCalldata = cometV2.interface.encodeFunctionData('absorb', [admin.address, [signer1.address]]);
      const absorbEmu = await emulateTx(admin.address, cometV2Addr, absorbCalldata);
      console.log(`    rome_emulateTx CU: ${absorbEmu.cu ?? 'n/a'}, accts: ${absorbEmu.accountList ?? 'n/a'}, error: ${absorbEmu.error?.slice(0,80) ?? 'none'}`);
      const absorbMeas = await measureTxFull('cometV2.absorb(admin, [signer1])', admin, () =>
        cometV2.absorb(admin.address, [signer1.address], { gasLimit: 10_000_000 })
      );
      out.measurements.absorb = { ...absorbMeas, emulator: absorbEmu, semantic: '1 underwater account, 1 collateral asset to seize, harness-forged state' };
      fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

      // Read state after absorb
      try {
        const s1BorrowAfter = await cometV2.borrowBalanceOf(signer1.address);
        const s1CollAfter = await cometV2.userCollateral(signer1.address, WJITOSOL);
        const reservesAfter = await cometV2.getCollateralReserves(WJITOSOL);
        console.log(`    post-absorb signer1 borrow: ${ethers.utils.formatUnits(s1BorrowAfter, 6)} USDC, coll: ${ethers.utils.formatUnits(s1CollAfter.balance, 9)} wjitoSOL`);
        console.log(`    post-absorb reserves(jitoSOL): ${ethers.utils.formatUnits(reservesAfter, 9)} wjitoSOL`);
        out.notes.push(`post-absorb: signer1 borrow=${ethers.utils.formatUnits(s1BorrowAfter,6)}, signer1 coll=${ethers.utils.formatUnits(s1CollAfter.balance,9)}, reserves=${ethers.utils.formatUnits(reservesAfter,9)}`);
      } catch (e: any) {
        console.log(`    failed to read post-absorb state: ${e.message?.slice(0, 100)}`);
      }

      // 2f. (BONUS) buyCollateral — admin buys the seized jitoSOL at a discount
      console.log('\n  -- (bonus) admin.buyCollateral(jitoSOL, 0.05e9 min, 5 USDC, admin) --');
      // Approve cometV2 to pull USDC from admin for buyCollateral
      const adminCv2Allowance = await usdc.allowance(admin.address, cometV2Addr);
      if (adminCv2Allowance.eq(0)) {
        await (await usdc.connect(admin).approve(cometV2Addr, ethers.constants.MaxUint256, { gasLimit: 2_000_000 })).wait();
      }
      const buyCollCalldata = cometV2.interface.encodeFunctionData('buyCollateral', [WJITOSOL, exp(0.05, 9), exp(5, 6), admin.address]);
      const buyCollEmu = await emulateTx(admin.address, cometV2Addr, buyCollCalldata);
      console.log(`    rome_emulateTx CU: ${buyCollEmu.cu ?? 'n/a'}, error: ${buyCollEmu.error?.slice(0,80) ?? 'none'}`);
      const buyCollMeas = await measureTxFull('cometV2.buyCollateral(...)', admin, () =>
        cometV2.buyCollateral(WJITOSOL, exp(0.05, 9), exp(5, 6), admin.address, { gasLimit: 8_000_000 })
      );
      out.measurements.buyCollateral = { ...buyCollMeas, emulator: buyCollEmu, semantic: 'spot purchase from absorbed reserves' };
    }
  }

  console.log('\n=== Saving results ===');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('  →', outPath);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
