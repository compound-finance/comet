import { ethers } from 'hardhat';
async function main() {
  const [signer] = await ethers.getSigners();
  const COMET = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
  const UT = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
  const cometAbi = ['function supply(address asset, uint amount)'];
  const comet = new ethers.Contract(COMET, cometAbi, signer);
  for (const amt of [1n, 100n, 1000n, 10_000n, 100_000n, 1_000_000n]) {
    try {
      console.log(`\nsupply(${amt})...`);
      const tx = await comet.supply(UT, amt, { gasLimit: 30_000_000 });
      console.log(`  tx: ${tx.hash}`);
      const r = await tx.wait();
      console.log(`  status: ${r.status} block: ${r.blockNumber} gas: ${r.gasUsed}`);
      if (r.status === 1) console.log('  SUCCESS!');
    } catch (e: any) {
      console.log(`  ERR: ${(e.message || '').slice(0, 200)}`);
    }
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
