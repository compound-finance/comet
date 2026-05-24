// Hadrian cached-wrapper Compound deployment.
//
// Same architectural pattern as rome-uniswap-v3 + rome-aave-v3: canonical
// Compound v3 (Comet) at the protocol layer; SPL_ERC20_cached wrappers as
// the base + collateral assets. Tests whether the cached-wrapper composition
// (proven for Uniswap V2/V3 + Aave V3) extends to Compound.
//
// Inputs (hardcoded — this is a one-off Hadrian smoke):
//   - baseAsset       = cached wUSDC (rome-solidity #210)
//   - collateralAsset = cached wETH (same)
//   - price feeds     = freshly deployed MockAggregator-equivalents
//
// Output: addresses written to scripts/hadrian-cached-test/state.json
//
// Run:
//   HADRIAN_PRIVATE_KEY=<key> ETH_PK=<key> \
//     npx hardhat run scripts/hadrian-cached-test/deploy.ts --network hadrian

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

// Cached SPL_ERC20 wrappers (rome-solidity #210, shipped 2026-05-23)
const CACHED_WUSDC = '0x33fb7AD189B0A59CCAFcC3337F3a8B61e3719912';
const CACHED_WETH  = '0x09A9B33501f2cf1E42dF14c6EcE1F7EDE8376366';

// SPL_ERC20_cached.ensure_token_account(address) — selector 0x5e094743
const ENSURE_TOKEN_ACCOUNT_SELECTOR = '0x5e094743';

// SimplePriceFeed selectors — Compound's vendored simple oracle returns an
// 8-decimal int256. We deploy two of these for the cached base + collat
// at fixed prices ($1 for wUSDC, $3000 for wETH — matching what Aave used).
const PRICE_WUSDC = ethers.BigNumber.from('100000000');      // $1 × 1e8
const PRICE_WETH  = ethers.BigNumber.from('300000000000');   // $3000 × 1e8

