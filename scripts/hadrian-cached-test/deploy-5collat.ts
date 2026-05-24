// Multi-collateral Compound v3 deploy on Hadrian.
//
// Same shape as deploy.ts (single-collat) but with FIVE cached SPL_ERC20
// wrappers as collateral:
//   - cached wETH    (existing, $3000)
//   - wHEAT, wSALT, wMILK, wOIL (newly bootstrapped via bootstrap-5-cached.ts)
//
// Stresses Compound v3's multi-asset accounting:
//   - Borrow capacity calc walks all 5 collats
//   - Each collat has its own price feed
//   - assetsIn bitmap tracks which collats user holds

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const CACHED_WUSDC = '0x33fb7AD189B0A59CCAFcC3337F3a8B61e3719912';
const CACHED_WETH  = '0x09A9B33501f2cf1E42dF14c6EcE1F7EDE8376366';
const ENSURE_TOKEN_ACCOUNT_SELECTOR = '0x5e094743';

const PRICE_WUSDC = ethers.BigNumber.from('100000000');           // $1
const PRICES = {
  wETH:  ethers.BigNumber.from('300000000000'),                    // $3000
  wHEAT: ethers.BigNumber.from('1000000000'),                      // $10
  wSALT: ethers.BigNumber.from('500000000'),                       // $5
  wMILK: ethers.BigNumber.from('2000000000'),                      // $20
  wOIL:  ethers.BigNumber.from('5000000000'),                      // $50
};

const COLLAT_FACTORS = {
  wETH:  { lb: '700000000000000000', l: '750000000000000000', lf: '950000000000000000' },
  wHEAT: { lb: '650000000000000000', l: '700000000000000000', lf: '950000000000000000' },
  wSALT: { lb: '600000000000000000', l: '650000000000000000', lf: '950000000000000000' },
  wMILK: { lb: '650000000000000000', l: '700000000000000000', lf: '950000000000000000' },
  wOIL:  { lb: '600000000000000000', l: '650000000000000000', lf: '950000000000000000' },
};

