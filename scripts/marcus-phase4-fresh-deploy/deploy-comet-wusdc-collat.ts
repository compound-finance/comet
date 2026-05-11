// Step 0 (extension) — deploy a Comet with wUSDC base + PCOL collateral.
// Same baseToken story as deploy-comet-wusdc-test.ts (vanilla SPL_ERC20 wUSDC,
// not UnifiedToken), plus one collateral asset registered, so we can bench
// the full path: collateral supply, base borrow, composed Bulker.
//
// Reuses everything we already have on Marcus:
//   - V2 CometProxyAdmin, V2 USDC feed
//   - V2-collat PCOL contract (deployer already holds 1M) + V2-collat pcolFeed
//
// Skips OrchestratorRouter / pre-deposited caller wiring entirely — wUSDC is
// a vanilla SPL_ERC20 with no UT-specific machinery.
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/deploy-comet-wusdc-collat.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const REUSE = {
  cometProxyAdmin: '0x9A293E9acFa12Ffe05428B2550E3C41b99d804bc', // V2
  usdcFeed:        '0x815B967F47e3c2173d87c1Ff23114C00BA6766E5', // V2 ($1.00)
  pcol:            '0x28fBb35045Ae4e7DAE076e3c0BC6CaA371B8A75c', // V2-collat PCOL (deployer has 1M)
  pcolFeed:        '0x5EfC024e047ECcb4AfAa12ceB25FB2ea4565e025', // V2-collat PCOL feed ($1.00)
};

