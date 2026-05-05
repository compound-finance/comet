// Phase 0 measurement-only run against pre-deployed contracts from run2.
//
// Bypasses the CometProxy / Configurator wiring (which fails emulator drift on
// CometFactory and on TransparentUpgradeableProxy.deploy) by using Comet impl
// directly. The impl is a fully working Compound v3 instance with immutables
// baked in at construction time.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// Run2 addresses
const USDC = '0x14D9359B6F72CbAa25c54fedd5846B26965716e4';
const WJITOSOL = '0x408724bD7A645761873a639dCB50C31FD3E371f4';
const USDC_FEED = '0xCD7bE9AC42dc73a4E618b8164820F8b3CF742714';
const COMET_IMPL = '0x4e81Db7fd317B61BcDd73eA9983A6B077b4a5A39'; // Comet impl with USDC base + jitoSOL collateral
const SOL_USD_FEED = '0x6FcE6648C0350e3f7dA0C0f432405df98dD0D12E';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';

const DAY = 86400;

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

interface Measurement {
  txHash?: string;
  evmGas?: string;
  blockNumber?: number;
  solanaTxs?: string[];
  computeUnits?: number[];
  accountCount?: number;
  txSize?: number;
  emulatorAccounts?: number;
  error?: string;
}

async function measureTx(label: string, sendFn: () => Promise<ethers.ContractTransaction>): Promise<Measurement> {
  console.log(`  [${label}]`);
  const m: Measurement = {};
  try {
    const tx = await sendFn();
    m.txHash = tx.hash;
    const receipt = await tx.wait();
    m.evmGas = receipt.gasUsed.toString();
    m.blockNumber = receipt.blockNumber;

    // Wait briefly for hercules to index, then ask for the Solana sigs
    await new Promise((r) => setTimeout(r, 4000));
    const solRes = await rawRpc(MARCUS_RPC, 'rome_solanaTxForEvmTx', [tx.hash]);
    m.solanaTxs = solRes.result || [];

    // Get CU per Solana sig
    const cus: number[] = [];
    let totalAccountCount = 0;
    let totalTxSize = 0;
    for (const sig of m.solanaTxs || []) {
      const txInfo = await rawRpc(SOLANA_RPC, 'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
      const info = txInfo?.result;
      if (info) {
        if (info.meta?.computeUnitsConsumed) cus.push(info.meta.computeUnitsConsumed);
        if (info.transaction?.message?.accountKeys) {
          totalAccountCount = Math.max(totalAccountCount, info.transaction.message.accountKeys.length);
        }
      }
    }
    m.computeUnits = cus;
    m.accountCount = totalAccountCount;

    console.log(`    txHash=${tx.hash}  evmGas=${m.evmGas}  solSigs=${m.solanaTxs.length}  CU=${cus.join(',')}  accts=${totalAccountCount}`);
  } catch (e: any) {
    m.error = e.message?.slice(0, 200);
    console.log(`    ERROR: ${m.error}`);
  }
  return m;
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log('Admin:', admin.address);
  console.log('Balance:', ethers.utils.formatEther(await admin.getBalance()), 'USDC');

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    addresses: { USDC, WJITOSOL, USDC_FEED, COMET_IMPL, SOL_USD_FEED },
    measurements: {},
    notes: [
      'Comet was deployed but CometProxy + CometFactory failed deterministic emulator drift (mollusk Custom(1)).',
      'Measurements run directly against the Comet impl bytecode (immutables-frozen instance — same opcodes for runtime ops).',
    ],
  };
  const outPath = path.join(__dirname, 'phase0-measurements.json');

  // Get Comet handle bound to impl
  const comet = await ethers.getContractAt('contracts/Comet.sol:Comet', COMET_IMPL);
  const usdc = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', USDC);
  const wjitoSol = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', WJITOSOL);

  // Sanity: read static state from impl
  console.log('\nReading impl state...');
  try {
    const baseToken = await comet.baseToken();
    const numAssets = await comet.numAssets();
    console.log('  baseToken:', baseToken, '(expected:', USDC, ')');
    console.log('  numAssets:', numAssets.toString());
  } catch (e: any) {
    console.log('  impl read failed:', e.message);
  }

  // 0. Initialize storage on the impl (one-time)
  console.log('\nInitializing storage on impl...');
  try {
    const initTx = await comet.initializeStorage({ gasLimit: 5_000_000 });
    const r = await initTx.wait();
    console.log('  initializeStorage gas:', r.gasUsed.toString());
    out.measurements.initializeStorage = { evmGas: r.gasUsed.toString(), txHash: initTx.hash };
  } catch (e: any) {
    console.log('  init skipped or already done:', e.message?.slice(0, 100));
    out.measurements.initializeStorage = { note: 'already initialized or failed', error: e.message?.slice(0, 200) };
  }

  // 1. USDC approve
  out.measurements.usdcApprove = await measureTx('usdc.approve(comet, max)', () =>
    usdc.approve(comet.address, ethers.constants.MaxUint256, { gasLimit: 2_000_000 })
  );

  // 2. jitoSOL approve
  out.measurements.jitoApprove = await measureTx('wjitoSol.approve(comet, max)', () =>
    wjitoSol.approve(comet.address, ethers.constants.MaxUint256, { gasLimit: 2_000_000 })
  );

  // 3. supply small (10 USDC)
  out.measurements.supplySmall = await measureTx('comet.supply(USDC, 10e6)', () =>
    comet.supply(USDC, exp(10, 6), { gasLimit: 5_000_000 })
  );

  // 4. supply large (1000 USDC)
  out.measurements.supplyLarge = await measureTx('comet.supply(USDC, 1000e6)', () =>
    comet.supply(USDC, exp(1000, 6), { gasLimit: 5_000_000 })
  );

  // 5. supply collateral
  out.measurements.supplyCollateral = await measureTx('comet.supply(jitoSOL, 10e9)', () =>
    comet.supply(WJITOSOL, exp(10, 9), { gasLimit: 10_000_000 })
  );

  // 6. withdraw small
  out.measurements.withdrawSmall = await measureTx('comet.withdraw(USDC, 5e6)', () =>
    comet.withdraw(USDC, exp(5, 6), { gasLimit: 5_000_000 })
  );

  // 7. withdraw large
  out.measurements.withdrawLarge = await measureTx('comet.withdraw(USDC, 500e6)', () =>
    comet.withdraw(USDC, exp(500, 6), { gasLimit: 5_000_000 })
  );

  // 8. borrow small (withdraw past supply)
  out.measurements.borrowSmall = await measureTx('comet.withdraw(USDC, 600e6) — partial borrow', () =>
    comet.withdraw(USDC, exp(600, 6), { gasLimit: 6_000_000 })
  );

  // 9. borrow large
  out.measurements.borrowLarge = await measureTx('comet.withdraw(USDC, 1000e6) — pure borrow', () =>
    comet.withdraw(USDC, exp(1000, 6), { gasLimit: 8_000_000 })
  );

  // 10. repay
  out.measurements.repay = await measureTx('comet.supply(USDC, 50e6) — repay', () =>
    comet.supply(USDC, exp(50, 6), { gasLimit: 5_000_000 })
  );

  // 11. absorb on healthy account (will revert; capture estimate-time data)
  out.measurements.absorbHealthyRevert = await measureTx('comet.absorb(admin, [admin]) — healthy revert', () =>
    comet.absorb(admin.address, [admin.address], { gasLimit: 5_000_000 })
  );

  // 12. Measure a baseline ERC20 transfer for context
  out.measurements.usdcTransferBaseline = await measureTx('usdc.transfer(comet, 1e6)', () =>
    usdc.transfer(comet.address, exp(1, 6), { gasLimit: 3_000_000 })
  );

  console.log('\nSaving results...');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('  →', outPath);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