async function ensureAtaIfCached(asset: string, recipient: string, signer: any) {
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
  const tx = await wrapper.ensure_token_account(recipient, { gasLimit: 100_000_000 });
  await tx.wait();
  return true;
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Deployer:    ${admin.address}`);

  // Load cached wrappers from bootstrap script
  const cachedWrappersFile = path.join('scripts', 'hadrian-cached-test', 'cached-wrappers.json');
  if (!fs.existsSync(cachedWrappersFile)) {
    throw new Error(`Run bootstrap-5-cached.ts first to create the 4 new cached wrappers.`);
  }
  const cachedWrappers = JSON.parse(fs.readFileSync(cachedWrappersFile, 'utf8')).wrappers;
  const wHEAT = cachedWrappers.find((w: any) => w.symbol === 'wHEAT').wrapper;
  const wSALT = cachedWrappers.find((w: any) => w.symbol === 'wSALT').wrapper;
  const wMILK = cachedWrappers.find((w: any) => w.symbol === 'wMILK').wrapper;
  const wOIL  = cachedWrappers.find((w: any) => w.symbol === 'wOIL').wrapper;

  console.log(`Collateral set (5 cached SPL wrappers):`);
  console.log(`  wETH  (${PRICES.wETH.toString().slice(0, -8)} cents): ${CACHED_WETH}`);
  console.log(`  wHEAT (${PRICES.wHEAT.toString().slice(0, -8)} cents): ${wHEAT}`);
  console.log(`  wSALT (${PRICES.wSALT.toString().slice(0, -8)} cents): ${wSALT}`);
  console.log(`  wMILK (${PRICES.wMILK.toString().slice(0, -8)} cents): ${wMILK}`);
  console.log(`  wOIL  (${PRICES.wOIL.toString().slice(0, -8)} cents): ${wOIL}`);

  // ─── 1. Price feeds ─────────────────────────────────────────────
  console.log('\n[1/7] Deploy SimplePriceFeed for base + 5 collats...');
  const SimplePriceFeed = await ethers.getContractFactory('contracts/test/SimplePriceFeed.sol:SimplePriceFeed');
  const usdcFeed  = await (await SimplePriceFeed.deploy(PRICE_WUSDC, 8, { gasLimit: 100_000_000 })).deployed();
  const wethFeed  = await (await SimplePriceFeed.deploy(PRICES.wETH,  8, { gasLimit: 100_000_000 })).deployed();
  const wheatFeed = await (await SimplePriceFeed.deploy(PRICES.wHEAT, 8, { gasLimit: 100_000_000 })).deployed();
  const wsaltFeed = await (await SimplePriceFeed.deploy(PRICES.wSALT, 8, { gasLimit: 100_000_000 })).deployed();
  const wmilkFeed = await (await SimplePriceFeed.deploy(PRICES.wMILK, 8, { gasLimit: 100_000_000 })).deployed();
  const woilFeed  = await (await SimplePriceFeed.deploy(PRICES.wOIL,  8, { gasLimit: 100_000_000 })).deployed();
  console.log(`      usdcFeed:  ${usdcFeed.address}`);
  console.log(`      wethFeed:  ${wethFeed.address}`);
  console.log(`      wheatFeed: ${wheatFeed.address}`);
  console.log(`      wsaltFeed: ${wsaltFeed.address}`);
  console.log(`      wmilkFeed: ${wmilkFeed.address}`);
  console.log(`      woilFeed:  ${woilFeed.address}`);

  // ─── 2. CometProxyAdmin ─────────────────────────────────────────
  console.log('\n[2/7] Deploy CometProxyAdmin...');
  const CometProxyAdmin = await ethers.getContractFactory('contracts/CometProxyAdmin.sol:CometProxyAdmin');
  const cpa = await CometProxyAdmin.deploy(admin.address, { gasLimit: 100_000_000 });
  await cpa.deployed();
  console.log(`      CometProxyAdmin:  ${cpa.address}`);

  // ─── 3. CometExt ────────────────────────────────────────────────
  console.log('\n[3/7] Deploy CometExt...');
  const CometExt = await ethers.getContractFactory('contracts/CometExt.sol:CometExt');
  const extConfig = {
    name32:   ethers.utils.formatBytes32String('Comp cached-5collat test'),
    symbol32: ethers.utils.formatBytes32String('cwUSDC-5'),
  };
  const cometExt = await CometExt.deploy(extConfig, { gasLimit: 100_000_000 });
  await cometExt.deployed();
  console.log(`      CometExt:  ${cometExt.address}`);

  // ─── 4. Comet impl with 5 collats ───────────────────────────────
  console.log('\n[4/7] Deploy Comet impl with 5 collateral assets...');
  const supplyCap = ethers.BigNumber.from('1000000000').mul(ethers.BigNumber.from('10').pow(9)); // 1B raw

  const assetConfigs = [
    {
      asset: CACHED_WETH,
      priceFeed: wethFeed.address,
      decimals: 8,
      borrowCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wETH.lb),
      liquidateCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wETH.l),
      liquidationFactor: ethers.BigNumber.from(COLLAT_FACTORS.wETH.lf),
      supplyCap,
    },
    {
      asset: wHEAT,
      priceFeed: wheatFeed.address,
      decimals: 9,
      borrowCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wHEAT.lb),
      liquidateCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wHEAT.l),
      liquidationFactor: ethers.BigNumber.from(COLLAT_FACTORS.wHEAT.lf),
      supplyCap,
    },
    {
      asset: wSALT,
      priceFeed: wsaltFeed.address,
      decimals: 9,
      borrowCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wSALT.lb),
      liquidateCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wSALT.l),
      liquidationFactor: ethers.BigNumber.from(COLLAT_FACTORS.wSALT.lf),
      supplyCap,
    },
    {
      asset: wMILK,
      priceFeed: wmilkFeed.address,
      decimals: 9,
      borrowCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wMILK.lb),
      liquidateCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wMILK.l),
      liquidationFactor: ethers.BigNumber.from(COLLAT_FACTORS.wMILK.lf),
      supplyCap,
    },
    {
      asset: wOIL,
      priceFeed: woilFeed.address,
      decimals: 9,
      borrowCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wOIL.lb),
      liquidateCollateralFactor: ethers.BigNumber.from(COLLAT_FACTORS.wOIL.l),
      liquidationFactor: ethers.BigNumber.from(COLLAT_FACTORS.wOIL.lf),
      supplyCap,
    },
  ];

  const cometConfig = {
    governor: admin.address,
    pauseGuardian: admin.address,
    baseToken: CACHED_WUSDC,
    baseTokenPriceFeed: usdcFeed.address,
    extensionDelegate: cometExt.address,
    supplyKink:                         ethers.BigNumber.from('850000000000000000'),
    supplyPerYearInterestRateSlopeLow:  ethers.BigNumber.from('48000000000000000'),
    supplyPerYearInterestRateSlopeHigh: ethers.BigNumber.from('1600000000000000000'),
    supplyPerYearInterestRateBase: 0,
    borrowKink:                         ethers.BigNumber.from('850000000000000000'),
    borrowPerYearInterestRateSlopeLow:  ethers.BigNumber.from('53000000000000000'),
    borrowPerYearInterestRateSlopeHigh: ethers.BigNumber.from('1700000000000000000'),
    borrowPerYearInterestRateBase:      ethers.BigNumber.from('15000000000000000'),
    storeFrontPriceFactor:              ethers.BigNumber.from('500000000000000000'),
    trackingIndexScale:                 ethers.BigNumber.from('1000000000000000'),
    baseTrackingSupplySpeed: 0,
    baseTrackingBorrowSpeed: 0,
    baseMinForRewards:                  ethers.BigNumber.from('100').mul(1_000_000),
    baseBorrowMin: 1,
    targetReserves:                     ethers.BigNumber.from('5000000').mul(1_000_000),
    assetConfigs,
  };
  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometImpl = await Comet.deploy(cometConfig, { gasLimit: 500_000_000 });
  await cometImpl.deployed();
  console.log(`      Comet impl:  ${cometImpl.address}`);

  // ─── 5. CometProxy ──────────────────────────────────────────────
  console.log('\n[5/7] Deploy CometProxy...');
  const TransparentUpgradeableProxy = await ethers.getContractFactory(
    'contracts/vendor/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
  );
  const cometProxy = await TransparentUpgradeableProxy.deploy(
    cometImpl.address,
    cpa.address,
    '0x',
    { gasLimit: 200_000_000 },
  );
  await cometProxy.deployed();
  console.log(`      CometProxy:  ${cometProxy.address}`);

  // ─── 6. initializeStorage ───────────────────────────────────────
  console.log('\n[6/7] Call initializeStorage on proxy...');
  const initTx = await Comet.attach(cometProxy.address).initializeStorage({ gasLimit: 30_000_000 });
  await initTx.wait();
  console.log(`      tx: ${initTx.hash}`);

  // ─── 7. ATA warmup for Comet on all 6 cached wrappers (base + 5 collats) ─
  console.log("\n[7/7] ATA warmup for Comet's cached-wrapper holdings...");
  for (const [name, addr] of [
    ['wUSDC (base)', CACHED_WUSDC],
    ['wETH',  CACHED_WETH],
    ['wHEAT', wHEAT],
    ['wSALT', wSALT],
    ['wMILK', wMILK],
    ['wOIL',  wOIL],
  ] as [string, string][]) {
    const ok = await ensureAtaIfCached(addr, cometProxy.address, admin);
    console.log(`    ${name}: ${ok ? 'ATA warmed' : 'plain ERC20 (skipped)'}`);
  }

  // ─── persist ────────────────────────────────────────────────────
  const stateFile = path.join('scripts', 'hadrian-cached-test', 'state-5collat.json');
  const state = {
    deployedAt: new Date().toISOString(),
    deployer: admin.address,
    network: 'hadrian',
    chainId: 200010,
    baseAsset: {
      symbol: 'wUSDC',
      address: CACHED_WUSDC,
      decimals: 6,
      priceUsd: 1.0,
      priceFeed: usdcFeed.address,
    },
    collateralAssets: [
      { symbol: 'wETH',  address: CACHED_WETH, decimals: 8, priceUsd: 3000, priceFeed: wethFeed.address, borrowCollateralFactor: 0.70 },
      { symbol: 'wHEAT', address: wHEAT,       decimals: 9, priceUsd: 10,   priceFeed: wheatFeed.address, borrowCollateralFactor: 0.65 },
      { symbol: 'wSALT', address: wSALT,       decimals: 9, priceUsd: 5,    priceFeed: wsaltFeed.address, borrowCollateralFactor: 0.60 },
      { symbol: 'wMILK', address: wMILK,       decimals: 9, priceUsd: 20,   priceFeed: wmilkFeed.address, borrowCollateralFactor: 0.65 },
      { symbol: 'wOIL',  address: wOIL,        decimals: 9, priceUsd: 50,   priceFeed: woilFeed.address, borrowCollateralFactor: 0.60 },
    ],
    cometProxy: cometProxy.address,
    cometImpl:  cometImpl.address,
    cometExt:   cometExt.address,
    cometProxyAdmin: cpa.address,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

  console.log('\n══════ 5-collat Comet deploy COMPLETE ══════');
  console.log(`  CometProxy:  ${cometProxy.address}`);
  console.log(`  base:        wUSDC ${CACHED_WUSDC}`);
  console.log(`  collats:     5 cached SPL_ERC20 wrappers`);
  console.log(`\nstate: ${stateFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
