// Derive the deployer's USDC ATA on Solana so the user can send USDC
// directly to it (one-time bootstrap to allocate the ATA + give the
// deployer a starting balance for the Phase D supply bench).

import { ethers } from 'hardhat';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

const PROGRAM_ID  = 'romedpkFKEu3JJrYujtNUferyEv47UxvjZe2QcdPwN8';
const USDC_MINT   = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SYS_ADDR    = '0xfF00000000000000000000000000000000000007';

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Deployer EVM addr: ${signer.address}`);

  // Derive ExternalAuthPda via Rome SystemProgram precompile.
  const sysAbi = [
    'function find_program_address(bytes32 program, tuple(bytes item)[] seeds) external pure returns (bytes32, uint8)',
  ];
  const sys = new ethers.Contract(SYS_ADDR, sysAbi, signer);
  const programIdBytes32 = '0x' + Buffer.from(bs58.decode(PROGRAM_ID)).toString('hex');
  const seeds = [
    { item: ethers.utils.toUtf8Bytes('EXTERNAL_AUTHORITY') },
    { item: signer.address.toLowerCase() },
  ];
  const [authPdaBytes32, bump] = await sys.find_program_address(programIdBytes32, seeds);
  const authPda = new PublicKey(Buffer.from(authPdaBytes32.slice(2), 'hex'));
  console.log(`ExternalAuthPda:   ${authPda.toBase58()} (bump=${bump})`);

  // Derive ATA(ExternalAuthPda, USDC_MINT) via SPL convention.
  const usdcMintPk = new PublicKey(USDC_MINT);
  const ata = getAssociatedTokenAddressSync(usdcMintPk, authPda, /*allowOwnerOffCurve=*/ true);
  console.log(`Recipient ATA:     ${ata.toBase58()}`);
  console.log(`USDC mint:         ${USDC_MINT}`);
  console.log(`\nSend USDC on Solana devnet to the Recipient ATA above.`);
  console.log(`The transfer_checked instruction will auto-create the ATA on first send.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
