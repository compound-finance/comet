// Phase 4 — Fresh deploy of compound-on-rome-comet stack onto Marcus
// running rome-evm program `romedpkFKEu…` (PR #320 keccak selectors live).
//
// Differs from earlier phases:
//   - No WJITOSOL/COMP placeholders — those don't exist on the new Marcus
//     and supply-only bench doesn't need collateral assets.
//   - UnifiedToken (PR #4: spl_transfer_checked_v1 adoption) is the base
//     token from genesis — no placeholder-then-swap step.
//   - Comet impl V3.1 (PR #4: pre-deposited doTransferIn returns amount).
//   - OrchestratorRouter (PR #4: snapshot/complete/cancel + relayer auth)
//     deployed + wired in the same run.
//   - Phase A-style preflight: chainId + account_lamports check before
//     any on-chain action, fail fast if substrate is wrong.
//
// Run:
//   ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//   RELAYER_ADDRESS=0x56D704338cdE8602374E7dFd0D4BEAD125261AfD \
//   npx hardhat run scripts/marcus-phase4-fresh-deploy/deploy-fresh.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const EXPECTED_CHAIN_ID = 121301;

// Solana devnet USDC mint — backs the gas USDC + UnifiedToken + wUSDC.
// Sourced from registry/chains/121301-marcus/tokens.json (gas USDC entry).
const USDC_MINT_BS58 = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

// CPI precompile — for preflight account_lamports probe.
const CPI_PRECOMPILE = '0xff00000000000000000000000000000000000008';
const ACCOUNT_LAMPORTS_SELECTOR = '0xde79ed54';

