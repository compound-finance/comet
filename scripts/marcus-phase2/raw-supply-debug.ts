import { ethers } from 'hardhat';
import * as fs from 'fs';
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';

async function main() {
  const pk = fs.readFileSync('/Users/anilkumar/rome/.secrets/marcus/deployer.key', 'utf8').trim();
  const wallet = new ethers.Wallet(pk.startsWith('0x') ? pk : '0x' + pk);
  const cometIface = new ethers.utils.Interface(['function supply(address asset, uint amount)']);
  const data = cometIface.encodeFunctionData('supply', [UNIFIED_TOKEN_V2, 1_000_000n]);
  const provider = ethers.provider;
  const nonce = await provider.getTransactionCount(wallet.address, 'latest');
  console.log('nonce:', nonce);
  const tx = {
    to: COMET_PROXY,
    data,
    nonce,
    gasLimit: 12_000_000,
    gasPrice: ethers.utils.parseUnits('1', 'gwei'),
    chainId: 121301,
    value: 0,
  };
  const signed = await wallet.signTransaction(tx);
  console.log('signed length:', signed.length);
  const r = await fetch('https://marcus.devnet.romeprotocol.xyz/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [signed] }),
  });
  const j: any = await r.json();
  console.log('response:', JSON.stringify(j));
  if (j.result) {
    console.log('Waiting for receipt...');
    let receipt = null;
    for (let i = 0; i < 40; i++) {
      receipt = await provider.getTransactionReceipt(j.result);
      if (receipt) break;
      await new Promise(r => setTimeout(r, 1500));
    }
    console.log('receipt:', receipt ? `block=${receipt.blockNumber} status=${receipt.status} gasUsed=${receipt.gasUsed}` : 'TIMEOUT');
    if (receipt) {
      const sigsR = await fetch('https://marcus.devnet.romeprotocol.xyz/', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'rome_solanaTxForEvmTx', params: [j.result] }),
      });
      const sj: any = await sigsR.json();
      console.log('solana sigs:', JSON.stringify(sj.result || sj));
    }
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
