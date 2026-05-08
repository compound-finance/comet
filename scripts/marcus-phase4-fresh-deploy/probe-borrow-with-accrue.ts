// Workaround attempt for the "TooManyComputeUnitsInAtomicTx(1435188)" SDK
// rejection we saw on comet.withdraw. Pre-call accrueAccount(deployer)
// in a separate tx so the withdraw's internal accrue() is a no-op and
// withdraw's CU drops below ceiling + 100k margin.

import { ethers } from 'hardhat';

const ADDR = {
  unifiedToken: '0xe76bb4c8C0f50C75eE348E91ddd34f4043582aCC',
  cometProxy:   '0x057c15b0162CC8b6242Ac22A6B9FC92B00e3c710',
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const comet = await ethers.getContractAt('contracts/Comet.sol:Comet', ADDR.cometProxy, deployer);

  console.log('STEP 1 — comet.accrueAccount(deployer)');
  try {
    const tx1 = await comet.accrueAccount(deployer.address, { gasLimit: 30_000_000 });
    const r1 = await tx1.wait();
    console.log(`  ✓ tx ${tx1.hash}  block ${r1.blockNumber}  gasUsed ${r1.gasUsed}`);
  } catch (e: any) {
    console.log(`  ✗ ACCRUE FAILED: ${e.message?.slice(0, 200) ?? e}`);
    console.log(`    code=${e.code} reason=${e.reason}`);
    return;
  }

  console.log('\nSTEP 2 — comet.withdraw(USDC, 10000)  (with accrue already current)');
  try {
    const tx2 = await comet.withdraw(ADDR.unifiedToken, 10_000n, { gasLimit: 30_000_000 });
    const r2 = await tx2.wait();
    console.log(`  ✓ tx ${tx2.hash}  block ${r2.blockNumber}  gasUsed ${r2.gasUsed}`);
  } catch (e: any) {
    console.log(`  ✗ WITHDRAW FAILED: ${e.message?.slice(0, 200) ?? e}`);
    console.log(`    code=${e.code} reason=${e.reason}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