function bs58ToBytes32(b: string): string {
  const decoded = bs58.decode(b);
  if (decoded.length !== 32) throw new Error(`bs58 not 32 bytes: ${decoded.length}`);
  return '0x' + Buffer.from(decoded).toString('hex');
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 12): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = (e.message || JSON.stringify(e)).slice(0, 150);
      console.log(`  [retry ${i + 1}/${attempts}] ${label}: ${msg}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function preflight(deployerAddr: string): Promise<void> {
  // chainId
  const chainIdRes = await fetch(MARCUS_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
  }).then((r) => r.json() as any);
  const chainId = parseInt(chainIdRes.result, 16);
  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(`Marcus chainId mismatch: got ${chainId}, expected ${EXPECTED_CHAIN_ID}`);
  }
  console.log(`  ✓ chainId = ${chainId}`);

  // account_lamports on USDC mint — proves PR #320 v2 selectors are wired.
  const data = ACCOUNT_LAMPORTS_SELECTOR + bs58ToBytes32(USDC_MINT_BS58).slice(2);
  const lamportsRes = await fetch(MARCUS_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'eth_call',
      params: [{ to: CPI_PRECOMPILE, data }, 'latest'],
    }),
  }).then((r) => r.json() as any);
  if (lamportsRes.error) {
    throw new Error(`account_lamports preflight failed: ${JSON.stringify(lamportsRes.error)}`);
  }
  const lamports = BigInt(lamportsRes.result);
  if (lamports === 0n) {
    throw new Error(`USDC mint reports 0 lamports — mint not initialized on this chain?`);
  }
  console.log(`  ✓ account_lamports(USDC_MINT) = ${lamports} (PR #320 v2 selectors wired)`);

  // Deployer balance
  const balRes = await fetch(MARCUS_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 3, method: 'eth_getBalance',
      params: [deployerAddr, 'latest'],
    }),
  }).then((r) => r.json() as any);
  const bal = ethers.BigNumber.from(balRes.result);
  console.log(`  ✓ deployer balance: ${ethers.utils.formatEther(bal)} USDC (gas)`);
  const minBal = ethers.utils.parseEther('1');
  if (bal.lt(minBal)) {
    throw new Error(`deployer balance ${ethers.utils.formatEther(bal)} USDC < 1 USDC minimum — top up first`);
  }
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`\n══════ Phase 4 Fresh Deploy ══════`);
  console.log(`Deployer: ${admin.address}`);

  const relayerAddr = process.env.RELAYER_ADDRESS;
  if (!relayerAddr || !ethers.utils.isAddress(relayerAddr)) {
    throw new Error(`Set RELAYER_ADDRESS env var. Got: ${relayerAddr ?? '(unset)'}`);
  }
  console.log(`Relayer:  ${relayerAddr}`);

  console.log(`\n[Preflight] Verifying substrate…`);
  await preflight(admin.address);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: EXPECTED_CHAIN_ID,
    deployer: admin.address,
    relayer: relayerAddr,
    usdcMint: USDC_MINT_BS58,
    usdcMintBytes32: bs58ToBytes32(USDC_MINT_BS58),
    addresses: {} as any,
    txReceipts: {} as any,
    notes: [] as string[],
  };
  const outPath = path.join(__dirname, 'phase4-fresh-deploy.json');

  // ─────── 1. CometProxyAdmin ───────
  console.log(`\n[1/9] CometProxyAdmin…`);
  const CometProxyAdmin = await ethers.getContractFactory('contracts/CometProxyAdmin.sol:CometProxyAdmin');
  const cometAdmin = await withRetry('CometProxyAdmin', () =>
    CometProxyAdmin.deploy(admin.address, { gasLimit: 100_000_000 }),
  );
  await cometAdmin.deployed();
  console.log(`      ${cometAdmin.address}`);
  out.addresses.cometProxyAdmin = cometAdmin.address;

  // ─────── 2. UnifiedToken (PR #4: spl_transfer_checked_v1 adoption) ───────
  console.log(`\n[2/9] UnifiedToken (USDC mint=${USDC_MINT_BS58.slice(0, 10)}…)…`);
  const UnifiedToken = await ethers.getContractFactory('contracts/unified-token/UnifiedToken.sol:UnifiedToken');
  const unifiedToken = await withRetry('UnifiedToken', () =>
    UnifiedToken.deploy(
      bs58ToBytes32(USDC_MINT_BS58),
      'Compound Unified USDC',
      'cUSDC',
      6,                          // MUST match underlying SPL mint decimals
      admin.address,
      { gasLimit: 200_000_000 },
    ),
  );
  await unifiedToken.deployed();
  console.log(`      ${unifiedToken.address}`);
  out.addresses.unifiedToken = unifiedToken.address;

  // ─────── 3. SimplePriceFeed for USDC ($1.00, 8 decimals = Chainlink format) ───────
  console.log(`\n[3/9] SimplePriceFeed (USDC = $1.00)…`);
  const SimplePriceFeed = await ethers.getContractFactory('contracts/test/SimplePriceFeed.sol:SimplePriceFeed');
  const usdcFeed = await withRetry('SimplePriceFeed', () =>
    SimplePriceFeed.deploy(100_000_000n, 8, { gasLimit: 50_000_000 }),
  );
  await usdcFeed.deployed();
  const now = Math.floor(Date.now() / 1000);
  await (await withRetry('setRoundData', () =>
    usdcFeed.setRoundData(1, 100_000_000n, now, now, 1, { gasLimit: 2_000_000 }),
  )).wait();
  console.log(`      ${usdcFeed.address}`);
  out.addresses.usdcFeed = usdcFeed.address;

  // ─────── 4. CometExt ───────
  console.log(`\n[4/9] CometExt…`);
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

  // ─────── 5. Comet impl V3 (PR #4 doTransferIn fix) — supply-only, no collateral ───────
  console.log(`\n[5/9] Comet impl (V3, no collateral assets)…`);
  const cometConfig = {
    governor: admin.address,
    pauseGuardian: admin.address,
    baseToken: unifiedToken.address,
    baseTokenPriceFeed: usdcFeed.address,
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
    assetConfigs: [],
  };
  const Comet = await ethers.getContractFactory('contracts/Comet.sol:Comet');
  const cometImpl = await withRetry('Comet impl', () =>
    Comet.deploy(cometConfig, { gasLimit: 500_000_000 }),
  );
  await cometImpl.deployed();
  console.log(`      ${cometImpl.address}`);
  out.addresses.cometImpl = cometImpl.address;

  // ─────── 6. Configurator + ConfiguratorProxy + CometProxy ───────
  console.log(`\n[6/9] Configurator stack…`);
  const Configurator = await ethers.getContractFactory('contracts/Configurator.sol:Configurator');
  const configuratorImpl = await withRetry('Configurator impl', () =>
    Configurator.deploy({ gasLimit: 400_000_000 }),
  );
  await configuratorImpl.deployed();
  console.log(`      Configurator impl:  ${configuratorImpl.address}`);
  out.addresses.configuratorImpl = configuratorImpl.address;

  const ConfiguratorProxy = await ethers.getContractFactory('contracts/ConfiguratorProxy.sol:ConfiguratorProxy');
  const configInitData = configuratorImpl.interface.encodeFunctionData('initialize', [admin.address]);
  const configuratorProxy = await withRetry('ConfiguratorProxy', () =>
    ConfiguratorProxy.deploy(configuratorImpl.address, cometAdmin.address, configInitData, { gasLimit: 100_000_000 }),
  );
  await configuratorProxy.deployed();
  console.log(`      ConfiguratorProxy:  ${configuratorProxy.address}`);
  out.addresses.configuratorProxy = configuratorProxy.address;

  const TransparentUpgradeableProxy = await ethers.getContractFactory(
    'contracts/vendor/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy',
  );
  const cometProxy = await withRetry('CometProxy', () =>
    TransparentUpgradeableProxy.deploy(cometImpl.address, cometAdmin.address, '0x', { gasLimit: 100_000_000 }),
  );
  await cometProxy.deployed();
  console.log(`      CometProxy:         ${cometProxy.address}`);
  out.addresses.cometProxy = cometProxy.address;

  // ─────── 7. Initialize Comet via proxy ───────
  console.log(`\n[7/9] cometProxy.initializeStorage()…`);
  const cometIface = new ethers.utils.Interface(['function initializeStorage()']);
  const cometProxyCometSide = new ethers.Contract(cometProxy.address, cometIface, admin);
  const initTx = await withRetry('initializeStorage', () =>
    cometProxyCometSide.initializeStorage({ gasLimit: 5_000_000 }),
  );
  await initTx.wait();
  console.log(`      tx: ${initTx.hash}`);
  out.txReceipts.initializeStorage = initTx.hash;

  // ─────── 8. OrchestratorRouter (PR #4: snapshot/complete/cancel + relayer auth) ───────
  console.log(`\n[8/9] OrchestratorRouter…`);
  const Router = await ethers.getContractFactory('OrchestratorRouter');
  const router = await withRetry('OrchestratorRouter', () =>
    Router.deploy(cometProxy.address, unifiedToken.address, relayerAddr, { gasLimit: 50_000_000 }),
  );
  await router.deployed();
  console.log(`      ${router.address}`);
  out.addresses.orchestratorRouter = router.address;

  // ─────── 9. Wire pre-deposited caller roles ───────
  console.log(`\n[9/9] grantPreDepositedCaller(router) + grantPreDepositedCaller(cometProxy)…`);
  const tokenAdminAbi = [
    'function admin() view returns (address)',
    'function grantPreDepositedCaller(address) external',
    'function isPreDepositedCaller(address) view returns (bool)',
  ];
  const token = new ethers.Contract(unifiedToken.address, tokenAdminAbi, admin);
  const grantRouterTx = await withRetry('grantPreDepositedCaller(router)', () =>
    token.grantPreDepositedCaller(router.address, { gasLimit: 5_000_000 }),
  );
  await grantRouterTx.wait();
  console.log(`      router granted: ${grantRouterTx.hash}`);
  out.txReceipts.grantRouter = grantRouterTx.hash;

  const grantCometTx = await withRetry('grantPreDepositedCaller(cometProxy)', () =>
    token.grantPreDepositedCaller(cometProxy.address, { gasLimit: 5_000_000 }),
  );
  await grantCometTx.wait();
  console.log(`      cometProxy granted: ${grantCometTx.hash}`);
  out.txReceipts.grantComet = grantCometTx.hash;

  // ─────── Verifications ───────
  console.log(`\n[Verify] Smoke reads…`);
  const cometViaProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', cometProxy.address);
  out.verifications = {
    cometBaseToken: await cometViaProxy.baseToken(),
    routerBaseAsset: await router.baseAsset(),
    routerComet: await router.comet(),
    routerUnifiedToken: await router.unifiedToken(),
    routerIsPreDeposited: await token.isPreDepositedCaller(router.address),
    cometIsPreDeposited: await token.isPreDepositedCaller(cometProxy.address),
    relayerAuthorized: await router.authorizedRelayers(relayerAddr),
  };
  console.log(JSON.stringify(out.verifications, null, 2));

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nResults: ${outPath}`);
  console.log(`\n══════ Phase 4 Fresh Deploy COMPLETE ══════`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
