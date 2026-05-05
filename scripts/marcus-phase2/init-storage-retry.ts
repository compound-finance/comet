import { ethers } from 'hardhat';
const COMET_PROXY = '0x458fd96E090F642D68f96CdEF7d42aCE41E0528c';
async function main() {
  const [signer] = await ethers.getSigners();
  const cometIface = new ethers.utils.Interface([
    'function initializeStorage() external',
    'function totalSupply() external view returns (uint256)',
    'function totalBorrow() external view returns (uint256)',
    'function totalsBasic() external view returns (tuple(uint64,uint64,uint64,uint64,uint104,uint104,uint40,uint8))',
    'function getReserves() external view returns (int)',
  ]);

  // Try eth_call first
  console.log('eth_call totalsBasic...');
  try {
    const data = cometIface.encodeFunctionData('totalsBasic');
    const r: any = await fetch('https://marcus.devnet.romeprotocol.xyz/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: COMET_PROXY, data }, 'latest'] }),
    }).then(r => r.json());
    console.log('  response:', JSON.stringify(r));
  } catch (e: any) { console.log('err:', e.message); }

  console.log('\neth_call initializeStorage...');
  try {
    const data = cometIface.encodeFunctionData('initializeStorage');
    const r: any = await fetch('https://marcus.devnet.romeprotocol.xyz/', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ from: signer.address, to: COMET_PROXY, data, gas: '0x4c4b40' }, 'latest'] }),
    }).then(r => r.json());
    console.log('  response:', JSON.stringify(r).slice(0, 600));
  } catch (e: any) { console.log('err:', e.message); }

  console.log('\nNow attempting initializeStorage tx...');
  try {
    const comet = new ethers.Contract(COMET_PROXY, cometIface, signer);
    const tx = await comet.initializeStorage({ gasLimit: 6_000_000 });
    console.log('  tx hash:', tx.hash);
    const r = await tx.wait();
    console.log('  status:', r.status, 'block:', r.blockNumber);
  } catch (e: any) {
    console.log('  err:', JSON.stringify({ m: e.message, r: e.reason, c: e.code, d: e.data }).slice(0, 600));
  }
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
