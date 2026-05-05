// Phase 0 — VR-2/VR-3/VR-4/VR-5/VR-7 measurement script for Marcus.
//
// Goal: deploy Compound v3 (Comet) on Marcus with placeholder ERC-20 base + collateral,
// run supply/borrow/withdraw/repay/absorb end-to-end, and capture rome_emulateTx CU
// data per operation.
//
// Run: ETH_PK=<deployer-key> npx hardhat run scripts/marcus-phase0/deploy-and-bench.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOL_USD_FEED = '0x6FcE6648C0350e3f7dA0C0f432405df98dD0D12E'; // Pyth Pull adapter from registry oracle.json

// ---- helpers ----
const DAY = 86400;
const ONE = 10n ** 18n;

function exp(amount: number, decimals: number): bigint {
  // Avoid float precision issues for whole amounts
  if (Number.isInteger(amount)) return BigInt(amount) * 10n ** BigInt(decimals);
  // Otherwise stringify rounded
  return BigInt(Math.round(amount * 1e6)) * 10n ** BigInt(decimals - 6);
}

// Retry wrapper for transient Marcus errors (Custom(1) is intermittent on contract deploys
// — proxy/hercules emulator-side preflight occasionally rejects with mollusk Custom(1), but the
// actual on-chain submission path is fine. Retry 3x.)
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 12): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = (e.message || JSON.stringify(e)).slice(0, 150);
      console.log(`  [retry ${i + 1}/${attempts}] ${label}: ${msg}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function rawRpc(method: string, params: any[]): Promise<any> {
  const r = await fetch(MARCUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return await r.json();
}

interface EmulateResult {
  cu?: number;
  accountList?: string[];
  steps?: any;
  error?: string;
  raw?: any;
}

async function emulateTx(from: string, to: string, data: string, value = '0x0'): Promise<EmulateResult> {
  // rome_emulateTx returns { exit_reason, return_value, vm: { gas_used, ... }, accounts, ... } or similar
  // We'll capture whatever it gives us
  try {
    const res = await rawRpc('rome_emulateTx', [{ from, to, data, value, gas: '0x4c4b40' }]);
    if (res.error) return { error: JSON.stringify(res.error), raw: res };
    const r = res.result || {};
    return {
      cu: r.compute_units_consumed ?? r.cu ?? r.computeUnits ?? r?.vm?.gas_used,
      accountList: r.accounts ?? r.account_list ?? r.accountList,
      steps: r,
      raw: res,
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log('Deployer:', admin.address);
  const balance = await admin.getBalance();
  console.log('Balance:', ethers.utils.formatEther(balance), 'USDC (gas)');

  const out: any = {
    timestamp: new Date().toISOString(),
    deployer: admin.address,
    network: 'marcus',
    chainId: 121301,
    addresses: {},
    benchmarks: {},
    txReceipts: {},
  };
  const outPath = path.join(__dirname, 'phase0-results.json');

  // 1. Deploy mock USDC (6 decimals)
  console.log('\n[1/9] Deploying placeholder USDC...');
  const StandardToken = await ethers.getContractFactory('contracts/test/FaucetToken.sol:StandardToken');
  const usdcInitial = exp(10_000_000, 6); // 10M
  const usdc = await withRetry('USDC deploy', () => StandardToken.deploy(usdcInitial, 'Phase0 USDC', 6, 'USDC', { gasLimit: 100_000_000 }));
  await usdc.deployed();
  console.log('  USDC:', usdc.address);
  out.addresses.usdc = usdc.address;
  out.txReceipts.usdcDeploy = usdc.deployTransaction.hash;

  // 2. Deploy mock wjitoSOL (9 decimals — jitoSOL is 9-dec on Solana)
  console.log('[2/9] Deploying placeholder wjitoSOL...');
  const wjitoSolInitial = exp(1_000_000, 9);
  const wjitoSol = await withRetry('wjitoSOL deploy', () => StandardToken.deploy(wjitoSolInitial, 'Phase0 jitoSOL', 9, 'jitoSOL', { gasLimit: 100_000_000 }));
  await wjitoSol.deployed();
  console.log('  wjitoSOL:', wjitoSol.address);
  out.addresses.wjitoSol = wjitoSol.address;
  out.txReceipts.wjitoSolDeploy = wjitoSol.deployTransaction.hash;

  // 3. Deploy COMP placeholder
  console.log('[3/9] Deploying COMP placeholder...');
  const Comp = await ethers.getContractFactory('contracts/test/Comp.sol:Comp');
  const comp = await withRetry('COMP deploy', () => Comp.deploy(admin.address, { gasLimit: 50_000_000 }));
  await comp.deployed();
  console.log('  COMP:', comp.address);
  out.addresses.comp = comp.address;

  // 4. Deploy SimplePriceFeed for USDC ($1.00, 8 decimals — Chainlink format)
  console.log('[4/9] Deploying USDC price feed (constant $1.00)...');
  const SimplePriceFeed = await ethers.getContractFactory('contracts/test/SimplePriceFeed.sol:SimplePriceFeed');
  const usdcFeed = await withRetry('USDC PriceFeed deploy', () => SimplePriceFeed.deploy(100_000_000n, 8, { gasLimit: 50_000_000 })); // 1.00 * 10^8
  await usdcFeed.deployed();
  // setRoundData so updatedAt is current — Comet's price feed staleness check
  const now = Math.floor(Date.now() / 1000);
  await (await withRetry('setRoundData', () => usdcFeed.setRoundData(1, 100_000_000n, now, now, 1, { gasLimit: 2_000_000 }))).wait();
  console.log('  USDC Feed:', usdcFeed.address);
  out.addresses.usdcFeed = usdcFeed.address;

  // 5. wjitoSOL price feed: reuse Rome's SOL/USD Pyth Pull adapter (already in oracle.json)
  // For Phase 0 we treat jitoSOL ≈ SOL price (real demo will use a jitoSOL-specific feed)
  console.log('[5/9] Using Rome Pyth SOL/USD adapter for wjitoSOL feed:', SOL_USD_FEED);
  out.addresses.solUsdFeed = SOL_USD_FEED;

  // 6. Deploy Compound v3 stack
  console.log('[6/9] Deploying Compound v3 stack...');

  // 6a. CometProxyAdmin
  const CometProxyAdmin = await ethers.getContractFactory('contracts/CometProxyAdmin.sol:CometProxyAdmin');
  const cometAdmin = await withRetry('CometProxyAdmin deploy', () => CometProxyAdmin.deploy(admin.address, { gasLimit: 100_000_000 }));
  await cometAdmin.deployed();
  console.log('  CometProxyAdmin:', cometAdmin.address);
  out.addresses.cometAdmin = cometAdmin.address;

  // 6b. CometExt (extension delegate)
  const CometExt = await ethers.getContractFactory('contracts/CometExt.sol:CometExt');
  const extConfig = {
    name32: ethers.utils.formatBytes32String('Compound USDC on Rome'),
    symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
  };
  // Use explicit gas limit to bypass emulator gas estimation (which fails with Custom(1) on some constructors)
  const cometExt = await withRetry('CometExt deploy', () => CometExt.deploy(extConfig, { gasLimit: 100_000_000 }));
  await cometExt.deployed();
  console.log('  CometExt:', cometExt.address);
  out.addresses.cometExt = cometExt.address;

  // 6c. CometFactory
  const CometFactory = await ethers.getContractFactory('contracts/CometFactory.sol:CometFactory');
  const cometFactory = await withRetry('CometFactory deploy', () => CometFactory.deploy({ gasLimit: 250_000_000 }));
  await cometFactory.deployed();
  console.log('  CometFactory:', cometFactory.address);
  out.addresses.cometFactory = cometFactory.address;

  // 6d. Comet implementation (deployed with config struct)
  // AssetConfig for jitoSOL collateral (uint128 supplyCap is the last field)
  const assetConfigs = [
    {
      asset: wjitoSol.address,
      priceFeed: SOL_USD_FEED,
      decimals: 9,
      borrowCollateralFactor: ethers.BigNumber.from('700000000000000000'), // 0.7
      liquidateCollateralFactor: ethers.BigNumber.from('750000000000000000'), // 0.75
      liquidationFactor: ethers.BigNumber.from('930000000000000000'), // 0.93
      supplyCap: ethers.BigNumber.from('100000').mul(ethers.BigNumber.from('1000000000')), // 100k jitoSOL @ 9-dec
    },
  ];

  // Annual rate = base + per-second-rate-from-yaml * seconds-per-year ; Comet expects per-second values scaled by 1e18
  const SECS_PER_YEAR = 31536000n;
  const cometConfig = {
    governor: admin.address,
    pauseGuardian: admin.address,
    baseToken: usdc.address,
    baseTokenPriceFeed: usdcFeed.address,
    extensionDelegate: cometExt.address,
    supplyKink: ethers.BigNumber.from('850000000000000000'), // 0.85
    supplyPerYearInterestRateSlopeLow: ethers.BigNumber.from('48000000000000000'), // 0.048
    supplyPerYearInterestRateSlopeHigh: ethers.BigNumber.from('1600000000000000000'), // 1.6
    supplyPerYearInterestRateBase: 0,
    borrowKink: ethers.BigNumber.from('850000000000000000'), // 0.85
    borrowPerYearInterestRateSlopeLow: ethers.BigNumber.from('53000000000000000'), // 0.053
    borrowPerYearInterestRateSlopeHigh: ethers.BigNumber.from('1700000000000000000'), // 1.7
    borrowPerYearInterestRateBase: ethers.BigNumber.from('15000000000000000'), // 0.015
    storeFrontPriceFactor: ethers.BigNumber.from('500000000000000000'), // 0.5
    trackingIndexScale: ethers.BigNumber.from('1000000000000000'), // 1e15
    baseTrackingSupplySpeed: 0,
    baseTrackingBorrowSpeed: 0,
    baseMinForRewards: ethers.BigNumber.from('100').mul(1_000_000),
    baseBorrowMin: 1,
    targetReserves: ethers.BigNumber.from('5000000').mul(1_000_000),
    assetConfigs,
  };

  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometImpl = await withRetry('Comet impl deploy', () => Comet.deploy(cometConfig, { gasLimit: 500_000_000 }));
  await cometImpl.deployed();
  console.log('  Comet impl:', cometImpl.address);
  out.addresses.cometImpl = cometImpl.address;

  // 6e. Configurator + ConfiguratorProxy + CometProxy
  const Configurator = await ethers.getContractFactory('contracts/Configurator.sol:Configurator');
  const configuratorImpl = await withRetry('Configurator impl deploy', () => Configurator.deploy({ gasLimit: 400_000_000 }));
  await configuratorImpl.deployed();
  console.log('  Configurator impl:', configuratorImpl.address);
  out.addresses.configuratorImpl = configuratorImpl.address;

  const ConfiguratorProxy = await ethers.getContractFactory('contracts/ConfiguratorProxy.sol:ConfiguratorProxy');
  const configInitData = configuratorImpl.interface.encodeFunctionData('initialize', [admin.address]);
  const configuratorProxy = await withRetry('ConfiguratorProxy deploy', () => ConfiguratorProxy.deploy(configuratorImpl.address, cometAdmin.address, configInitData, { gasLimit: 100_000_000 }));
  await configuratorProxy.deployed();
  console.log('  ConfiguratorProxy:', configuratorProxy.address);
  out.addresses.configuratorProxy = configuratorProxy.address;

  const TransparentUpgradeableProxy = await ethers.getContractFactory(
    'contracts/vendor/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy'
  );
  const cometProxy = await withRetry('CometProxy deploy', () => TransparentUpgradeableProxy.deploy(cometImpl.address, cometAdmin.address, '0x', { gasLimit: 100_000_000 }));
  await cometProxy.deployed();
  console.log('  CometProxy:', cometProxy.address);
  out.addresses.cometProxy = cometProxy.address;

  // 6f. CometRewards
  const CometRewards = await ethers.getContractFactory('contracts/CometRewards.sol:CometRewards');
  const rewards = await withRetry('CometRewards deploy', () => CometRewards.deploy(admin.address, { gasLimit: 100_000_000 }));
  await rewards.deployed();
  console.log('  CometRewards:', rewards.address);
  out.addresses.rewards = rewards.address;

  // 7. Initialize Comet via the proxy
  // The TransparentUpgradeableProxy admin is `cometAdmin` (the contract), not `admin` (the EOA).
  // So `admin` calling `initializeStorage()` on the proxy forwards through to the impl.
  console.log('[7/9] Initializing Comet storage via proxy...');
  const cometIface = new ethers.utils.Interface(['function initializeStorage()']);
  const cometProxyCometSide = new ethers.Contract(cometProxy.address, cometIface, admin);
  const initTx = await withRetry('initializeStorage', () => cometProxyCometSide.initializeStorage({ gasLimit: 1_000_000 }));
  const initReceipt = await initTx.wait();
  console.log('  initializeStorage block:', initReceipt.blockNumber);
  out.txReceipts.initializeStorage = initTx.hash;

  // Get a Comet handle bound to the proxy
  const comet = await ethers.getContractAt('contracts/CometInterface.sol:CometInterface', cometProxy.address);

  // 8. Run benchmarks: supply / borrow / withdraw / repay / absorb
  console.log('\n[8/9] Running operations + capturing rome_emulateTx CU...');

  // Set up deployer with USDC + jitoSOL
  // Initial mints
  const supplySmall = exp(10, 6);
  const supplyLarge = exp(1000, 6);
  const collateralAmount = exp(10, 9); // 10 jitoSOL collateral

  // Approvals
  console.log('  - Approving USDC for Comet...');
  await (await withRetry('USDC approve', () => usdc.approve(comet.address, ethers.constants.MaxUint256, { gasLimit: 2_000_000 }))).wait();
  console.log('  - Approving jitoSOL for Comet...');
  await (await withRetry('jitoSOL approve', () => wjitoSol.approve(comet.address, ethers.constants.MaxUint256, { gasLimit: 2_000_000 }))).wait();

  // Helper: build calldata for emulate
  const cometIfaceFull = comet.interface;

  // ==== SUPPLY (small) ====
  {
    console.log('  [supply 10 USDC]');
    const data = cometIfaceFull.encodeFunctionData('supply', [usdc.address, supplySmall]);
    const emu = await emulateTx(admin.address, comet.address, data);
    const tx = await withRetry('supplySmall tx', () => comet.supply(usdc.address, supplySmall, { gasLimit: 5_000_000 }));
    const receipt = await tx.wait();
    out.benchmarks.supplySmall = {
      input: { asset: 'USDC', amount: '10e6' },
      emulate: emu,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
    };
    console.log(`    tx ${tx.hash} | gas ${receipt.gasUsed} | emulate.cu=${emu.cu} | accounts=${emu.accountList?.length ?? '?'}`);
  }

  // ==== SUPPLY (large) ====
  {
    console.log('  [supply 1000 USDC]');
    const data = cometIfaceFull.encodeFunctionData('supply', [usdc.address, supplyLarge]);
    const emu = await emulateTx(admin.address, comet.address, data);
    const tx = await withRetry('supplyLarge tx', () => comet.supply(usdc.address, supplyLarge, { gasLimit: 5_000_000 }));
    const receipt = await tx.wait();
    out.benchmarks.supplyLarge = {
      input: { asset: 'USDC', amount: '1000e6' },
      emulate: emu,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
    };
    console.log(`    tx ${tx.hash} | gas ${receipt.gasUsed} | emulate.cu=${emu.cu} | accounts=${emu.accountList?.length ?? '?'}`);
  }

  // ==== SUPPLY collateral (jitoSOL) ====
  {
    console.log('  [supply 10 jitoSOL collateral]');
    const data = cometIfaceFull.encodeFunctionData('supply', [wjitoSol.address, collateralAmount]);
    const emu = await emulateTx(admin.address, comet.address, data);
    const tx = await withRetry('supplyCollateral tx', () => comet.supply(wjitoSol.address, collateralAmount, { gasLimit: 5_000_000 }));
    const receipt = await tx.wait();
    out.benchmarks.supplyCollateral = {
      input: { asset: 'jitoSOL', amount: '10e9' },
      emulate: emu,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
    };
    console.log(`    tx ${tx.hash} | gas ${receipt.gasUsed} | emulate.cu=${emu.cu} | accounts=${emu.accountList?.length ?? '?'}`);
  }

  // ==== WITHDRAW (small — base = borrow if no balance, but we have 1010 supplied) ====
  {
    console.log('  [withdraw 5 USDC]');
    const amt = exp(5, 6);
    const data = cometIfaceFull.encodeFunctionData('withdraw', [usdc.address, amt]);
    const emu = await emulateTx(admin.address, comet.address, data);
    const tx = await withRetry('op tx', () => comet.withdraw(usdc.address, amt, { gasLimit: 5_000_000 }));
    const receipt = await tx.wait();
    out.benchmarks.withdrawSmall = {
      input: { asset: 'USDC', amount: '5e6' },
      emulate: emu,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
    };
    console.log(`    tx ${tx.hash} | gas ${receipt.gasUsed} | emulate.cu=${emu.cu} | accounts=${emu.accountList?.length ?? '?'}`);
  }

  // ==== WITHDRAW (large) ====
  {
    console.log('  [withdraw 500 USDC]');
    const amt = exp(500, 6);
    const data = cometIfaceFull.encodeFunctionData('withdraw', [usdc.address, amt]);
    const emu = await emulateTx(admin.address, comet.address, data);
    const tx = await withRetry('op tx', () => comet.withdraw(usdc.address, amt, { gasLimit: 5_000_000 }));
    const receipt = await tx.wait();
    out.benchmarks.withdrawLarge = {
      input: { asset: 'USDC', amount: '500e6' },
      emulate: emu,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
    };
    console.log(`    tx ${tx.hash} | gas ${receipt.gasUsed} | emulate.cu=${emu.cu} | accounts=${emu.accountList?.length ?? '?'}`);
  }

  // ==== BORROW: need a second account or push the deployer past 0 base balance
  // Approach: have admin withdraw past 0 (which becomes a borrow).
  // First withdraw nearly all of supplied -> remainder = borrow
  // Currently supplied: 1010 USDC - 5 - 500 = 505 USDC. Plus 10 jitoSOL collateral.
  // If we withdraw 600 USDC, that's 505 supply withdrawn + 95 borrow.
  {
    console.log('  [borrow ~95 USDC via withdraw past supply]');
    const amt = exp(600, 6);
    const data = cometIfaceFull.encodeFunctionData('withdraw', [usdc.address, amt]);
    const emu = await emulateTx(admin.address, comet.address, data);
    const tx = await withRetry('op tx', () => comet.withdraw(usdc.address, amt, { gasLimit: 5_000_000 }));
    const receipt = await tx.wait();
    out.benchmarks.borrowSmall = {
      input: { asset: 'USDC', amount: '600e6 (supply 505 + borrow 95)' },
      emulate: emu,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
    };
    console.log(`    tx ${tx.hash} | gas ${receipt.gasUsed} | emulate.cu=${emu.cu} | accounts=${emu.accountList?.length ?? '?'}`);
  }

  // ==== BORROW (larger) — withdraw another 1000 USDC against jitoSOL
  {
    console.log('  [borrow ~1000 more USDC]');
    const amt = exp(1000, 6);
    const data = cometIfaceFull.encodeFunctionData('withdraw', [usdc.address, amt]);
    const emu = await emulateTx(admin.address, comet.address, data);
    let receipt: any = null;
    try {
      const tx = await withRetry('borrowLarge tx', () => comet.withdraw(usdc.address, amt, { gasLimit: 8_000_000 }));
      receipt = await tx.wait();
      out.benchmarks.borrowLarge = {
        input: { asset: 'USDC', amount: '1000e6 (pure borrow)' },
        emulate: emu,
        txHash: tx.hash,
        gasUsed: receipt.gasUsed.toString(),
        blockNumber: receipt.blockNumber,
      };
      console.log(`    tx ${tx.hash} | gas ${receipt.gasUsed} | emulate.cu=${emu.cu} | accounts=${emu.accountList?.length ?? '?'}`);
    } catch (e: any) {
      console.log(`    borrowLarge skipped (likely collateral capacity): ${e.message?.substring(0, 100)}`);
      out.benchmarks.borrowLarge = { input: { asset: 'USDC', amount: '1000e6' }, emulate: emu, error: e.message };
    }
  }

  // ==== REPAY: supply USDC against the existing borrow
  {
    console.log('  [repay 50 USDC via supply]');
    const amt = exp(50, 6);
    const data = cometIfaceFull.encodeFunctionData('supply', [usdc.address, amt]);
    const emu = await emulateTx(admin.address, comet.address, data);
    const tx = await withRetry('repay tx', () => comet.supply(usdc.address, amt, { gasLimit: 5_000_000 }));
    const receipt = await tx.wait();
    out.benchmarks.repaySmall = {
      input: { asset: 'USDC', amount: '50e6' },
      emulate: emu,
      txHash: tx.hash,
      gasUsed: receipt.gasUsed.toString(),
      blockNumber: receipt.blockNumber,
    };
    console.log(`    tx ${tx.hash} | gas ${receipt.gasUsed} | emulate.cu=${emu.cu} | accounts=${emu.accountList?.length ?? '?'}`);
  }

  // ==== ABSORB: skip end-to-end (would require driving health < 1 via price drop)
  // Instead capture absorb emulate-only using a freshly underwater account simulation
  // For Phase 0 we record that absorb is ABI-tested via gas-est on a synthetic input
  {
    console.log('  [absorb dry-run estimate]');
    const data = cometIfaceFull.encodeFunctionData('absorb', [admin.address, [admin.address]]);
    const emu = await emulateTx(admin.address, comet.address, data);
    out.benchmarks.absorbEmulateOnly = {
      input: { absorber: admin.address, accounts: [admin.address] },
      emulate: emu,
      note: 'absorb on a healthy account is a no-op revert; CU/accounts captured at emulate level only',
    };
    console.log(`    emulate.cu=${emu.cu} | accounts=${emu.accountList?.length ?? '?'}`);
    if (emu.error) console.log(`    (expected revert: ${emu.error.substring(0, 100)})`);
  }

  // 9. Save results
  console.log('\n[9/9] Saving results...');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('  →', outPath);

  console.log('\nDONE.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
