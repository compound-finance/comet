// Phase E e2e smoke: drive the EVM-lane supply flow end-to-end against
// a running relayer + Marcus.
//
//   1. POST /intent { evmAddress, amount } — relayer takes snapshot
//   2. Poll until awaiting-deposit
//   3. Sign unifiedToken.transfer(comet, amount) (this script's signer)
//   4. Poll until complete — relayer fired completeSupplyForUserEvm
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      RELAYER_URL=http://localhost:8787 \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/smoke-evm-lane-supply.ts --network marcus

import { ethers } from 'hardhat';

const ADDR = {
  unifiedToken: '0xe76bb4c8C0f50C75eE348E91ddd34f4043582aCC',
  cometProxy:   '0xDf203b46C89921537F24beA30046eb1FF8c3FCD3', // supply-only
};
const RELAYER_URL = process.env.RELAYER_URL ?? 'http://localhost:8787';
const AMOUNT_RAW = 10_000n; // 0.01 USDC (6 dec)

async function rpc<T>(url: string, body: any): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

async function main() {
  const [user] = await ethers.getSigners();
  const ut = await ethers.getContractAt(
    'contracts/unified-token/UnifiedToken.sol:UnifiedToken',
    ADDR.unifiedToken,
    user,
  );

  console.log(`User (EVM):    ${user.address}`);
  console.log(`Relayer URL:   ${RELAYER_URL}`);
  console.log(`Amount:        ${AMOUNT_RAW} raw (= ${(Number(AMOUNT_RAW) / 1e6).toFixed(6)} USDC)\n`);

  const utBalanceBefore = await ut.balanceOf(user.address);
  console.log(`User UT balance before: ${ethers.utils.formatUnits(utBalanceBefore, 6)} USDC`);
  if (utBalanceBefore.lt(AMOUNT_RAW)) {
    throw new Error(`Insufficient UT — have ${utBalanceBefore}, need ${AMOUNT_RAW}`);
  }

  // 1. POST /intent
  console.log(`\n[1/4] POST /intent { evmAddress, amount }…`);
  const created = await rpc<{ intentId: string; status: string }>(
    `${RELAYER_URL}/intent`,
    { evmAddress: user.address, amount: AMOUNT_RAW.toString() },
  );
  const intentId = created.intentId;
  console.log(`      intentId = ${intentId}  initial status = ${created.status}`);

  async function getIntent(): Promise<any> {
    const r = await fetch(`${RELAYER_URL}/intent/${intentId}`);
    return r.json();
  }

  // 2. Poll until awaiting-deposit (snapshot tx confirmed)
  console.log(`\n[2/4] Poll until awaiting-deposit…`);
  const t1 = Date.now();
  let snap;
  for (let i = 0; i < 90; i++) {
    snap = await getIntent();
    process.stdout.write(`      [${(Date.now() - t1) / 1000 | 0}s] status=${snap.status}${snap.snapshotTxHash ? ` snapshotTx=${snap.snapshotTxHash.slice(0, 10)}…` : ''}\n`);
    if (snap.status === 'failed') throw new Error(`relayer failed: ${snap.error}`);
    if (snap.status === 'awaiting-deposit') break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (snap.status !== 'awaiting-deposit') throw new Error(`stuck at ${snap.status}`);
  console.log(`      ✓ snapshot confirmed in ${(Date.now() - t1) / 1000 | 0}s, tx=${snap.snapshotTxHash}`);

  // 3. User signs unifiedToken.transfer(comet, amount)
  console.log(`\n[3/4] User signs unifiedToken.transfer(comet, ${AMOUNT_RAW})…`);
  const t2 = Date.now();
  const transferTx = await ut.transfer(ADDR.cometProxy, AMOUNT_RAW, { gasLimit: 30_000_000 });
  console.log(`      tx submitted: ${transferTx.hash}`);
  const r = await transferTx.wait();
  console.log(`      ✓ confirmed block ${r.blockNumber} (${(Date.now() - t2) / 1000 | 0}s)  gasUsed=${r.gasUsed}`);

  // 4. Poll until complete
  console.log(`\n[4/4] Poll until complete…`);
  const t3 = Date.now();
  let final;
  for (let i = 0; i < 90; i++) {
    final = await getIntent();
    process.stdout.write(`      [${(Date.now() - t3) / 1000 | 0}s] status=${final.status}${final.completeTxHash ? ` completeTx=${final.completeTxHash.slice(0, 10)}…` : ''}\n`);
    if (final.status === 'failed') throw new Error(`relayer failed at completion: ${final.error}`);
    if (final.status === 'complete') break;
    await new Promise(r => setTimeout(r, 2000));
  }
  if (final.status !== 'complete') throw new Error(`stuck at ${final.status}`);
  console.log(`      ✓ supply complete in ${(Date.now() - t3) / 1000 | 0}s, tx=${final.completeTxHash}`);

  // Sanity: UT balance dropped by amount
  const utBalanceAfter = await ut.balanceOf(user.address);
  console.log(`\nUser UT balance after: ${ethers.utils.formatUnits(utBalanceAfter, 6)} USDC`);
  console.log(`Delta:                 -${ethers.utils.formatUnits(utBalanceBefore.sub(utBalanceAfter), 6)} USDC`);

  console.log(`\n══════════════════════════════════════════`);
  console.log(`✓ Phase E EVM-lane Supply works end-to-end`);
  console.log(`══════════════════════════════════════════`);
  console.log(`  intentId:        ${intentId}`);
  console.log(`  snapshot tx:     ${snap.snapshotTxHash}`);
  console.log(`  user transfer:   ${transferTx.hash}`);
  console.log(`  complete tx:     ${final.completeTxHash}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
