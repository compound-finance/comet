// Probe: comet.withdraw(USDC, 10000) — capture the full error.

import { ethers } from 'hardhat';

const ADDR = {
  unifiedToken: '0xe76bb4c8C0f50C75eE348E91ddd34f4043582aCC',
  cometProxy:   '0x057c15b0162CC8b6242Ac22A6B9FC92B00e3c710',
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const comet = await ethers.getContractAt('contracts/Comet.sol:Comet', ADDR.cometProxy, deployer);

  console.log('Calling comet.withdraw(USDC, 10000)…\n');
  try {
    const tx = await comet.withdraw(ADDR.unifiedToken, 10_000n, { gasLimit: 50_000_000 });
    console.log('tx hash:', tx.hash);
    const r = await tx.wait();
    console.log('status:', r.status, 'gasUsed:', r.gasUsed.toString());
  } catch (e: any) {
    console.log('TYPE:', e.constructor?.name);
    console.log('CODE:', e.code);
    console.log('REASON:', e.reason);
    console.log('MESSAGE:', e.message);
    console.log('\nFULL ERROR JSON:');
    console.log(JSON.stringify(e, Object.getOwnPropertyNames(e), 2).slice(0, 4000));
  }
}

main().catch((e) => { console.error('outer:', e); process.exit(1); });
