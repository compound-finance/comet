import { ethers } from 'hardhat';
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
async function main() {
  const [signer] = await ethers.getSigners();
  const cometAbi = ['function supply(address asset, uint amount)'];
  const comet = new ethers.Contract(COMET_PROXY, cometAbi, signer);
  console.log('Submitting supply...');
  try {
    const tx = await comet.supply(UNIFIED_TOKEN_V2, 100_000n, { gasLimit: 12_000_000 });
    console.log('  tx hash:', tx.hash);
    const r = await tx.wait();
    console.log('  status:', r.status, 'block:', r.blockNumber, 'gas:', r.gasUsed.toString());
  } catch (e: any) {
    const o: any = { m: e.message, r: e.reason, c: e.code, body: e.body, info: e.info, receipt: e.receipt };
    if (e.error) {
      o.err_code = e.error.code; o.err_data = e.error.data; o.err_message = e.error.message;
    }
    console.log('  ERR:', JSON.stringify(o).slice(0, 1000));
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
