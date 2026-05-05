// Measure buyCollateral on cometV2 (CometHarness used in absorb stage).
// Pre-condition: cometV2 needs jitoSOL ERC20 reserves. Transfer some directly.
//
// Run: ETH_PK=$(cat ~/rome/.secrets/marcus/deployer.key) \
//      npx hardhat run scripts/marcus-phase0/measure-buycollateral.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const USDC = '0x14D9359B6F72CbAa25c54fedd5846B26965716e4';
const WJITOSOL = '0x408724bD7A645761873a639dCB50C31FD3E371f4';
const COMET_V2 = '0x6dba2EFF3E118374957b8BeD296cF976906bFC63';
const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';
const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';

function exp(amount: number, decimals: number): bigint {
  if (Number.isInteger(amount)) return BigInt(amount) * 10n ** BigInt(decimals);
  return BigInt(Math.round(amount * 1e6)) * 10n ** BigInt(decimals - 6);
}

async function rawRpc(url: string, method: string, params: any[]): Promise<any> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return await r.json();
}

async function captureSolanaSig(sig: string) {
  const txInfo = await rawRpc(SOLANA_RPC, 'getTransaction', [
    sig,
    { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ]);
  const info = txInfo?.result;
  if (!info) return {};
  const cu = info.meta?.computeUnitsConsumed;
  const accts = info.transaction?.message?.accountKeys?.length;
  const enc = await rawRpc(SOLANA_RPC, 'getTransaction', [
    sig,
    { encoding: 'base64', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
  ]);
  const b64 = enc?.result?.transaction?.[0];
  const size = b64 ? Buffer.from(b64, 'base64').length : undefined;
  const version = info.version === 'legacy' || info.version === 0 ? 'legacy' : `v${info.version}`;
  return { cu, accts, size, version };
}

async function measureTxFull(label: string, signer: ethers.Signer, sendFn: () => Promise<any>) {
  const m: any = {};
  try {
    const tx = await sendFn();
    m.txHash = tx.hash;
    const receipt = await tx.wait();
    m.evmGas = receipt.gasUsed.toString();
    m.blockNumber = receipt.blockNumber;
    await new Promise((r) => setTimeout(r, 4000));
    const solRes = await rawRpc(MARCUS_RPC, 'rome_solanaTxForEvmTx', [tx.hash]);
    m.solanaTxs = solRes.result || [];
    const cus: number[] = [];
    const accts: number[] = [];
    const sizes: number[] = [];
    const versions: string[] = [];
    for (const sig of m.solanaTxs || []) {
      const cap = await captureSolanaSig(sig);
      if (cap.cu !== undefined) cus.push(cap.cu);
      if (cap.accts !== undefined) accts.push(cap.accts);
      if (cap.size !== undefined) sizes.push(cap.size);
      if (cap.version !== undefined) versions.push(cap.version);
    }
    m.computeUnits = cus;
    m.accountCounts = accts;
    m.txSizes = sizes;
    m.versions = versions;
    console.log(`  [${label}]  CU=${cus.join(',')}  accts=${accts.join(',')}  size=${sizes.join(',')}`);
  } catch (e: any) {
    m.error = e.message?.slice(0, 250);
    console.log(`  [${label}]  ERROR: ${m.error}`);
  }
  return m;
}

async function main() {
  const [admin] = await ethers.getSigners();
  console.log('Admin:', admin.address);
  const usdc = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', USDC);
  const wjitoSol = await ethers.getContractAt('contracts/test/FaucetToken.sol:StandardToken', WJITOSOL);
  const cometV2 = await ethers.getContractAt('contracts/test/CometHarness.sol:CometHarness', COMET_V2);

  // 1. Transfer 1 wjitoSOL to cometV2 to create reserves (post-absorb totalsCollateral[jitoSOL]=0)
  const cv2WjBal = await wjitoSol.balanceOf(COMET_V2);
  console.log('cometV2 jitoSOL balance:', ethers.utils.formatUnits(cv2WjBal, 9));
  if (cv2WjBal.lt(exp(1, 9))) {
    console.log('-- transferring 1 wjitoSOL to cometV2 (creates reserves) --');
    await (await wjitoSol.transfer(COMET_V2, exp(1, 9), { gasLimit: 3_000_000 })).wait();
  }

  // 2. Check reserves
  const reserves = await cometV2.getCollateralReserves(WJITOSOL);
  console.log('jitoSOL reserves:', ethers.utils.formatUnits(reserves, 9));

  // 3. Check USDC allowance to cometV2
  const allowance = await usdc.allowance(admin.address, COMET_V2);
  if (allowance.eq(0)) {
    console.log('-- approving USDC → cometV2 --');
    await (await usdc.approve(COMET_V2, ethers.constants.MaxUint256, { gasLimit: 3_000_000 })).wait();
  }

  // 4. buyCollateral: spend 5 USDC for at least 0.05 wjitoSOL
  const meas = await measureTxFull(
    'cometV2.buyCollateral(jitoSOL, 0.05e9, 5e6, admin)',
    admin,
    () => cometV2.buyCollateral(WJITOSOL, exp(0.05, 9), exp(5, 6), admin.address, { gasLimit: 8_000_000 })
  );
  meas.semantic = 'spot purchase from absorbed reserves';
  meas.txHash && console.log('  txHash:', meas.txHash);

  // Persist back to phase0-borrow-absorb.json
  const outPath = path.join(__dirname, 'phase0-borrow-absorb.json');
  const out = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  out.measurements.buyCollateral = meas;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('Saved.');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
