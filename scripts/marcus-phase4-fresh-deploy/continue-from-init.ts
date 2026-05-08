// Phase 4 — continuation from step 7 (initializeStorage onward).
// First deploy-fresh.ts run failed at step 7 with `insufficient gas:
// 1000000 1673440`. Steps 1-6 succeeded — addresses below are live on
// Marcus 121301 from that run. Bump gasLimit and resume.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';

const USDC_MINT_BS58 = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// Live addresses from the first partial run (2026-05-07T01:35Z, log at /tmp/phase4-deploy.log).
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

function bs58ToBytes32(b: string): string {
  const decoded = bs58.decode(b);
  return '0x' + Buffer.from(decoded).toString('hex');
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
  console.log(`Deployer: ${admin.address}`);
  console.log(`Relayer:  ${relayerAddr}`);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: admin.address,
    relayer: relayerAddr,
    usdcMint: USDC_MINT_BS58,
    usdcMintBytes32: bs58ToBytes32(USDC_MINT_BS58),
    addresses: { ...LIVE } as any,
    txReceipts: {} as any,
    notes: ['Continuation run after first attempt failed at step 7 with `insufficient gas: 1000000 1673440`. Bumped initializeStorage gasLimit to 5_000_000.'],
  };
  const outPath = path.join(__dirname, 'phase4-fresh-deploy.json');

  // ─────── 7. Initialize Comet via proxy (BUMPED gasLimit 5M) ───────
  console.log(`\n[7/9] cometProxy.initializeStorage() (gasLimit=5M)…`);
  const cometIface = new ethers.utils.Interface(['function initializeStorage()']);
  const cometProxyCometSide = new ethers.Contract(LIVE.cometProxy, cometIface, admin);
  const initTx = await withRetry('initializeStorage', () =>
    cometProxyCometSide.initializeStorage({ gasLimit: 5_000_000 }),
  );
  await initTx.wait();
  console.log(`      tx: ${initTx.hash}`);
  out.txReceipts.initializeStorage = initTx.hash;

  // ─────── 8. OrchestratorRouter ───────
  console.log(`\n[8/9] OrchestratorRouter…`);
  const Router = await ethers.getContractFactory('OrchestratorRouter');
  const router = await withRetry('OrchestratorRouter', () =>
    Router.deploy(LIVE.cometProxy, LIVE.unifiedToken, relayerAddr, { gasLimit: 25_000_000 }),
  );
  await router.deployed();
  console.log(`      ${router.address}`);
  out.addresses.orchestratorRouter = router.address;

  // ─────── 9. Wire pre-deposited caller roles ───────
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

  // ─────── Verifications ───────
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
