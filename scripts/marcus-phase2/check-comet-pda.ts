import { ethers } from 'hardhat';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';

const PROGRAM_ID = 'RomeDbGQYbqomGVk13h9JkQHKoNWKB84Lw1ij9AtRXT';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const DEPLOYER = '0x109B92c1B867dbF0955928722Ca46db0a1F6e484';

async function main() {
  const [signer] = await ethers.getSigners();
  const sysAddr = '0xfF00000000000000000000000000000000000007';
  const SystemProgramAbi = [
    'function find_program_address(bytes32 program, tuple(bytes item)[] seeds) external pure returns (bytes32, uint8)',
  ];
  const sys = new ethers.Contract(sysAddr, SystemProgramAbi, signer);
  const programIdBytes = bs58.decode(PROGRAM_ID);
  const programIdBytes32 = '0x' + Buffer.from(programIdBytes).toString('hex');

  for (const [label, addr] of [['DEPLOYER', DEPLOYER], ['COMET_PROXY', COMET_PROXY]]) {
    const seeds = [
      { item: ethers.utils.toUtf8Bytes('EXTERNAL_AUTHORITY') },
      { item: addr.toLowerCase() },
    ];
    const [authPdaBytes32] = await sys.find_program_address(programIdBytes32, seeds);
    const authPdaBuf = Buffer.from(authPdaBytes32.slice(2), 'hex');
    const authPda = new PublicKey(authPdaBuf);
    const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT), authPda, true);
    console.log(`${label}: addr=${addr}`);
    console.log(`  AUTHORITY_PDA: ${authPda.toBase58()}`);
    console.log(`  USDC ATA: ${ata.toBase58()}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
