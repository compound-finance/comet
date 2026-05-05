// Phase 1.4 — Marcus integration smoke + CU measurement of UnifiedToken.
//
// Strategy:
//   1. Deploy a UnifiedToken instance pointing at Solana devnet USDC mint.
//   2. Measure basic transfer + transferFrom + approve CU.
//   3. Compare against Phase 0 baseline (USDC mock placeholder).
//
// Hard constraint: stay within 30 USDC of deployer balance.
//
// Notes:
//   - Solana devnet USDC mint: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
//     bs58-decoded to bytes32 LE = (computed at runtime via bs58 lib)
//   - balanceOf reads the user's AUTHORITY_PDA's ATA on-chain.
//   - transfer() will issue a signed CPI to SPL Token transfer_checked.
//   - The deployer is unlikely to have a funded ATA at AUTHORITY_PDA, so
//     transfer will fail at the SPL "insufficient balance" stage. We measure
//     transfer's CU through the revert path; the EVM-side overhead is what
//     we want.
//   - For a full success path, the deployer's AUTHORITY_PDA's ATA must be
//     pre-funded. The test logs both paths.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import bs58 from 'bs58';

// Phase 0 anchors
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const COMET_REWARDS = '0x29142D91E5fe7EdD534f0783612a076E4309Dc24';

// Solana devnet USDC mint (per task spec)
const USDC_MINT_BS58 = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';

function bs58ToBytes32(b: string): string {
  const decoded = bs58.decode(b);
  if (decoded.length !== 32) throw new Error(`bs58 not 32 bytes: ${decoded.length}`);
  return '0x' + Buffer.from(decoded).toString('hex');
}

async function rawRpc(url: string, method: string, params: any[]): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return await r.json();
}

interface Measurement {
  txHash?: string;
  evmGas?: string;
  blockNumber?: number;
  solanaTxs?: string[];
  computeUnits?: number[];
  accountCount?: number;
  txSize?: number;
  txVersion?: string;
  error?: string;
  reverted?: boolean;
}

