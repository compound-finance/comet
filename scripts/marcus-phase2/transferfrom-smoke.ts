// Phase 2 — direct UnifiedToken.transferFrom smoke test using the SPL delegate
// set up via approve(). Bypasses Comet entirely to isolate whether transferFrom
// works on Marcus.
//
// Setup is already in place:
//   - approve(comet, MAX) issued earlier — SPL delegate live for AUTHORITY_PDA(comet)
//
// We simulate what Comet would do: invoke transferFrom from a different signer
// to pull from the original deployer's ATA.

import { ethers } from 'hardhat';

const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';

async function main() {
  const [signer] = await ethers.getSigners();

  // We can't directly call transferFrom *as* the cometProxy without it being
  // a contract function call from Comet. We can call transferFrom from the
  // same signer (deployer) — but allowance is set up for comet, not deployer.
  // Let's first set up allowance for deployer too, so we can test the
  // delegate-driven transferFrom path with the deployer as spender.

  // Actually, the simplest test: deployer.approve(deployer, MAX) — the SPL
  // delegate would be AUTHORITY_PDA(deployer). transferFrom signs as the
  // same PDA — same flow as direct transfer (since owner == spender).

  const tokenAbi = [
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address, address) view returns (uint256)',
  ];
  const token = new ethers.Contract(UNIFIED_TOKEN_V2, tokenAbi, signer);

  console.log('Setting up self-allowance (approve self for transferFrom test)...');
  const approveTx = await token.approve(signer.address, ethers.utils.parseUnits('100', 6), { gasLimit: 5_000_000 });
  await approveTx.wait();
  console.log(`  approve tx: ${approveTx.hash}`);
  console.log(`  allowance: ${(await token.allowance(signer.address, signer.address)).toString()}`);

  const balBefore = await token.balanceOf(signer.address);
  const cometBalBefore = await token.balanceOf(COMET_PROXY);
  console.log(`\nBefore: deployer=${balBefore.toString()}, comet=${cometBalBefore.toString()}`);

  console.log('\ntransferFrom(deployer, comet, 0.05 USDC)...');
  try {
    const tx = await token.transferFrom(signer.address, COMET_PROXY, 50_000n, { gasLimit: 8_000_000 });
    console.log(`tx hash: ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`status: ${rcpt.status}, gasUsed: ${rcpt.gasUsed.toString()}`);
  } catch (e) {
    const ee = e as any;
    console.log(`error: ${JSON.stringify({
      message: ee.message,
      reason: ee.reason,
      code: ee.code,
    }).slice(0, 600)}`);
  }

  const balAfter = await token.balanceOf(signer.address);
  const cometBalAfter = await token.balanceOf(COMET_PROXY);
  console.log(`\nAfter: deployer=${balAfter.toString()}, comet=${cometBalAfter.toString()}`);
}

main().catch(err => { console.error(err); process.exit(1); });
