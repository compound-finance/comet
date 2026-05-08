// Phase 4 — continuation from step 8 (after init succeeded but Router deploy
// hit `insufficient gas: 25000000 30808000`). Steps 1-7 are live on Marcus.
// Bumping gasLimit to 50M for OrchestratorRouter.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const LIVE = {
  cometProxyAdmin: '0x41aE246D1D212e9E1999DC4D438bA810653c0e0E',
  unifiedToken:    '0xda16E38514eD2Fa5E6587028Efc22226deC97f7a',
  usdcFeed:        '0x52F2054AEB16F33b03C24910D1Ec82ca0ca0fB9d',
  cometExt:        '0x4c8181b8D754E948197e7260612b09a55116c18c',
  cometImpl:       '0xe912Dcef8a2EcD5d5AA3DAc0C185cb96662349eE',
  configuratorImpl:  '0xBFB8798Afa8a2220AF1F200F7202dab9C8C3b268',
  configuratorProxy: '0x552499fA76caF7e7e0917727D7B9405Fa5d84336',
  cometProxy:      '0x8E471Df008CaD1DDCb750902658B6b77668d9dBb',
};
const INIT_TX = '0x3aba957aa81fa1bd0317870015bb99add1de64abb7916b2c4fc5396be725ccb3';

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
  console.log(`Deployer: ${admin.address}`);
  console.log(`Relayer:  ${relayerAddr}`);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: admin.address,
    relayer: relayerAddr,
    addresses: { ...LIVE } as any,
    txReceipts: { initializeStorage: INIT_TX } as any,
    notes: [
      'Two-phase deploy: deploy-fresh.ts ran steps 1-6, hit `insufficient gas: 1000000 1673440` at step 7.',
      'continue-from-init.ts ran step 7 with bumped gasLimit, hit `insufficient gas: 25000000 30808000` at step 8.',
      'continue-from-step8.ts (this run): step 8-9 with gasLimit=50_000_000 for OrchestratorRouter.',
    ],
  };
  const outPath = path.join(__dirname, 'phase4-fresh-deploy.json');

  console.log(`\n[8/9] OrchestratorRouter (gasLimit=50M)…`);
  const Router = await ethers.getContractFactory('OrchestratorRouter');
  const router = await withRetry('OrchestratorRouter', () =>
    Router.deploy(LIVE.cometProxy, LIVE.unifiedToken, relayerAddr, { gasLimit: 50_000_000 }),
  );
  await router.deployed();
  console.log(`      ${router.address}`);
  out.addresses.orchestratorRouter = router.address;

  console.log(`\n[9/9] grantPreDepositedCaller…`);
  const tokenAdminAbi = [
    'function admin() view returns (address)',
    'function grantPreDepositedCaller(address) external',
    'function isPreDepositedCaller(address) view returns (bool)',
  ];
  const token = new ethers.Contract(LIVE.unifiedToken, tokenAdminAbi, admin);

  const grantRouterTx = await withRetry('grantPreDepositedCaller(router)', () =>
    token.grantPreDepositedCaller(router.address, { gasLimit: 5_000_000 }),
  );
  await grantRouterTx.wait();
  console.log(`      router granted: ${grantRouterTx.hash}`);
  out.txReceipts.grantRouter = grantRouterTx.hash;

  const grantCometTx = await withRetry('grantPreDepositedCaller(cometProxy)', () =>
    token.grantPreDepositedCaller(LIVE.cometProxy, { gasLimit: 5_000_000 }),
  );
  await grantCometTx.wait();
  console.log(`      cometProxy granted: ${grantCometTx.hash}`);
  out.txReceipts.grantComet = grantCometTx.hash;

  console.log(`\n[Verify] Smoke reads…`);
  const cometViaProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', LIVE.cometProxy);
  out.verifications = {
    cometBaseToken: await cometViaProxy.baseToken(),
    routerBaseAsset: await router.baseAsset(),
    routerComet: await router.comet(),
    routerUnifiedToken: await router.unifiedToken(),
    routerIsPreDeposited: await token.isPreDepositedCaller(router.address),
    cometIsPreDeposited: await token.isPreDepositedCaller(LIVE.cometProxy),
    relayerAuthorized: await router.authorizedRelayers(relayerAddr),
  };
  console.log(JSON.stringify(out.verifications, null, 2));

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}\n══════ Phase 4 Fresh Deploy COMPLETE ══════`);
}

main().catch((err) => { console.error(err); process.exit(1); });
