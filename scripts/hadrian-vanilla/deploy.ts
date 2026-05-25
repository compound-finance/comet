// Vanilla Compound v3 deploy on Hadrian against v6 cached SPL_ERC20_cached
// wrappers, using Oracle Gateway V2 price feeds.
//
// Strict-canonical shape:
//   • Comet impl deployed directly (NO TransparentUpgradeableProxy,
//     NO CometProxyAdmin) — initializeStorage is called on the impl itself,
//     bound non-upgradeably.  "vanilla compound, no proxy" per operator.
//   • CometExt for delegate-call surface (extension delegate is canonical
//     Compound v3 — kept).
//   • Canonical BaseBulker for atomic multi-action UX (Bulker.invoke for
//     supply/withdraw/transfer/claim).
//   • NO LiquidationRouter (Rome-specific add — out of scope for vanilla).
//   • Price feeds: Oracle Gateway V2 adapters (Pyth Pull) from
//     registry/chains/200010-hadrian/oracle.json.  Synthetic test collats
//     reuse USDC/USD feed (treated as $1 stables).
//
// Wrappers (8 collats + 1 base):
//   base:    v6 wUSDC      (already on Hadrian)
//   collat1: v6 wETH       (already on Hadrian)
//   collat2: v6 wSOL       (already on Hadrian)
//   collat3: wBTC          (fresh via bootstrap-mints.ts)
//   collat4: wHEAT         (fresh)
//   collat5: wSALT         (fresh)
//   collat6: wMILK         (fresh)
//   collat7: wOIL          (fresh)
//   collat8: wGOLD         (fresh)
//
// Output: scripts/hadrian-vanilla/state.json (consumed by gamut.ts).

import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { callTx, deployContract } from '../_lib/gas';

// ── Hadrian v6 cached wrappers (registry/chains/200010-hadrian/tokens.json post-#153) ──
const V6_WUSDC = '0x9a8B4cB7326033d72cA393c6b4C0d7Fb904Fa900';
const V6_WETH  = '0x55e4502D799938582bC2A15771ACC6a4d2928273';
const V6_WSOL  = '0x8c965F79b3d9bb95C12687E533FD5490b9c251cC';

// ── Oracle Gateway V2 adapters (registry/chains/200010-hadrian/oracle.json) ──
const OG_FEED_USDC_USD = '0xFf1adC858a6e16aD146b020da1CBfa5891a76f97';
const OG_FEED_ETH_USD  = '0xbE869FCA226545927E671E60F32720dB9dEc5980';
const OG_FEED_SOL_USD  = '0x63C28E0adE03B38e32b9cD85f2dD9B9fbB89185F';
const OG_FEED_BTC_USD  = '0x7e35f232C8f1cB0eDE5BEddb8Ebe7110C29a6E81';

const ENSURE_TOKEN_ACCOUNT_SELECTOR = '0x5e094743';

// Price approx values (informational only — gamut uses on-chain feeds for
// borrow capacity calc).  Tracked here so the recorded state.json
// documents what the collats are nominally worth at deploy time.
const PRICE_USD_APPROX: Record<string, number> = {
  wUSDC: 1,
  wETH:  3000,
  wSOL:  150,
  wBTC:  60000,
  wHEAT: 1,
  wSALT: 1,
  wMILK: 1,
  wOIL:  1,
  wGOLD: 1,
};

// Canonical Compound CFs (borrowCF / liquidateCF / liquidationFactor, all 1e18).
const CFS: Record<string, [string, string, string]> = {
  wETH:  ['700000000000000000', '750000000000000000', '950000000000000000'],
  wSOL:  ['650000000000000000', '700000000000000000', '950000000000000000'],
  wBTC:  ['700000000000000000', '750000000000000000', '950000000000000000'],
  wHEAT: ['600000000000000000', '650000000000000000', '950000000000000000'],
  wSALT: ['600000000000000000', '650000000000000000', '950000000000000000'],
  wMILK: ['600000000000000000', '650000000000000000', '950000000000000000'],
  wOIL:  ['600000000000000000', '650000000000000000', '950000000000000000'],
  wGOLD: ['600000000000000000', '650000000000000000', '950000000000000000'],
};

// Synthetic collats fall back to USDC/USD feed (treated as ~$1 test tokens).
function feedFor(symbol: string): string {
  switch (symbol) {
    case 'wUSDC': return OG_FEED_USDC_USD;
    case 'wETH':  return OG_FEED_ETH_USD;
    case 'wSOL':  return OG_FEED_SOL_USD;
    case 'wBTC':  return OG_FEED_BTC_USD;
    default:      return OG_FEED_USDC_USD;
  }
}

