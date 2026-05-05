import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';

const SOLANA_RPC = 'https://node1.devnet-eu-sol-api.devnet.romeprotocol.xyz';
const SOL_PUBLIC = 'https://api.devnet.solana.com';

async function main() {
  const conn = new Connection(SOLANA_RPC, 'confirmed');
  // deployer ATA from earlier work: G7oR1729tbyVDhjg9WXpAQRqMfMMEud6KjxKkhXtEhJY
  const ata = new PublicKey('G7oR1729tbyVDhjg9WXpAQRqMfMMEud6KjxKkhXtEhJY');
  console.log('Reading ATA:', ata.toBase58());
  let acct;
  try {
    acct = await getAccount(conn, ata);
  } catch (e) {
    console.log('Rome RPC failed; trying public devnet');
    const conn2 = new Connection(SOL_PUBLIC, 'confirmed');
    acct = await getAccount(conn2, ata);
  }
  console.log('owner:', acct.owner.toBase58());
  console.log('mint:', acct.mint.toBase58());
  console.log('amount:', acct.amount.toString());
  console.log('delegate:', acct.delegate?.toBase58() ?? 'null');
  console.log('delegatedAmount:', acct.delegatedAmount.toString());
}
main().catch(e => { console.error(e); process.exit(1); });
