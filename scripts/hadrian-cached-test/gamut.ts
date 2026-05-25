// Stress gamut for cached-base Compound v3 (Comet) on Hadrian.
//
// Validates that canonical Compound composes with SPL_ERC20_cached wrappers
// the same way Uniswap V2/V3 + Aave V3 do. Mirrors the rome-aave-v3 gamut
// structure: per-action Solana metrics (iter sigs, CU, max heap, slot span)
// captured via rome_solanaTxForEvmTx + Rome's Cherry follower.
//
// Coverage:
//   1. wETH.approve(comet, max), wUSDC.approve(comet, max)
//   2. comet.supply(wETH, X) — collateral side
//   3. comet.supply(wUSDC, Y) — base side, lender liquidity
//   4. comet.withdraw(wUSDC, Z) — borrow against the wETH collateral
//      (in Compound v3, withdrawing the base asset when balance is negative
//      effectively means borrowing — no separate `borrow` function)
//   5. comet.supply(wUSDC, Z) — repay the borrow
//   6. comet.withdraw(wETH, max) — withdraw collateral
//
// Run:
//   ETH_PK=<key> ETHERSCAN_KEY=stub SNOWTRACE_KEY=stub MAINNET_QUICKNODE_LINK=stub UNICHAIN_QUICKNODE_LINK=stub LINEA_QUICKNODE_LINK=stub \
//     npx hardhat run scripts/hadrian-cached-test/gamut.ts --network hadrian

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// keccak256('ensure_token_account(address)')[0:4] — used in cached-wrapper
// probe paths below if/when added. Kept as documentation reference.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ENSURE_TOKEN_ACCOUNT_SELECTOR = '0x5e094743';

const ROME_RPC = 'https://hadrian.testnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';

type Metric = {
  name: string;
  wallMs: number;
  txHash?: string;
  iterSigs?: number;
  totalCU?: number;
  maxHeap?: number;
  slotSpan?: number;
};

async function rpc(url: string, method: string, params: any[]): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const json: any = await r.json();
  return json.result;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getSolanaTxWithRetry(sig: string): Promise<any> {
  for (const delay of [0, 1000, 2000, 3000, 5000]) {
    if (delay > 0) await sleep(delay);
    const tx: any = await rpc(SOLANA_RPC, 'getTransaction', [
      sig,
      { maxSupportedTransactionVersion: 0, encoding: 'json' },
    ]);
    if (tx) return tx;
  }
  return null;
}

async function captureTxMetrics(txHash: string): Promise<Partial<Metric>> {
  try {
    const sigs: string[] = (await rpc(ROME_RPC, 'rome_solanaTxForEvmTx', [txHash])) ?? [];
    let totalCU = 0;
    let maxHeap = 0;
    let missing = 0;
    const slots: number[] = [];
    for (const sig of sigs) {
      const tx = await getSolanaTxWithRetry(sig);
      if (!tx) {
        missing += 1;
        continue;
      }
      slots.push(tx.slot);
      totalCU += tx.meta?.computeUnitsConsumed ?? 0;
      for (const l of (tx.meta?.logMessages ?? []) as string[]) {
        const m = l.match(/Program log: Heap (\d+)/);
        if (m) maxHeap = Math.max(maxHeap, parseInt(m[1], 10));
      }
    }
    return {
      txHash,
      iterSigs: sigs.length,
      totalCU: missing === sigs.length ? undefined : totalCU,
      maxHeap: missing === sigs.length ? undefined : maxHeap,
      slotSpan: slots.length > 0 ? Math.max(...slots) - Math.min(...slots) : 0,
    };
  } catch {
    return { txHash };
  }
}

