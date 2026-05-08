// Clear a stuck on-chain pendingSnapshotAmountEvm[user] mapping after a
// relayer crash / restart. Calls cancelPendingSnapshotEvm(user) from the
// relayer-authorized signer.
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      USER=0xe4abFBCa0FEACc65BA51602Bcbc8AA9B797830AF \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/clear-stuck-evm-intent.ts --network marcus

import { ethers } from 'hardhat';

const ROUTER = '0x5831A48EeabCe1C90Ee639865f356b52b808C023';

async function main() {
  const userArg = process.env.USER;
  if (!userArg || !userArg.startsWith('0x')) {
    throw new Error('Set USER=<0x…> env var');
  }
  const user = ethers.utils.getAddress(userArg);

  const [signer] = await ethers.getSigners();
  console.log(`Signer: ${signer.address} (must be authorizedRelayer or admin)`);
  console.log(`Target user: ${user}\n`);

  const abi = [
    'function pendingSnapshotAmountEvm(address) view returns (uint256)',
    'function cancelPendingSnapshotEvm(address user) external',
    'function authorizedRelayers(address) view returns (bool)',
  ];
  const router = new ethers.Contract(ROUTER, abi, signer);

  const ok = await router.authorizedRelayers(signer.address);
  if (!ok) throw new Error(`signer ${signer.address} is not an authorized relayer on ${ROUTER}`);

  const pending = await router.pendingSnapshotAmountEvm(user);
  console.log(`pendingSnapshotAmountEvm(${user}) = ${pending.toString()}`);
  if (pending.eq(0)) {
    console.log('Nothing to clear.');
    return;
  }

  const tx = await router.cancelPendingSnapshotEvm(user, { gasLimit: 5_000_000 });
  const r = await tx.wait();
  console.log(`✓ cancelled  tx=${tx.hash}  block=${r.blockNumber}`);

  const after = await router.pendingSnapshotAmountEvm(user);
  console.log(`pendingSnapshotAmountEvm(${user}) after = ${after.toString()}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