async function ensureAtaIfCached(asset: string, recipient: string, signer: any): Promise<boolean> {
  const probeData = ENSURE_TOKEN_ACCOUNT_SELECTOR + recipient.slice(2).padStart(64, '0');
  try {
    await ethers.provider.call({ to: asset, data: probeData });
  } catch {
    return false;
  }
  const wrapper = new ethers.Contract(
    asset,
    ['function ensure_token_account(address) returns (bytes32)'],
    signer,
  );
  const tx = await callTx(wrapper, 'ensure_token_account', [recipient]);
  await tx.wait();
  return true;
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Deployer: ${admin.address}`);

  // ── Load freshly-bootstrapped wrappers ─────────────────────────
  const mintsFile = path.join('scripts', 'hadrian-vanilla', 'mints.json');
  if (!fs.existsSync(mintsFile)) {
    throw new Error(`${mintsFile} not found. Run bootstrap-mints.ts first.`);
  }
  const mints = JSON.parse(fs.readFileSync(mintsFile, 'utf8')).wrappers as any[];
  const findFresh = (sym: string) => {
    const w = mints.find((m) => m.symbol === sym);
    if (!w) throw new Error(`Mint ${sym} missing from ${mintsFile} — run bootstrap-mints.ts.`);
    return w;
  };
  const wBTC  = findFresh('wBTC');
  const wHEAT = findFresh('wHEAT');
  const wSALT = findFresh('wSALT');
  const wMILK = findFresh('wMILK');
  const wOIL  = findFresh('wOIL');
  const wGOLD = findFresh('wGOLD');

  // ── Full collat list (in deploy order) ─────────────────────────
  type Collat = { symbol: string, address: string, decimals: number };
  const collats: Collat[] = [
    { symbol: 'wETH',  address: V6_WETH, decimals: 8 },
    { symbol: 'wSOL',  address: V6_WSOL, decimals: 9 },
    { symbol: 'wBTC',  address: wBTC.wrapper,  decimals: wBTC.decimals },
    { symbol: 'wHEAT', address: wHEAT.wrapper, decimals: wHEAT.decimals },
    { symbol: 'wSALT', address: wSALT.wrapper, decimals: wSALT.decimals },
    { symbol: 'wMILK', address: wMILK.wrapper, decimals: wMILK.decimals },
    { symbol: 'wOIL',  address: wOIL.wrapper,  decimals: wOIL.decimals },
    { symbol: 'wGOLD', address: wGOLD.wrapper, decimals: wGOLD.decimals },
  ];

  console.log(`\nBase asset:`);
  console.log(`  wUSDC  ${V6_WUSDC}  feed=${OG_FEED_USDC_USD}`);
  console.log(`Collats (${collats.length}):`);
  for (const c of collats) {
    console.log(`  ${c.symbol.padEnd(8)} ${c.address}  feed=${feedFor(c.symbol)}  dec=${c.decimals}`);
  }

  // ── 1. CometExt ─────────────────────────────────────────────
  console.log('\n[1/4] Deploy CometExt...');
  const CometExt = await ethers.getContractFactory('contracts/CometExt.sol:CometExt');
  const extConfig = {
    name32:   ethers.utils.formatBytes32String('Compound vUSDC vanilla'),
    symbol32: ethers.utils.formatBytes32String('cvUSDC'),
  };
  const cometExt = await deployContract<any>(CometExt, [extConfig]);
  await cometExt.deployed();
  console.log(`      CometExt:  ${cometExt.address}`);

  // ── 2. Comet impl with all collats ──────────────────────────
  console.log(`\n[2/4] Deploy Comet impl with base + ${collats.length} collats...`);
  const supplyCap = BigNumber.from('1000000000').mul(BigNumber.from('10').pow(9)); // 1B raw — generous

  const assetConfigs = collats.map((c) => {
    const [lb, l, lf] = CFS[c.symbol];
    return {
      asset: c.address,
      priceFeed: feedFor(c.symbol),
      decimals: c.decimals,
      borrowCollateralFactor:    BigNumber.from(lb),
      liquidateCollateralFactor: BigNumber.from(l),
      liquidationFactor:         BigNumber.from(lf),
      supplyCap,
    };
  });

  // Canonical Compound v3 mainnet config values.
  const cometConfig = {
    governor: admin.address,
    pauseGuardian: admin.address,
    baseToken: V6_WUSDC,
    baseTokenPriceFeed: OG_FEED_USDC_USD,
    extensionDelegate: cometExt.address,
    supplyKink:                         BigNumber.from('850000000000000000'),
    supplyPerYearInterestRateSlopeLow:  BigNumber.from('48000000000000000'),
    supplyPerYearInterestRateSlopeHigh: BigNumber.from('1600000000000000000'),
    supplyPerYearInterestRateBase: 0,
    borrowKink:                         BigNumber.from('850000000000000000'),
    borrowPerYearInterestRateSlopeLow:  BigNumber.from('53000000000000000'),
    borrowPerYearInterestRateSlopeHigh: BigNumber.from('1700000000000000000'),
    borrowPerYearInterestRateBase:      BigNumber.from('15000000000000000'),
    storeFrontPriceFactor:              BigNumber.from('500000000000000000'),
    trackingIndexScale:                 BigNumber.from('1000000000000000'),
    baseTrackingSupplySpeed: 0,
    baseTrackingBorrowSpeed: 0,
    baseMinForRewards:                  BigNumber.from('100').mul(1_000_000),
    baseBorrowMin: 1,
    targetReserves:                     BigNumber.from('5000000').mul(1_000_000),
    assetConfigs,
  };
  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometImpl = await deployContract<any>(Comet, [cometConfig]);
  await cometImpl.deployed();
  console.log(`      Comet impl:  ${cometImpl.address}  (no proxy — used directly)`);

  // ── 3. initializeStorage on impl ────────────────────────────
  // Per operator: "no proxy needed any more" — call initializeStorage on the
  // impl itself.  Comet's _storageInitialized guard remains effective
  // against re-init.
  console.log('\n[3/4] Call initializeStorage on Comet impl...');
  const initTx = await callTx(cometImpl, 'initializeStorage', []);
  await initTx.wait();
  console.log(`      tx: ${initTx.hash}`);

  // ── 4. Canonical BaseBulker ─────────────────────────────────
  // Bulker(admin, wrappedNativeToken).  Rome's "native gas" maps to wUSDC.
  console.log('\n[4/4] Deploy canonical Bulker...');
  const Bulker = await ethers.getContractFactory('contracts/bulkers/BaseBulker.sol:BaseBulker');
  const bulker = await deployContract<any>(Bulker, [admin.address, V6_WUSDC]);
  await bulker.deployed();
  console.log(`      Bulker:  ${bulker.address}`);

  // ── ATA warmup — Comet + Bulker on every cached wrapper ─────
  console.log(`\nATA warmup — Comet impl + Bulker × (base + ${collats.length} collats)`);
  for (const [name, addr] of [
    ['wUSDC (base)', V6_WUSDC],
    ...collats.map((c) => [c.symbol, c.address] as [string, string]),
  ] as [string, string][]) {
    const okComet = await ensureAtaIfCached(addr, cometImpl.address, admin);
    console.log(`  ${name.padEnd(14)} → Comet:  ${okComet ? 'ATA warmed' : 'plain ERC20 (skipped)'}`);
    const okBulker = await ensureAtaIfCached(addr, bulker.address, admin);
    console.log(`  ${name.padEnd(14)} → Bulker: ${okBulker ? 'ATA warmed' : 'plain ERC20 (skipped)'}`);
  }

  // ── persist state.json ──────────────────────────────────────
  const stateFile = path.join('scripts', 'hadrian-vanilla', 'state.json');
  const state = {
    deployedAt: new Date().toISOString(),
    deployer: admin.address,
    network: 'hadrian',
    chainId: 200010,
    shape: 'vanilla-no-proxy',
    baseAsset: {
      symbol: 'wUSDC',
      address: V6_WUSDC,
      decimals: 6,
      priceUsd: PRICE_USD_APPROX.wUSDC,
      priceFeed: OG_FEED_USDC_USD,
      priceFeedSource: 'oracle-gateway-v2:pyth-pull',
    },
    collateralAssets: collats.map((c) => ({
      symbol: c.symbol,
      address: c.address,
      decimals: c.decimals,
      priceUsd: PRICE_USD_APPROX[c.symbol] ?? 1,
      priceFeed: feedFor(c.symbol),
      priceFeedSource: 'oracle-gateway-v2:pyth-pull',
      borrowCollateralFactor: Number(BigNumber.from(CFS[c.symbol][0]).toString()) / 1e18,
      liquidateCollateralFactor: Number(BigNumber.from(CFS[c.symbol][1]).toString()) / 1e18,
      liquidationFactor: Number(BigNumber.from(CFS[c.symbol][2]).toString()) / 1e18,
    })),
    cometExt: cometExt.address,
    comet: cometImpl.address,
    bulker: bulker.address,
    liquidationRouter: null,
    sources: {
      wrapperFactoryV6: '0x86149124d74ebb3aa41a19641b700e88202b6285',
      oracleGatewayV2Factory: '0x9be249718c5c066d98fead6bfbb214ca0787f870',
    },
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
  console.log(`\n═══ DEPLOY COMPLETE ═══`);
  console.log(`  Comet (no proxy): ${cometImpl.address}`);
  console.log(`  Bulker:           ${bulker.address}`);
  console.log(`  CometExt:         ${cometExt.address}`);
  console.log(`  state written:    ${stateFile}`);
  console.log(`\nNext: npx hardhat run scripts/hadrian-vanilla/gamut.ts --network hadrian`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
