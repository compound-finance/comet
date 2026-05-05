import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';

async function main() {
  const conn = new Connection('https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz', 'confirmed');
  const ata = new PublicKey('5WYANgGHwZDhzdDR2cgbVFs6jQDNT41AefpQHEeGHkB6');
  console.log('Checking comet ATA:', ata.toBase58());
  try {
    const acct = await getAccount(conn, ata);
    console.log('owner:', acct.owner.toBase58());
    console.log('mint:', acct.mint.toBase58());
    console.log('amount:', acct.amount.toString());
    console.log('delegate:', acct.delegate?.toBase58() ?? 'null');
  } catch (e) {
    console.log('ATA does not exist or unreadable:', (e as Error).message);
    // try public devnet
    const c2 = new Connection('https://api.devnet.solana.com', 'confirmed');
    try {
      const a2 = await getAccount(c2, ata);
      console.log('via public devnet — owner:', a2.owner.toBase58(), 'amount:', a2.amount.toString());
    } catch (e2) {
      console.log('also missing on public devnet:', (e2 as Error).message);
    }
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
