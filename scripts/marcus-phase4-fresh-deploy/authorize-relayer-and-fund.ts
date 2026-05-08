// Phase E.5: authorize the relayer service key on the new EVM-overload
// OrchestratorRouter (deployed in compound-on-rome-comet#6) AND fund it
// with USDC gas so it can submit snapshot/complete txs.
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/authorize-relayer-and-fund.ts --network marcus

import { ethers } from 'hardhat';

const NEW_ROUTER = '0x5831A48EeabCe1C90Ee639865f356b52b808C023';
const RELAYER_ADDR = '0x4BE17E2799fA169d272B41e804D57d5401Fdb68b';

const FUND_USDC = ethers.utils.parseUnits('0.5', 18); // 0.5 USDC of gas

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Admin: ${admin.address}`);
  console.log(`Relayer: ${RELAYER_ADDR}`);
  console.log(`New Router: ${NEW_ROUTER}\n`);

  const routerAbi = [
    'function setRelayerAuthorization(address relayer, bool authorized) external',
    'function authorizedRelayers(address) view returns (bool)',
    'function initialRelayer() view returns (address)',
  ];
  const router = new ethers.Contract(NEW_ROUTER, routerAbi, admin);

  // Sanity: admin should be the initialRelayer (the one allowed to grant).
  const initialRelayer = await router.initialRelayer();
  console.log(`router.initialRelayer = ${initialRelayer}`);
  if (initialRelayer.toLowerCase() !== admin.address.toLowerCase()) {
    throw new Error(`signer is not initialRelayer (got ${initialRelayer})`);
  }

  // ─────── Step 1: authorize the relayer key ───────
  const wasAuthorized = await router.authorizedRelayers(RELAYER_ADDR);
  console.log(`\n[1/2] authorizedRelayers(${RELAYER_ADDR}) before: ${wasAuthorized}`);
  if (!wasAuthorized) {
    const tx1 = await router.setRelayerAuthorization(RELAYER_ADDR, true, { gasLimit: 5_000_000 });
    const r1 = await tx1.wait();
    console.log(`      tx=${tx1.hash}  block=${r1.blockNumber}`);
  }
  const isAuthorized = await router.authorizedRelayers(RELAYER_ADDR);
  console.log(`      authorizedRelayers(${RELAYER_ADDR}) after:  ${isAuthorized}`);
  if (!isAuthorized) throw new Error('authorization did not land');

  // ─────── Step 2: fund relayer with USDC gas ───────
  const balBefore = await admin.provider!.getBalance(RELAYER_ADDR);
  console.log(`\n[2/2] relayer balance before: ${ethers.utils.formatEther(balBefore)} USDC`);
  if (balBefore.lt(FUND_USDC)) {
    const tx2 = await admin.sendTransaction({
      to: RELAYER_ADDR,
      value: FUND_USDC,
      gasLimit: 5_000_000,
    });
    const r2 = await tx2.wait();
    console.log(`      tx=${tx2.hash}  block=${r2.blockNumber}`);
  } else {
    console.log(`      already funded — skipping transfer`);
  }
  const balAfter = await admin.provider!.getBalance(RELAYER_ADDR);
  console.log(`      relayer balance after:  ${ethers.utils.formatEther(balAfter)} USDC`);

  console.log(`\n✓ Relayer ${RELAYER_ADDR} ready for the new Router ${NEW_ROUTER}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
