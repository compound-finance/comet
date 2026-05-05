// Phase 2 — Raw signed tx supply, bypassing hardhat-ethers wrapper that
// silently swallows the actual error message.

import { ethers } from 'hardhat';

const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
const UNIFIED_TOKEN_V2 = '0xfbd4De54443ddB44b3B0b32f4D39813aC7df3A31';
const MARCUS_RPC = 'https://marcus.devnet.romeprotocol.xyz/';

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(MARCUS_RPC);
  const pk = process.env.ETH_PK;
  if (!pk) {
    console.error('ETH_PK env required');
    process.exit(1);
  }
  const wallet = new ethers.Wallet(pk, provider);
  console.log(`Using wallet: ${wallet.address}`);
  const cometViaProxy = await ethers.getContractAt('contracts/Comet.sol:Comet', COMET_PROXY);

  const data = cometViaProxy.interface.encodeFunctionData('supply', [UNIFIED_TOKEN_V2, 1_000_000n]);
  console.log(`calldata: ${data}`);

  const nonce = await provider.getTransactionCount(wallet.address);
  const gasPrice = await provider.getGasPrice();
  console.log(`nonce: ${nonce}, gasPrice: ${gasPrice.toString()}`);

  const network = await provider.getNetwork();
  console.log(`chainId: ${network.chainId}`);

  const tx = {
    to: COMET_PROXY,
    data,
    nonce,
    gasLimit: 8_000_000,
    gasPrice: gasPrice.mul(2),
    chainId: network.chainId,
    value: 0,
    type: 0, // legacy
  };

  const signed = await wallet.signTransaction(tx);
  console.log(`signed tx (${signed.length} bytes hex)`);

  // Submit via raw RPC to capture the full error
  const r = await fetch(MARCUS_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [signed],
    }),
  });
  const j: any = await r.json();
  console.log(`response: ${JSON.stringify(j, null, 2)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