async function main() {
  const [signer] = await ethers.getSigners();
  const stateFile = path.join('scripts', 'hadrian-cached-test', 'state.json');
  if (!fs.existsSync(stateFile)) {
    throw new Error(`No state.json — run \`hardhat run scripts/hadrian-cached-test/deploy.ts --network hadrian\` first.`);
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

  const COMET = state.cometProxy;
  const BASE = state.baseAsset; // wUSDC
  const COLL = state.collateralAssets[0]; // wETH

  console.log(`Signer:   ${signer.address}`);
  console.log(`Comet:    ${COMET}`);
  console.log(`Base:     ${BASE.symbol} @ ${BASE.address}`);
  console.log(`Collat:   ${COLL.symbol} @ ${COLL.address}`);

  const MaxUint256 = ethers.constants.MaxUint256;
  // Sized for 8-decimal wETH at $3000 and 6-decimal wUSDC at $1, 70% LTV
  const COLL_SUPPLY = ethers.BigNumber.from('100');   // 100 raw wETH = 1e-6 wETH = $0.003
  const BASE_LEND   = ethers.BigNumber.from('5000'); // 5000 raw wUSDC = $0.005
  const BASE_BORROW = ethers.BigNumber.from('1000'); // 1000 raw wUSDC = $0.001 (within ~$0.0021 max)

  const ERC20_ABI = [
    'function balanceOf(address) view returns (uint256)',
    'function approve(address,uint256) returns (bool)',
    'function allowance(address,address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)',
    'function decimals() view returns (uint8)',
  ];
  const cometAbi = [
    'function supply(address asset, uint256 amount)',
    'function withdraw(address asset, uint256 amount)',
    'function balanceOf(address account) view returns (uint256)',
    'function borrowBalanceOf(address account) view returns (uint256)',
    'function collateralBalanceOf(address account, address asset) view returns (uint128)',
    'function userBasic(address account) view returns (int104 principal, uint64 baseTrackingIndex, uint64 baseTrackingAccrued, uint16 assetsIn, uint8 _reserved)',
  ];
  const comet = new ethers.Contract(COMET, cometAbi, signer);
  const baseToken = new ethers.Contract(BASE.address, ERC20_ABI, signer);
  const collToken = new ethers.Contract(COLL.address, ERC20_ABI, signer);

  const passed: string[] = [];
  const failed: string[] = [];
  const metrics: Metric[] = [];

  async function step(name: string, fn: () => Promise<string | void>) {
    process.stdout.write(`  ${name} ... `);
    const start = Date.now();
    try {
      const maybeHash = await fn();
      const wallMs = Date.now() - start;
      const m: Metric = { name, wallMs };
      if (typeof maybeHash === 'string' && maybeHash.length === 66) {
        Object.assign(m, await captureTxMetrics(maybeHash));
      }
      metrics.push(m);
      const detail = m.iterSigs !== undefined
        ? `sigs=${m.iterSigs} CU=${m.totalCU?.toLocaleString()} heap=${m.maxHeap?.toLocaleString()} span=${m.slotSpan}`
        : '';
      console.log(`PASS (${wallMs}ms) ${detail}`);
      passed.push(`${name} (${wallMs}ms)`);
    } catch (e) {
      const wallMs = Date.now() - start;
      metrics.push({ name, wallMs });
      console.log(`FAIL (${wallMs}ms): ${(e as Error).message}`);
      failed.push(`${name}: ${(e as Error).message}`);
    }
  }

  console.log(`\n--- Pre-flight: balances ---`);
  const wUSDCBal = await baseToken.balanceOf(signer.address);
  const wETHBal = await collToken.balanceOf(signer.address);
  console.log(`  ${BASE.symbol}: ${wUSDCBal}`);
  console.log(`  ${COLL.symbol}: ${wETHBal}`);

  console.log(`\n--- Phase 1: approve Comet ---`);
  await step(`${COLL.symbol}.approve(comet, max)`, async () => {
    const tx = await collToken.approve(COMET, MaxUint256);
    await tx.wait();
    return tx.hash;
  });
  await step(`${BASE.symbol}.approve(comet, max)`, async () => {
    const tx = await baseToken.approve(COMET, MaxUint256);
    await tx.wait();
    return tx.hash;
  });

  console.log(`\n--- Phase 2: supply collateral (cached wETH) ---`);
  await step(`comet.supply(${COLL.symbol}, ${COLL_SUPPLY})`, async () => {
    const tx = await comet.supply(COLL.address, COLL_SUPPLY);
    await tx.wait();
    return tx.hash;
  });
  const collInComet = await comet.collateralBalanceOf(signer.address, COLL.address);
  console.log(`    collateral in Comet: ${collInComet}`);

  console.log(`\n--- Phase 3: supply base liquidity (cached wUSDC, lender) ---`);
  await step(`comet.supply(${BASE.symbol}, ${BASE_LEND})`, async () => {
    const tx = await comet.supply(BASE.address, BASE_LEND);
    await tx.wait();
    return tx.hash;
  });
  const baseInComet = await comet.balanceOf(signer.address);
  console.log(`    cBase balance: ${baseInComet}`);

  console.log(`\n--- Phase 4: withdraw base (= borrow against wETH collateral) ---`);
  // In Comet, withdrawing the BASE asset when your positive balance is exceeded
  // takes you into negative territory which is the borrow. Compound v3 uses
  // a single signed `principal` to track both supply and borrow.
  // Need to make sure we have enough lender-side liquidity in the Comet — we
  // just supplied 5000 raw wUSDC, of which we're "borrowing" 1000 raw.
  await step(`comet.withdraw(${BASE.symbol}, ${BASE_BORROW}) [borrow]`, async () => {
    const tx = await comet.withdraw(BASE.address, BASE_BORROW);
    await tx.wait();
    return tx.hash;
  });
  const borrowBal = await comet.borrowBalanceOf(signer.address);
  console.log(`    borrowBalance: ${borrowBal}`);

  console.log(`\n--- Phase 5: repay (supply back the borrowed base) ---`);
  await step(`comet.supply(${BASE.symbol}, ${BASE_BORROW} + dust) [repay]`, async () => {
    // Supply enough to clear the borrow + any tiny interest accrual
    const tx = await comet.supply(BASE.address, BASE_BORROW.add(10));
    await tx.wait();
    return tx.hash;
  });
  const borrowAfter = await comet.borrowBalanceOf(signer.address);
  const baseAfter = await comet.balanceOf(signer.address);
  console.log(`    borrowBalance after: ${borrowAfter}`);
  console.log(`    cBase balance after: ${baseAfter}`);

  console.log(`\n--- Phase 6: withdraw collateral (cached wETH) ---`);
  await step(`comet.withdraw(${COLL.symbol}, ${COLL_SUPPLY})`, async () => {
    const tx = await comet.withdraw(COLL.address, COLL_SUPPLY);
    await tx.wait();
    return tx.hash;
  });
  const collAfter = await comet.collateralBalanceOf(signer.address, COLL.address);
  console.log(`    collateral in Comet after: ${collAfter}`);

  console.log(`\n--- Phase 7: withdraw remaining base (close out lender position) ---`);
  await step(`comet.withdraw(${BASE.symbol}, max)`, async () => {
    const remaining = await comet.balanceOf(signer.address);
    if (remaining.eq(0)) {
      console.log(`(0 cBase remaining — nothing to withdraw)`);
      return;
    }
    const tx = await comet.withdraw(BASE.address, remaining);
    await tx.wait();
    return tx.hash;
  });

  // ====================================================================
  // Phase 8: TRUE BORROW (2-EOA path)
  //
  // In Compound v3, a user goes into "borrow" (negative principal) only
  // when they withdraw base beyond their own supply. Single-signer setup
  // can't trigger that without overdrawing the pool. So we generate a
  // fresh random EOA, fund it with native gas + cached wETH collateral,
  // then have signer supply lots of base as the lender, the new EOA
  // supplies collateral, and withdraws base → real borrow.
  // ====================================================================
  console.log(`\n--- Phase 8: TRUE borrow via 2-EOA setup ---`);

  const borrower = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log(`    borrower wallet: ${borrower.address}`);

  // 8a. Lender (signer) supplies a lot of base
  const LENDER_SUPPLY = ethers.BigNumber.from('10000');
  await step(`comet.supply(${BASE.symbol}, ${LENDER_SUPPLY}) [lender]`, async () => {
    const tx = await comet.supply(BASE.address, LENDER_SUPPLY);
    await tx.wait();
    return tx.hash;
  });

  // 8b. Fund borrower with native gas
  await step(`fund borrower with 0.01 native gas`, async () => {
    const tx = await signer.sendTransaction({
      to: borrower.address,
      value: ethers.utils.parseEther('0.01'),
    });
    await tx.wait();
    return tx.hash;
  });

  // 8c. Warm borrower's ATAs for wETH + wUSDC (cached wrappers)
  await step(`${COLL.symbol}.ensure_token_account(borrower)`, async () => {
    const wrapper = new ethers.Contract(
      COLL.address,
      ['function ensure_token_account(address) returns (bytes32)'],
      signer,
    );
    const tx = await wrapper.ensure_token_account(borrower.address);
    await tx.wait();
    return tx.hash;
  });
  await step(`${BASE.symbol}.ensure_token_account(borrower)`, async () => {
    const wrapper = new ethers.Contract(
      BASE.address,
      ['function ensure_token_account(address) returns (bytes32)'],
      signer,
    );
    const tx = await wrapper.ensure_token_account(borrower.address);
    await tx.wait();
    return tx.hash;
  });

  // 8d. Fund borrower with cached wETH collateral + small wUSDC buffer
  // (the dust covers interest accrual at repay time so we can clear
  // the borrow exactly without leftover)
  const BORROWER_COLL = ethers.BigNumber.from('100'); // 100 raw = ~$0.003
  const BORROWER_BASE_DUST = ethers.BigNumber.from('100'); // 100 raw wUSDC for repay interest dust
  await step(`fund borrower with ${BORROWER_COLL} ${COLL.symbol}`, async () => {
    const tx = await collToken.transfer(borrower.address, BORROWER_COLL);
    await tx.wait();
    return tx.hash;
  });
  await step(`fund borrower with ${BORROWER_BASE_DUST} ${BASE.symbol} (repay dust)`, async () => {
    const tx = await baseToken.transfer(borrower.address, BORROWER_BASE_DUST);
    await tx.wait();
    return tx.hash;
  });

  // 8e. Borrower approves Comet for wETH (so Comet can pull collateral)
  const collTokenAsBorrower = collToken.connect(borrower);
  await step(`${COLL.symbol}.approve(comet, max) [borrower]`, async () => {
    const tx = await (collTokenAsBorrower as any).approve(COMET, MaxUint256);
    await tx.wait();
    return tx.hash;
  });

  // 8f. Borrower supplies wETH as collateral
  const cometAsBorrower = comet.connect(borrower);
  await step(`comet.supply(${COLL.symbol}, ${BORROWER_COLL}) [borrower]`, async () => {
    const tx = await (cometAsBorrower as any).supply(COLL.address, BORROWER_COLL);
    await tx.wait();
    return tx.hash;
  });

  // 8g. Borrower withdraws base — TRUE BORROW since they have 0 base supply
  // 100 raw wETH * $3000 = $0.003 collateral. LTV 70% → $0.0021 borrow capacity.
  // At wUSDC $1 + 6 decimals: $0.0021 = 2100 raw wUSDC.
  const BORROW_AMT = ethers.BigNumber.from('1000'); // 1000 raw wUSDC = $0.001 (well within capacity)
  await step(`comet.withdraw(${BASE.symbol}, ${BORROW_AMT}) [borrower → TRUE borrow]`, async () => {
    const tx = await (cometAsBorrower as any).withdraw(BASE.address, BORROW_AMT);
    await tx.wait();
    return tx.hash;
  });
  const realBorrow = await comet.borrowBalanceOf(borrower.address);
  console.log(`    borrower.borrowBalanceOf: ${realBorrow} — should be >0 (real debt)`);

  // 8h. Borrower repays: supply back the borrowed base + a tiny dust for interest
  const baseTokenAsBorrower = baseToken.connect(borrower);
  await step(`${BASE.symbol}.approve(comet, max) [borrower]`, async () => {
    const tx = await (baseTokenAsBorrower as any).approve(COMET, MaxUint256);
    await tx.wait();
    return tx.hash;
  });
  await step(`comet.supply(${BASE.symbol}, ${BORROW_AMT}.add(10)) [borrower repay]`, async () => {
    const tx = await (cometAsBorrower as any).supply(BASE.address, BORROW_AMT.add(10));
    await tx.wait();
    return tx.hash;
  });
  const borrowAfterRepay = await comet.borrowBalanceOf(borrower.address);
  console.log(`    borrower.borrowBalanceOf after repay: ${borrowAfterRepay}`);

  // 8i. Borrower withdraws their wETH collateral
  await step(`comet.withdraw(${COLL.symbol}, ${BORROWER_COLL}) [borrower]`, async () => {
    const tx = await (cometAsBorrower as any).withdraw(COLL.address, BORROWER_COLL);
    await tx.wait();
    return tx.hash;
  });

  console.log(`\n--- Summary ---`);
  console.log(`  PASS: ${passed.length}`);
  console.log(`  FAIL: ${failed.length}`);
  for (const p of passed) console.log(`    + ${p}`);

  console.log(`\n--- Per-action metrics ---`);
  const txRows = metrics.filter((m) => m.iterSigs !== undefined);
  if (txRows.length > 0) {
    const pad = (s: string, n: number) => s.padEnd(n);
    const padR = (s: string, n: number) => s.padStart(n);
    console.log(
      '  ' +
        pad('Action', 60) +
        padR('wall(s)', 9) +
        padR('sigs', 6) +
        padR('Sol CU', 11) +
        padR('max heap', 10) +
        padR('slots', 7),
    );
    console.log('  ' + '-'.repeat(103));
    for (const m of txRows) {
      const wallS = (m.wallMs / 1000).toFixed(1);
      const cuStr = m.totalCU !== undefined ? m.totalCU.toLocaleString() : '-';
      const heapStr = m.maxHeap !== undefined ? m.maxHeap.toLocaleString() : '-';
      const span = m.slotSpan !== undefined ? String(m.slotSpan) : '-';
      const sigs = m.iterSigs !== undefined ? String(m.iterSigs) : '-';
      const label = m.name.length > 59 ? m.name.slice(0, 57) + '…' : m.name;
      console.log('  ' + pad(label, 60) + padR(wallS, 9) + padR(sigs, 6) + padR(cuStr, 11) + padR(heapStr, 10) + padR(span, 7));
    }
  }

  if (failed.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failed) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
