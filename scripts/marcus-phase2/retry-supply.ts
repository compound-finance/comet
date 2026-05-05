import { ethers } from 'hardhat';
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
async function main() {
  const [signer] = await ethers.getSigners();
  const cometAbi = ['function supply(address asset, uint amount)'];
  const comet = new ethers.Contract(COMET_PROXY, cometAbi, signer);
  console.log('Submitting supply...');
  for (let i = 0; i < 3; i++) {
    try {
      const tx = await comet.supply(UNIFIED_TOKEN_V2, 1_000_000n, { gasLimit: 12_000_000 });
      console.log(`  attempt ${i+1}: tx=${tx.hash}`);
      const r = await tx.wait();
      console.log(`  attempt ${i+1}: status=${r.status} block=${r.blockNumber}`);
      return;
    } catch (e: any) {
      console.log(`  attempt ${i+1}: ${(e.message || '').slice(0, 200)}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
