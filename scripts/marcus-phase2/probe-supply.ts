import { ethers } from 'hardhat';
import * as fs from 'fs';
async function main() {
  const pk = fs.readFileSync('/Users/anilkumar/rome/.secrets/marcus/deployer.key', 'utf8').trim();
  const wallet = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk);
  const cometIface = new ethers.utils.Interface(['function supply(address asset, uint amount)']);
  const data = cometIface.encodeFunctionData('supply', ['0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31', 100_000n]);
  const provider = ethers.provider;
  const nonce = await provider.getTransactionCount(wallet.address, 'latest');
  // Try with 30M gas limit
  const tx = { to: '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c', data, nonce, gasLimit: 30_000_000, gasPrice: ethers.utils.parseUnits('1', 'gwei'), chainId: 121301, value: 0 };
  const signed = await wallet.signTransaction(tx);
  console.log('nonce:', nonce, 'signed length:', signed.length);
  const r = await fetch('https://marcus.devnet.romeprotocol.xyz/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [signed] }),
  });
  const j: any = await r.json();
  console.log('response:', JSON.stringify(j));
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