const WUSDC = '0x39844f1d605a11acd87f766494291bbd11b406f4'; // rome-solidity SPL_ERC20

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 8): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e: any) {
      lastErr = e;
      console.log(`  [retry ${i + 1}/${attempts}] ${label}: ${(e.message || JSON.stringify(e)).slice(0, 150)}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Deployer: ${admin.address}`);
  console.log(`Base asset: wUSDC (${WUSDC})`);
  console.log(`Collateral: PCOL (${REUSE.pcol})\n`);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: admin.address,
    reuse: REUSE,
    base: WUSDC,
    addresses: {} as any,
    txReceipts: {} as any,
    notes: ['wUSDC base + PCOL collateral. Vanilla Compound v3 — no OrchestratorRouter, no UT pre-deposit machinery.'],
  };

  // 1. CometExt
  console.log('[1/5] CometExt…');
  const CometExt = await ethers.getContractFactory('contracts/CometExt.sol:CometExt');
  const extConfig = {
    name32:   ethers.utils.formatBytes32String('Compound wUSDC on Rome'),
    symbol32: ethers.utils.formatBytes32String('cwUSDCv3'),
  };
  const cometExt = await withRetry('CometExt', () => CometExt.deploy(extConfig, { gasLimit: 100_000_000 }));
  await cometExt.deployed();
  console.log(`      ${cometExt.address}`);
  out.addresses.cometExt = cometExt.address;

  // 2. Comet impl — wUSDC base + PCOL collateral
  console.log('\n[2/5] Comet impl (baseToken=wUSDC, 1 collateral)…');
  const cometConfig = {
    governor: admin.address,
    pauseGuardian: admin.address,
    baseToken: WUSDC,
    baseTokenPriceFeed: REUSE.usdcFeed,
    extensionDelegate: cometExt.address,
    supplyKink: ethers.BigNumber.from('850000000000000000'),
    supplyPerYearInterestRateSlopeLow:  ethers.BigNumber.from('48000000000000000'),
    supplyPerYearInterestRateSlopeHigh: ethers.BigNumber.from('1600000000000000000'),
    supplyPerYearInterestRateBase: 0,
    borrowKink: ethers.BigNumber.from('850000000000000000'),
    borrowPerYearInterestRateSlopeLow:  ethers.BigNumber.from('53000000000000000'),
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
        asset: REUSE.pcol,
        priceFeed: REUSE.pcolFeed,
        decimals: 18,
        borrowCollateralFactor: ethers.BigNumber.from('700000000000000000'),    // 0.70
        liquidateCollateralFactor: ethers.BigNumber.from('800000000000000000'), // 0.80
        liquidationFactor: ethers.BigNumber.from('900000000000000000'),         // 0.90
        supplyCap: ethers.utils.parseUnits('100000', 18),                       // 100k PCOL cap
      },
    ],
  };
  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometImpl = await withRetry('Comet impl', () => Comet.deploy(cometConfig, { gasLimit: 250_000_000 }));
  await cometImpl.deployed();
  console.log(`      ${cometImpl.address}`);
  out.addresses.cometImpl = cometImpl.address;

  // 3. Configurator + ConfiguratorProxy
  console.log('\n[3/5] Configurator stack…');
  const Configurator = await ethers.getContractFactory('contracts/Configurator.sol:Configurator');
  const configuratorImpl = await withRetry('Configurator impl', () => Configurator.deploy({ gasLimit: 200_000_000 }));
  await configuratorImpl.deployed();
  console.log(`      Configurator impl:  ${configuratorImpl.address}`);
  out.addresses.configuratorImpl = configuratorImpl.address;

  const ConfiguratorProxy = await ethers.getContractFactory('contracts/ConfiguratorProxy.sol:ConfiguratorProxy');
  const initData = configuratorImpl.interface.encodeFunctionData('initialize', [admin.address]);
  const configuratorProxy = await withRetry('ConfiguratorProxy', () =>
    ConfiguratorProxy.deploy(configuratorImpl.address, REUSE.cometProxyAdmin, initData, { gasLimit: 100_000_000 }),
  );
  await configuratorProxy.deployed();
  console.log(`      ConfiguratorProxy:  ${configuratorProxy.address}`);
  out.addresses.configuratorProxy = configuratorProxy.address;

  // 4. CometProxy
  console.log('\n[4/5] CometProxy…');
  const TransparentUpgradeableProxy = await ethers.getContractFactory(
    'contracts/vendor/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
  );
  const cometProxy = await withRetry('CometProxy', () =>
    TransparentUpgradeableProxy.deploy(cometImpl.address, REUSE.cometProxyAdmin, '0x', { gasLimit: 100_000_000 }),
  );
  await cometProxy.deployed();
  console.log(`      CometProxy:         ${cometProxy.address}`);
  out.addresses.cometProxy = cometProxy.address;

  // 5. initializeStorage
  console.log('\n[5/5] cometProxy.initializeStorage()…');
  const cometIface = new ethers.utils.Interface(['function initializeStorage()']);
  const cometProxyCometSide = new ethers.Contract(cometProxy.address, cometIface, admin);
  const initTx = await withRetry('initializeStorage', () => cometProxyCometSide.initializeStorage({ gasLimit: 30_000_000 }));
  await initTx.wait();
  console.log(`      tx: ${initTx.hash}`);
  out.txReceipts.initializeStorage = initTx.hash;

  // Smoke verify
  console.log('\n[Verify] Smoke reads…');
  const cometViaProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', cometProxy.address);
  out.verifications = {
    cometBaseToken: await cometViaProxy.baseToken(),
    cometNumAssets: (await cometViaProxy.numAssets()).toString(),
    cometAsset0:    await cometViaProxy.getAssetInfo(0).then((a: any) => ({ asset: a.asset, priceFeed: a.priceFeed, scale: a.scale.toString() })),
  };
  console.log(JSON.stringify(out.verifications, null, 2));

  const outPath = path.join(__dirname, 'deploy-comet-wusdc-collat.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
  console.log('\n══════ Comet-wUSDC-collat deploy COMPLETE ══════');
  console.log(`  cometProxy: ${cometProxy.address}`);
  console.log(`  cometImpl:  ${cometImpl.address}`);
  console.log(`  cometExt:   ${cometExt.address}`);
  console.log(`  baseToken:  wUSDC ${WUSDC}`);
  console.log(`  collateral: PCOL ${REUSE.pcol}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
