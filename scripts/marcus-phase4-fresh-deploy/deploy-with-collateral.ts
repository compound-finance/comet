// Phase 4 — fresh Comet deploy with one placeholder collateral asset, so we
// can bench the borrow path. Reuses the same UnifiedToken (decimals=6) +
// CometProxyAdmin from the supply-bench deploy; everything Comet-side is
// fresh because `assetConfigs` is fixed at Comet impl construction.
//
// Differs from deploy-fresh.ts in only two places:
//   1. Deploys a placeholder ERC20 ("PCOL") + SimplePriceFeed for it.
//   2. Comet config includes the placeholder in `assetConfigs[]`.
//
// Run:
//   ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//   RELAYER_ADDRESS=0x56D704338cdE8602374E7dFd0D4BEAD125261AfD \
//   npx hardhat run scripts/marcus-phase4-fresh-deploy/deploy-with-collateral.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';

const USDC_MINT_BS58 = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// Reuse from the supply-bench deploy.
const REUSE = {
  cometProxyAdmin:   '0x41aE246D1D212e9E1999DC4D438bA810653c0e0E',
  unifiedToken:      '0xe76bb4c8C0f50C75eE348E91ddd34f4043582aCC', // decimals=6
  usdcFeed:          '0x52F2054AEB16F33b03C24910D1Ec82ca0ca0fB9d',
};

