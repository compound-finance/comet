import { ethers } from 'hardhat';
const PULL = '0xAe04Ac53B05DcecD2ed00b31f7937e86A273B80A';
const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
async function main() {
  const [signer] = await ethers.getSigners();
  const tokenAbi = ['function approve(address spender, uint256 amount) returns (bool)', 'function balanceOf(address) view returns (uint256)'];
  const token = new ethers.Contract(UNIFIED_TOKEN_V2, tokenAbi, signer);
  // First refresh approve to pull
  console.log('Refreshing approve(pull, 5e6)...');
  const ax = await token.approve(PULL, 5_000_000n, { gasLimit: 12_000_000 });
  await ax.wait();
  console.log('  approve tx:', ax.hash);
  // Now larger pull
  console.log('Pulling 1e6 (1 USDC)...');
  const pullAbi = ['function pull(address token, address from, uint256 amount)'];
  const p = new ethers.Contract(PULL, pullAbi, signer);
  try {
    const tx = await p.pull(UNIFIED_TOKEN_V2, signer.address, 1_000_000n, { gasLimit: 30_000_000 });
    console.log('  tx:', tx.hash);
    const r = await tx.wait();
    console.log('  status:', r.status, 'block:', r.blockNumber);
  } catch (e: any) {
    console.log('  ERR:', JSON.stringify({ m: e.message, c: e.code }).slice(0, 600));
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