async function ensureAtaIfCached(asset: string, recipient: string, signer: any) {
  const probeData = ENSURE_TOKEN_ACCOUNT_SELECTOR + recipient.slice(2).padStart(64, '0');
  try {
    await ethers.provider.call({ to: asset, data: probeData });
  } catch {
    console.log(`    ${asset} → ${recipient}: plain ERC20 (no ATA needed)`);
    return;
  }
  const wrapper = new ethers.Contract(
    asset,
    ['function ensure_token_account(address) returns (bytes32)'],
    signer,
  );
  const tx = await wrapper.ensure_token_account(recipient, { gasLimit: 30_000_000 });
  await tx.wait();
  console.log(`    ${asset} → ${recipient}: ATA warmed`);
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Deployer:    ${admin.address}`);
  console.log(`Base asset:  cached wUSDC ${CACHED_WUSDC}`);
  console.log(`Collat asset: cached wETH ${CACHED_WETH}`);

  // ─── 1. Price feeds ─────────────────────────────────────────────
  // Compound's vendored SimplePriceFeed (contracts/test/SimplePriceFeed.sol)
  // matches what the registry-driven deploy uses for `priceFeedKind: simple`.
  console.log('\n[1/8] Deploy SimplePriceFeed(wUSDC, $1)...');
  const SimplePriceFeed = await ethers.getContractFactory('contracts/test/SimplePriceFeed.sol:SimplePriceFeed');
  const usdcFeed = await SimplePriceFeed.deploy(PRICE_WUSDC, 8, { gasLimit: 50_000_000 });
  await usdcFeed.deployed();
  console.log(`      usdcFeed:  ${usdcFeed.address}`);

  console.log('\n[1b/8] Deploy SimplePriceFeed(wETH, $3000)...');
  const wethFeed = await SimplePriceFeed.deploy(PRICE_WETH, 8, { gasLimit: 50_000_000 });
  await wethFeed.deployed();
  console.log(`      wethFeed:  ${wethFeed.address}`);

  // ─── 2. CometProxyAdmin ─────────────────────────────────────────
  console.log('\n[2/8] Deploy CometProxyAdmin...');
  const CometProxyAdmin = await ethers.getContractFactory('contracts/CometProxyAdmin.sol:CometProxyAdmin');
  const cpa = await CometProxyAdmin.deploy(admin.address, { gasLimit: 100_000_000 });
  await cpa.deployed();
  console.log(`      CometProxyAdmin:  ${cpa.address}`);

  // ─── 3. CometExt ────────────────────────────────────────────────
  console.log('\n[3/8] Deploy CometExt (cached wUSDC)...');
  const CometExt = await ethers.getContractFactory('contracts/CometExt.sol:CometExt');
  const extConfig = {
    name32:   ethers.utils.formatBytes32String('Comp cached-wUSDC test'),
    symbol32: ethers.utils.formatBytes32String('cwUSDC-cached'),
  };
  const cometExt = await CometExt.deploy(extConfig, { gasLimit: 100_000_000 });
  await cometExt.deployed();
  console.log(`      CometExt:  ${cometExt.address}`);

  // ─── 4. Comet impl ──────────────────────────────────────────────
  console.log('\n[4/8] Deploy Comet impl (baseToken=cached wUSDC)...');
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
    assetConfigs: [
      {
        asset:                 CACHED_WETH,
        priceFeed:             wethFeed.address,
        decimals:              8,
        borrowCollateralFactor: ethers.BigNumber.from('700000000000000000'),  // 70% LTV
        liquidateCollateralFactor: ethers.BigNumber.from('750000000000000000'),  // 75%
        liquidationFactor:      ethers.BigNumber.from('950000000000000000'),  // 95% (5% liq bonus)
        supplyCap:              ethers.BigNumber.from('1000000000').mul(ethers.BigNumber.from('10').pow(8)),
      },
    ],
  };
  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometImpl = await Comet.deploy(cometConfig, { gasLimit: 500_000_000 });
  await cometImpl.deployed();
  console.log(`      Comet impl:  ${cometImpl.address}`);

  // ─── 5. CometProxy ──────────────────────────────────────────────
  console.log('\n[5/8] Deploy CometProxy...');
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

  // ─── 6. initializeStorage on the comet proxy ────────────────────
  console.log('\n[6/8] Call initializeStorage on proxy...');
  const initTx = await Comet.attach(cometProxy.address).initializeStorage({ gasLimit: 30_000_000 });
  await initTx.wait();
  console.log(`      tx: ${initTx.hash}`);

  // ─── 7. ATA warmup for Comet proxy (cached wUSDC + cached wETH) ─
  console.log("\n[7/8] ATA warmup for Comet's cached-wrapper holdings...");
  await ensureAtaIfCached(CACHED_WUSDC, cometProxy.address, admin);
  await ensureAtaIfCached(CACHED_WETH,  cometProxy.address, admin);

  // ─── 8. Bulker (optional — needed for supplyEthForBalance / leverage flows) ─
  // Comet's Bulker requires a wrapped-native (WETH9-like) address. For the
  // cached-test we deploy with the chain's native gas wrapper.
  // The bulker isn't strictly needed for the supply/borrow/repay/withdraw
  // gamut; skip for the smoke test.
  console.log('\n[8/8] Bulker — skipped (not needed for supply/borrow gamut)');

  // ─── persist ────────────────────────────────────────────────────
  const stateDir = path.join('scripts', 'hadrian-cached-test');
  const stateFile = path.join(stateDir, 'state.json');
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
      {
        symbol: 'wETH',
        address: CACHED_WETH,
        decimals: 8,
        priceUsd: 3000.0,
        priceFeed: wethFeed.address,
        borrowCollateralFactor: '0.70',
        liquidateCollateralFactor: '0.75',
      },
    ],
    cometProxy: cometProxy.address,
    cometImpl:  cometImpl.address,
    cometExt:   cometExt.address,
    cometProxyAdmin: cpa.address,
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

  console.log('\n══════ Compound cached-base deploy COMPLETE ══════');
  console.log(`  CometProxy:         ${cometProxy.address}`);
  console.log(`  CometImpl:          ${cometImpl.address}`);
  console.log(`  CometExt:           ${cometExt.address}`);
  console.log(`  CometProxyAdmin:    ${cpa.address}`);
  console.log(`  baseToken (cached wUSDC): ${CACHED_WUSDC}`);
  console.log(`  collat (cached wETH):     ${CACHED_WETH}`);
  console.log(`  usdcFeed: ${usdcFeed.address} @ $1`);
  console.log(`  wethFeed: ${wethFeed.address} @ $3000`);
  console.log(`\nstate written: ${stateFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
