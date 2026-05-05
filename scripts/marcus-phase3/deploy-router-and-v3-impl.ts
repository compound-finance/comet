// Phase 3 — Deploy OrchestratorRouter and Comet V3 (with patched doTransferIn).
//
// Steps:
//   1. Deploy a fresh Comet impl from the V3 Comet.sol (which contains the
//      pre-deposited branch in doTransferIn). All other config matches the
//      Phase 2 V2 impl exactly.
//   2. Upgrade the existing CometProxy (0x458fd96E…) → V3 impl.
//   3. Deploy OrchestratorRouter(comet=cometProxy, unifiedToken=UnifiedToken V2).
//   4. Grant pre-deposited caller role to:
//        a. The router (so its supplyForUser path works)
//        b. The Comet proxy (so its doTransferIn V3 branch works for non-router
//           callers — e.g., an EVM-lane user calling supply directly with
//           pre-deposited USDC; not used in Phase 3 demo but kept for
//           completeness)
//   5. Smoke-read: comet.baseToken(), router.baseAsset(), totals.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const ADDR = {
  WJITOSOL: '0x408724bD7A645761873a639dCB50C31FD3E371f4',
  COMP: '0xfc3D32a2fc5790485f1683e52bFBA2B1F613621e',
  USDC_FEED: '0xCD7bE9AC42dc73a4E618b8164820F8b3CF742714',
  SOL_USD_FEED: '0x6FcE6648C0350e3f7dA0C0f432405df98dD0D12E',
  COMET_PROXY: '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c',
  COMET_PROXY_ADMIN: '0xC75611c265C3c03357D5f9CF5883967150E6782C',
  COMET_EXT: '0x85D80481244761Bc40800Ec108BF6bFB2AFD9339',
  UNIFIED_TOKEN_V2: '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31',
};

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Deployer: ${signer.address}`);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: signer.address,
    inputs: ADDR,
    deployments: {} as any,
    notes: [] as string[],
  };

  // ─────── Step 1: Deploy V3 Comet impl ───────
  const config = {
    governor: signer.address,
    pauseGuardian: signer.address,
    baseToken: ADDR.UNIFIED_TOKEN_V2,
    baseTokenPriceFeed: ADDR.USDC_FEED,
    extensionDelegate: ADDR.COMET_EXT,
    supplyKink: BigInt('800000000000000000'),
    supplyPerYearInterestRateSlopeLow: BigInt('40000000000000000'),
    supplyPerYearInterestRateSlopeHigh: BigInt('400000000000000000'),
    supplyPerYearInterestRateBase: 0n,
    borrowKink: BigInt('800000000000000000'),
    borrowPerYearInterestRateSlopeLow: BigInt('60000000000000000'),
    borrowPerYearInterestRateSlopeHigh: BigInt('400000000000000000'),
    borrowPerYearInterestRateBase: BigInt('20000000000000000'),
    storeFrontPriceFactor: BigInt('500000000000000000'),
    trackingIndexScale: BigInt('1000000000000000'),
    baseTrackingSupplySpeed: 0n,
    baseTrackingBorrowSpeed: 0n,
    baseMinForRewards: 1_000_000n,
    baseBorrowMin: 1_000_000n,
    targetReserves: 0n,
    assetConfigs: [
      {
        asset: ADDR.WJITOSOL,
        priceFeed: ADDR.SOL_USD_FEED,
        decimals: 9,
        borrowCollateralFactor: BigInt('700000000000000000'),
        liquidateCollateralFactor: BigInt('800000000000000000'),
        liquidationFactor: BigInt('900000000000000000'),
        supplyCap: BigInt('100000000000000'),
      },
    ],
  };

  console.log('\n[1/5] Deploying Comet V3 impl (Phase 3 doTransferIn patch)…');
  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometV3 = await Comet.deploy(config, { gasLimit: 200_000_000 });
  await cometV3.deployed();
  console.log(`  Comet V3 impl: ${cometV3.address}`);
  out.deployments.cometImplV3 = cometV3.address;

  // ─────── Step 2: Upgrade proxy → V3 ───────
  console.log('\n[2/5] Upgrading CometProxy → V3 via ProxyAdmin…');
  const ProxyAdminAbi = [
    'function upgrade(address proxy, address implementation) external',
    'function getProxyImplementation(address proxy) external view returns (address)',
    'function owner() external view returns (address)',
  ];
  const proxyAdmin = new ethers.Contract(ADDR.COMET_PROXY_ADMIN, ProxyAdminAbi, signer);
  const owner = await proxyAdmin.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`Deployer is not ProxyAdmin owner (owner=${owner})`);
  }
  const priorImpl = await proxyAdmin.getProxyImplementation(ADDR.COMET_PROXY);
  console.log(`  Prior impl: ${priorImpl}`);
  out.priorImpl = priorImpl;

  const upgradeTx = await proxyAdmin.upgrade(ADDR.COMET_PROXY, cometV3.address, { gasLimit: 5_000_000 });
  const upgradeRcpt = await upgradeTx.wait();
  console.log(`  upgrade tx: ${upgradeTx.hash}`);
  out.deployments.upgradeTx = upgradeTx.hash;
  out.deployments.upgradeBlock = upgradeRcpt.blockNumber;

  const newImpl = await proxyAdmin.getProxyImplementation(ADDR.COMET_PROXY);
  console.log(`  Post-upgrade impl: ${newImpl}`);
  if (newImpl.toLowerCase() !== cometV3.address.toLowerCase()) {
    throw new Error(`Post-upgrade impl mismatch — got ${newImpl}, expected ${cometV3.address}`);
  }

  // ─────── Step 3: Deploy OrchestratorRouter ───────
  console.log('\n[3/5] Deploying OrchestratorRouter…');
  const Router = await ethers.getContractFactory('OrchestratorRouter');
  const router = await Router.deploy(ADDR.COMET_PROXY, ADDR.UNIFIED_TOKEN_V2, { gasLimit: 25_000_000 });
  await router.deployed();
  console.log(`  OrchestratorRouter: ${router.address}`);
  out.deployments.orchestratorRouter = router.address;

  // ─────── Step 4: Grant pre-deposited caller roles ───────
  console.log('\n[4/5] Granting pre-deposited caller roles…');
  const tokenAdminAbi = [
    'function admin() view returns (address)',
    'function grantPreDepositedCaller(address) external',
    'function isPreDepositedCaller(address) view returns (bool)',
  ];
  const token = new ethers.Contract(ADDR.UNIFIED_TOKEN_V2, tokenAdminAbi, signer);
  const tokenAdmin = await token.admin();
  console.log(`  UnifiedToken.admin: ${tokenAdmin}`);
  if (tokenAdmin.toLowerCase() !== signer.address.toLowerCase()) {
    out.notes.push(`WARN: deployer not UnifiedToken admin (got ${tokenAdmin})`);
  } else {
    if (!(await token.isPreDepositedCaller(router.address))) {
      const t = await token.grantPreDepositedCaller(router.address, { gasLimit: 5_000_000 });
      await t.wait();
      console.log(`  granted router (${router.address})`);
      out.deployments.grantRouterTx = t.hash;
    }
    if (!(await token.isPreDepositedCaller(ADDR.COMET_PROXY))) {
      const t = await token.grantPreDepositedCaller(ADDR.COMET_PROXY, { gasLimit: 5_000_000 });
      await t.wait();
      console.log(`  granted comet proxy (${ADDR.COMET_PROXY})`);
      out.deployments.grantCometTx = t.hash;
    }
  }

  // ─────── Step 5: Smoke reads ───────
  console.log('\n[5/5] Smoke reads…');
  const cometViaProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', ADDR.COMET_PROXY);
  out.verifications = {
    cometBaseToken: await cometViaProxy.baseToken(),
    routerBaseAsset: await router.baseAsset(),
    routerComet: await router.comet(),
    routerUnifiedToken: await router.unifiedToken(),
    routerIsPreDeposited: await token.isPreDepositedCaller(router.address),
    cometIsPreDeposited: await token.isPreDepositedCaller(ADDR.COMET_PROXY),
  };
  console.log(JSON.stringify(out.verifications, null, 2));

  const outPath = path.join(__dirname, 'phase3-deploy-results.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
