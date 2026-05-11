// Sign + submit a raw eth_sendRawTransaction for the composer compose,
// inspect the full JSON-RPC error response to see if the actual CU
// number is preserved anywhere (data field, etc.) before being mapped
// to -32000.
import { ethers } from 'hardhat';

const ADDR = {
  pcol:       '0x28fBb35045Ae4e7DAE076e3c0BC6CaA371B8A75c',
  wusdc:      '0x39844f1d605a11acd87f766494291bbd11b406f4',
  cometProxy: '0xbF768582378a094823788a398D65B67099B2E45A',
  composer:   '0x3D5bAd5824c58F74ccFEf334E513530412DDd6B1',
};

async function main() {
  const provider = ethers.provider;
  const pk = process.env.ETH_PK!.startsWith('0x') ? process.env.ETH_PK! : '0x' + process.env.ETH_PK!;
  const wallet = new ethers.Wallet(pk, provider);
  const composer = await ethers.getContractAt('contracts/composer/CompoundComposer.sol:CompoundComposer', ADDR.composer, wallet);

  const data = composer.interface.encodeFunctionData('supplyCollateralAndBorrow', [
    ADDR.cometProxy, ADDR.pcol, ethers.utils.parseUnits('1', 18), ADDR.wusdc, 1000n,
  ]);

  const nonce = await wallet.getTransactionCount();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const gasPrice = await ethers.provider.getGasPrice();
  console.log(`nonce=${nonce} chainId=${chainId} gasPrice=${gasPrice.toString()}`);

  const tx = {
    from: wallet.address,
    to: ADDR.composer,
    data,
    nonce,
    chainId,
    gasPrice,
    gasLimit: 1_500_000_000,  // very high upper bound
    value: 0,
  };

  const rawSigned = await wallet.signTransaction(tx);
  console.log('raw signed tx (first 100 chars):', rawSigned.slice(0, 100));

  // Submit via raw curl-style call to see full error
  const resp = await fetch('https://marcus.devnet.romeprotocol.xyz/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'eth_sendRawTransaction',
      params: [rawSigned],
    }),
  });
  const j = await resp.json();
  console.log('\n=== Full JSON-RPC response ===');
  console.log(JSON.stringify(j, null, 2));

  // Also try rome_emulateTx with raw rlp (hex)
  console.log('\n=== rome_emulateTx response ===');
  const respE = await fetch('https://marcus.devnet.romeprotocol.xyz/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2,
      method: 'rome_emulateTx',
      params: [rawSigned],
    }),
  });
  const jE = await respE.json();
  console.log(JSON.stringify(jE, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
