// Phase 2 — direct UnifiedToken.transfer smoke test (no Comet, no allowance).
// If transfer works but supply doesn't, the supply problem is at Comet's
// integration with the wrapped token; if neither works, it's an SPL-side or
// Rome-side issue with the wrapper itself.

import { ethers } from 'hardhat';

const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';

async function main() {
  const [signer] = await ethers.getSigners();
  const tokenAbi = [
    'function transfer(address to, uint256 amount) returns (bool)',
    'function balanceOf(address) view returns (uint256)',
  ];
  const token = new ethers.Contract(UNIFIED_TOKEN_V2, tokenAbi, signer);

  const balBefore = await token.balanceOf(signer.address);
  console.log(`Deployer balance before: ${balBefore.toString()}`);
  const cometBalBefore = await token.balanceOf(COMET_PROXY);
  console.log(`Comet balance before: ${cometBalBefore.toString()}`);

  console.log(`\nTransferring 100000 (0.1 USDC) from deployer → comet...`);
  try {
    const tx = await token.transfer(COMET_PROXY, 100_000n, { gasLimit: 5_000_000 });
    console.log(`tx hash: ${tx.hash}`);
    const rcpt = await tx.wait();
    console.log(`status: ${rcpt.status}, gasUsed: ${rcpt.gasUsed.toString()}`);
  } catch (e) {
    const ee = e as any;
    console.log(`error: ${JSON.stringify({
      message: ee.message,
      reason: ee.reason,
      code: ee.code,
      data: ee.data,
    }).slice(0, 600)}`);
  }

  const balAfter = await token.balanceOf(signer.address);
  const cometBalAfter = await token.balanceOf(COMET_PROXY);
  console.log(`\nDeployer balance after: ${balAfter.toString()}`);
  console.log(`Comet balance after: ${cometBalAfter.toString()}`);
}

main().catch(err => { console.error(err); process.exit(1); });
