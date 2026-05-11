import { ethers } from 'hardhat';
async function main() {
  const [signer] = await ethers.getSigners();
  const target = process.env.LIQUIDATOR_TARGET!;
  console.log('From:', signer.address);
  console.log('To:  ', target);
  const tx = await signer.sendTransaction({ to: target, value: ethers.utils.parseEther('0.5'), gasLimit: 5_000_000 });
  console.log('tx:  ', tx.hash);
  const r = await tx.wait();
  console.log('block:', r.blockNumber);
  const bal = await ethers.provider.getBalance(target);
  console.log('post balance:', ethers.utils.formatEther(bal), 'USDC');
}
main().catch(e => { console.error(e); process.exit(1); });