function bs58ToBytes32(b: string): string {
  return '0x' + Buffer.from(bs58.decode(b)).toString('hex');
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 12): Promise<T> {
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
  const relayerAddr = process.env.RELAYER_ADDRESS!;
  if (!ethers.utils.isAddress(relayerAddr)) throw new Error('Set RELAYER_ADDRESS');
  console.log(`Deployer: ${admin.address}`);
  console.log(`Relayer:  ${relayerAddr}\n`);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: admin.address,
    relayer: relayerAddr,
    reuse: REUSE,
    addresses: {} as any,
    txReceipts: {} as any,
    notes: ['Fresh Comet stack with one placeholder collateral. Reuses UnifiedToken + CometProxyAdmin + USDC feed from supply-bench deploy.'],
  };

  // ─────── 1. Placeholder collateral (PCOL) ───────
  console.log(`[1/8] Placeholder collateral (PCOL, 18 decimals, 1M supply to deployer)…`);
  const StandardToken = await ethers.getContractFactory('contracts/test/FaucetToken.sol:StandardToken');
  const initialSupply = ethers.utils.parseUnits('1000000', 18); // 1M PCOL
  const pcol = await withRetry('PCOL', () =>
    StandardToken.deploy(initialSupply, 'Phase 4 Placeholder Collateral', 18, 'PCOL', { gasLimit: 100_000_000 }),
  );
  await pcol.deployed();
  console.log(`      ${pcol.address}`);
  out.addresses.pcol = pcol.address;

  // ─────── 2. Price feed for PCOL ($1.00) ───────
  console.log(`\n[2/8] PCOL price feed (constant $1.00)…`);
  const SimplePriceFeed = await ethers.getContractFactory('contracts/test/SimplePriceFeed.sol:SimplePriceFeed');
  const pcolFeed = await withRetry('PCOL feed', () =>
    SimplePriceFeed.deploy(100_000_000n, 8, { gasLimit: 50_000_000 }),
  );
  await pcolFeed.deployed();
  const now = Math.floor(Date.now() / 1000);
  await (await withRetry('setRoundData', () =>
    pcolFeed.setRoundData(1, 100_000_000n, now, now, 1, { gasLimit: 2_000_000 }),
  )).wait();
  console.log(`      ${pcolFeed.address}`);
  out.addresses.pcolFeed = pcolFeed.address;

  // ─────── 3. CometExt ───────
  console.log(`\n[3/8] CometExt…`);
  const CometExt = await ethers.getContractFactory('contracts/CometExt.sol:CometExt');
  const extConfig = {
    name32: ethers.utils.formatBytes32String('Compound USDC on Rome'),
    symbol32: ethers.utils.formatBytes32String('cUSDCv3'),
  };
  const cometExt = await withRetry('CometExt', () =>
    CometExt.deploy(extConfig, { gasLimit: 100_000_000 }),
  );
  await cometExt.deployed();
  console.log(`      ${cometExt.address}`);
  out.addresses.cometExt = cometExt.address;

  // ─────── 4. Comet impl V3 — WITH PCOL as collateral ───────
  console.log(`\n[4/8] Comet impl (V3, 1 collateral asset)…`);
  const cometConfig = {
    governor: admin.address,
    pauseGuardian: admin.address,
    baseToken: REUSE.unifiedToken,
    baseTokenPriceFeed: REUSE.usdcFeed,
    extensionDelegate: cometExt.address,
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
        asset: pcol.address,
        priceFeed: pcolFeed.address,
        decimals: 18,
        borrowCollateralFactor: ethers.BigNumber.from('700000000000000000'),    // 0.70
        liquidateCollateralFactor: ethers.BigNumber.from('800000000000000000'), // 0.80
        liquidationFactor: ethers.BigNumber.from('900000000000000000'),         // 0.90
        supplyCap: ethers.utils.parseUnits('100000', 18),                        // 100k PCOL cap
      },
    ],
  };
  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometImpl = await withRetry('Comet impl', () =>
    Comet.deploy(cometConfig, { gasLimit: 500_000_000 }),
  );
  await cometImpl.deployed();
  console.log(`      ${cometImpl.address}`);
  out.addresses.cometImpl = cometImpl.address;

  // ─────── 5. Configurator + ConfiguratorProxy + CometProxy ───────
  console.log(`\n[5/8] Configurator stack (fresh, reusing CometProxyAdmin)…`);
  const Configurator = await ethers.getContractFactory('contracts/Configurator.sol:Configurator');
  const configuratorImpl = await withRetry('Configurator impl', () =>
    Configurator.deploy({ gasLimit: 400_000_000 }),
  );
  await configuratorImpl.deployed();
  out.addresses.configuratorImpl = configuratorImpl.address;
  console.log(`      Configurator impl:  ${configuratorImpl.address}`);

  const ConfiguratorProxy = await ethers.getContractFactory('contracts/ConfiguratorProxy.sol:ConfiguratorProxy');
  const configInitData = configuratorImpl.interface.encodeFunctionData('initialize', [admin.address]);
  const configuratorProxy = await withRetry('ConfiguratorProxy', () =>
    ConfiguratorProxy.deploy(configuratorImpl.address, REUSE.cometProxyAdmin, configInitData, { gasLimit: 100_000_000 }),
  );
  await configuratorProxy.deployed();
  out.addresses.configuratorProxy = configuratorProxy.address;
  console.log(`      ConfiguratorProxy:  ${configuratorProxy.address}`);

  const TransparentUpgradeableProxy = await ethers.getContractFactory(
    'contracts/vendor/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
  );
  const cometProxy = await withRetry('CometProxy', () =>
    TransparentUpgradeableProxy.deploy(cometImpl.address, REUSE.cometProxyAdmin, '0x', { gasLimit: 100_000_000 }),
  );
  await cometProxy.deployed();
  out.addresses.cometProxy = cometProxy.address;
  console.log(`      CometProxy:         ${cometProxy.address}`);

  // ─────── 6. Initialize Comet ───────
  console.log(`\n[6/8] cometProxy.initializeStorage()…`);
  const cometIface = new ethers.utils.Interface(['function initializeStorage()']);
  const cometProxyCometSide = new ethers.Contract(cometProxy.address, cometIface, admin);
  const initTx = await withRetry('initializeStorage', () =>
    cometProxyCometSide.initializeStorage({ gasLimit: 5_000_000 }),
  );
  await initTx.wait();
  console.log(`      tx: ${initTx.hash}`);
  out.txReceipts.initializeStorage = initTx.hash;

  // ─────── 7. OrchestratorRouter (still useful for supply ↔ borrow demo) ───────
  console.log(`\n[7/8] OrchestratorRouter…`);
  const Router = await ethers.getContractFactory('OrchestratorRouter');
  const router = await withRetry('OrchestratorRouter', () =>
    Router.deploy(cometProxy.address, REUSE.unifiedToken, relayerAddr, { gasLimit: 50_000_000 }),
  );
  await router.deployed();
  out.addresses.orchestratorRouter = router.address;
  console.log(`      ${router.address}`);

  // ─────── 8. Wire pre-deposited caller roles ───────
  console.log(`\n[8/8] grantPreDepositedCaller(router) + grantPreDepositedCaller(cometProxy)…`);
  const tokenAdminAbi = [
    'function admin() view returns (address)',
    'function grantPreDepositedCaller(address) external',
    'function isPreDepositedCaller(address) view returns (bool)',
  ];
  const token = new ethers.Contract(REUSE.unifiedToken, tokenAdminAbi, admin);
  if (!(await token.isPreDepositedCaller(router.address))) {
    const t = await withRetry('grant router', () =>
      token.grantPreDepositedCaller(router.address, { gasLimit: 5_000_000 }),
    );
    await t.wait();
    out.txReceipts.grantRouter = t.hash;
    console.log(`      router granted: ${t.hash}`);
  } else {
    console.log(`      router already a pre-deposited caller`);
  }
  if (!(await token.isPreDepositedCaller(cometProxy.address))) {
    const t = await withRetry('grant comet', () =>
      token.grantPreDepositedCaller(cometProxy.address, { gasLimit: 5_000_000 }),
    );
    await t.wait();
    out.txReceipts.grantComet = t.hash;
    console.log(`      cometProxy granted: ${t.hash}`);
  } else {
    console.log(`      cometProxy already a pre-deposited caller`);
  }

  // ─────── Verifications ───────
  console.log(`\n[Verify] Smoke reads…`);
  const cometViaProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', cometProxy.address);
  out.verifications = {
    cometBaseToken: await cometViaProxy.baseToken(),
    cometNumAssets: (await cometViaProxy.numAssets()).toString(),
    cometAsset0:    await cometViaProxy.getAssetInfo(0).then((a: any) => ({ asset: a.asset, priceFeed: a.priceFeed, scale: a.scale.toString() })),
    pcolBalanceOfDeployer: (await pcol.balanceOf(admin.address)).toString(),
  };
  console.log(JSON.stringify(out.verifications, null, 2));

  const outPath = path.join(__dirname, 'phase4-deploy-with-collateral.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
  console.log(`══════ Phase 4 (collateral) Deploy COMPLETE ══════`);
}

main().catch((err) => { console.error(err); process.exit(1); });