async function measureTx(
  label: string,
  sendFn: () => Promise<ethers.ContractTransaction>,
  expectRevert = false,
): Promise<Measurement> {
  console.log(`  [${label}]`);
  const m: Measurement = {};
  try {
    const tx = await sendFn();
    m.txHash = tx.hash;
    try {
      const receipt = await tx.wait();
      m.evmGas = receipt.gasUsed.toString();
      m.blockNumber = receipt.blockNumber;
      m.reverted = receipt.status === 0;
    } catch (waitErr: any) {
      m.reverted = true;
      m.error = String(waitErr.message).slice(0, 200);
    }

    // Wait briefly for hercules to index, then ask for the Solana sigs
    await new Promise((r) => setTimeout(r, 4000));
    const solRes = await rawRpc(MARCUS_RPC, 'rome_solanaTxForEvmTx', [tx.hash]);
    m.solanaTxs = solRes.result || [];

    const cus: number[] = [];
    let totalAccountCount = 0;
    let totalTxSize = 0;
    let txVersion = 'unknown';
    for (const sig of m.solanaTxs || []) {
      const txInfo = await rawRpc(SOLANA_RPC, 'getTransaction', [
        sig,
        { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
      ]);
      const info = txInfo?.result;
      if (info) {
        if (info.meta?.computeUnitsConsumed) cus.push(info.meta.computeUnitsConsumed);
        if (info.transaction?.message?.accountKeys) {
          totalAccountCount = Math.max(totalAccountCount, info.transaction.message.accountKeys.length);
        }
        if (info.version) txVersion = String(info.version);
      }
    }
    m.computeUnits = cus;
    m.accountCount = totalAccountCount;
    m.txVersion = txVersion;

    console.log(
      `    txHash=${tx.hash}  evmGas=${m.evmGas}  reverted=${m.reverted}  solSigs=${(m.solanaTxs || []).length}  CU=${cus.join(',')}  accts=${totalAccountCount}  ver=${txVersion}`
    );
  } catch (e: any) {
    m.error = e.message?.slice(0, 200);
    console.log(`    ERROR: ${m.error}`);
    if (!expectRevert) throw e;
  }
  return m;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log('Deployer:', deployer.address);
  const balPre = await deployer.getBalance();
  // Rome's gas-token balance is reported in wei-equivalent (1e18) on the EVM RPC,
  // even though the underlying Solana SPL is 6 decimals. ethers' formatEther
  // uses 1e18 — so to display "USDC" we use formatEther.
  console.log('Pre-balance (gas-wei):', balPre.toString());
  console.log('Pre-balance (USDC ~):', ethers.utils.formatEther(balPre));

  const usdcMintBytes32 = bs58ToBytes32(USDC_MINT_BS58);
  console.log('USDC mint bytes32:', usdcMintBytes32);

  const out: any = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: deployer.address,
    inputs: {
      usdcMintBs58: USDC_MINT_BS58,
      usdcMintBytes32,
      cometProxy: COMET_PROXY,
      cometRewards: COMET_REWARDS,
    },
    measurements: {},
    notes: [
      'Phase 1.4 — UnifiedToken Marcus integration smoke + CU measurement',
      'Deploys a UnifiedToken bound to Solana devnet USDC mint',
      'transfer/transferFrom CPIs sign as msg.sender AUTHORITY_PDA — see Phase 1 memo §Cross-impl drift for the integration nuance',
    ],
  };
  const outPath = path.join(__dirname, 'phase1-measurements.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Step 1: Deploy UnifiedToken
  console.log('\n[1] Deploying UnifiedToken...');
  const T = await ethers.getContractFactory('UnifiedToken');
  let token: any;
  try {
    token = await T.deploy(
      usdcMintBytes32,
      'Unified USDC',
      'USDC',
      6,
      deployer.address,
      { gasLimit: 90_000_000 },
    );
    await token.deployed();
    console.log('  UnifiedToken:', token.address);
    out.deployments = { unifiedToken: token.address };
  } catch (e: any) {
    console.log('  DEPLOY FAILED:', e.message?.slice(0, 200));
    out.deployErr = e.message;
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    return;
  }

  // Step 2: Read static state
  console.log('\n[2] Reading state...');
  try {
    const m = await token.mintId();
    const n = await token.name();
    const s = await token.symbol();
    const d = await token.decimals();
    console.log('  mintId:', m);
    console.log('  name:', n);
    console.log('  symbol:', s);
    console.log('  decimals:', d);
    out.staticState = { mintId: m, name: n, symbol: s, decimals: d };
  } catch (e: any) {
    console.log('  state read FAILED:', e.message?.slice(0, 200));
  }

  // Step 3: ATA derivation read (pure on-chain compute)
  console.log('\n[3] solanaAtaOf(deployer)...');
  try {
    const ata = await token.solanaAtaOf(deployer.address);
    console.log('  deployer ATA bytes32:', ata);
    console.log('  deployer ATA bs58:', bs58.encode(Buffer.from(ata.slice(2), 'hex')));
    out.staticState = { ...out.staticState, deployerAta: ata };
  } catch (e: any) {
    console.log('  ATA derivation FAILED:', e.message?.slice(0, 200));
  }

  // Step 4: balanceOf read
  console.log('\n[4] balanceOf(deployer) — reads user AUTHORITY_PDA ATA on Solana...');
  try {
    const bal = await token.balanceOf(deployer.address);
    console.log('  balance (USDC.e6):', bal.toString());
    out.staticState = { ...out.staticState, deployerBalance: bal.toString() };
  } catch (e: any) {
    console.log('  balanceOf FAILED:', e.message?.slice(0, 200));
  }

  // Step 5: approve (EVM-side mapping write only — but goes through Rome iter VM)
  out.measurements.approve = await measureTx(
    `unifiedToken.approve(comet, max)`,
    () => token.approve(COMET_PROXY, ethers.constants.MaxUint256, { gasLimit: 5_000_000 }),
    /*expectRevert*/ true,
  );

  // Step 6: small transfer to self (zero-amount baseline; emits Transfer event).
  // Zero-amount avoids the SPL "insufficient balance" branch but the contract
  // still issues the CPI. Gives us pure CPI overhead measurement when deployer
  // has no USDC.
  out.measurements.transferZeroSelf = await measureTx(
    `unifiedToken.transfer(self, 0)`,
    () => token.transfer(deployer.address, 0, { gasLimit: 8_000_000 }),
    /*expectRevert*/ true,
  );

  // Step 7: small transfer 1 unit to a fresh address (typical user-pattern;
  // will revert at SPL.transfer_checked since deployer's AUTHORITY_PDA ATA
  // is empty. The CU is measured through the revert path.)
  const FRESH = '0x000000000000000000000000000000000000beef';
  out.measurements.transferOneToFresh = await measureTx(
    `unifiedToken.transfer(0xbeef, 1)`,
    () => token.transfer(FRESH, 1, { gasLimit: 8_000_000 }),
    /*expectRevert*/ true,
  );

  // Step 8: grant pre-deposited role to deployer (admin op)
  out.measurements.grantRole = await measureTx(
    `unifiedToken.grantPreDepositedCaller(deployer)`,
    () => token.grantPreDepositedCaller(deployer.address, { gasLimit: 5_000_000 }),
    /*expectRevert*/ true,
  );

  // Step 9: snapshot a fake recipient ATA. Will succeed even if the ATA doesn't
  // exist (loadTokenAmount returns 0 for empty data per SplDataParser).
  const FAKE_RECIPIENT_ATA = '0x' + 'aa'.repeat(32);
  out.measurements.snapshotAta = await measureTx(
    `unifiedToken.snapshotAta(fakeAta)`,
    () => token.snapshotAta(FAKE_RECIPIENT_ATA, { gasLimit: 5_000_000 }),
    /*expectRevert*/ true,
  );

  // Step 10: transferFromPreDeposited reverts because no balance change
  // happened (delta = 0 < value=1). The contract's verify path is exercised
  // even on revert.
  out.measurements.preDepositedRevert = await measureTx(
    `unifiedToken.transferFromPreDeposited(...) — empty delta revert`,
    () => token.transferFromPreDeposited(
      deployer.address, deployer.address, FAKE_RECIPIENT_ATA, 1, { gasLimit: 5_000_000 }
    ),
    /*expectRevert*/ true,
  );

  // Step 11: revoke role (admin)
  out.measurements.revokeRole = await measureTx(
    `unifiedToken.revokePreDepositedCaller(deployer)`,
    () => token.revokePreDepositedCaller(deployer.address, { gasLimit: 5_000_000 }),
    /*expectRevert*/ true,
  );

  console.log('\nSaving results...');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('  →', outPath);

  const balPost = await deployer.getBalance();
  console.log('\nPost-balance (gas-wei):', balPost.toString());
  console.log('Spent (gas-wei):', balPre.sub(balPost).toString());
  console.log('Spent (USDC ~):', ethers.utils.formatEther(balPre.sub(balPost)));
  out.spent = {
    preWei: balPre.toString(),
    postWei: balPost.toString(),
    diffWei: balPre.sub(balPost).toString(),
    diffUsdc: ethers.utils.formatEther(balPre.sub(balPost)),
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
