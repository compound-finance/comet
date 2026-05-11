// One-shot probe of bulker.invoke composed flow — surfaces the real error/CU number.
import { ethers } from 'hardhat';

const ADDR = {
  wusdc:        '0x39844f1d605a11acd87f766494291bbd11b406f4',
  pcol:         '0x28fBb35045Ae4e7DAE076e3c0BC6CaA371B8A75c',
  cometProxy:   '0xbF768582378a094823788a398D65B67099B2E45A',
  bulker:       '0x8867aD6C154Ff5D9880b971653D88036da38c2c4',
};

async function main() {
  const [signer] = await ethers.getSigners();
  const bulker = await ethers.getContractAt('contracts/bulkers/BaseBulker.sol:BaseBulker', ADDR.bulker, signer);

  const ACTION_SUPPLY_ASSET   = ethers.utils.formatBytes32String('ACTION_SUPPLY_ASSET');
  const ACTION_WITHDRAW_ASSET = ethers.utils.formatBytes32String('ACTION_WITHDRAW_ASSET');

  const supplyData = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256'],
    [ADDR.cometProxy, signer.address, ADDR.pcol, ethers.utils.parseUnits('100', 18)],
  );
  const withdrawData = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256'],
    [ADDR.cometProxy, signer.address, ADDR.wusdc, 10000],
  );

  const data = bulker.interface.encodeFunctionData('invoke', [
    [ACTION_SUPPLY_ASSET, ACTION_WITHDRAW_ASSET],
    [supplyData, withdrawData],
  ]);

  // 1. eth_call (cheap)
  console.log('--- eth_call probe ---');
  try {
    const r = await ethers.provider.call({ to: ADDR.bulker, from: signer.address, data, gasLimit: 200_000_000 });
    console.log('  eth_call ok:', r.length === 0 ? '(empty)' : r);
  } catch (e: any) {
    console.log('  eth_call error:', e?.error?.message || e?.message || JSON.stringify(e).slice(0, 600));
    if (e?.error?.data) console.log('  data:', e.error.data);
  }

  // 2. Try the actual sendTransaction with smaller amounts — see what the boundary is
  console.log('\n--- minimum-compose probe (1 PCOL + 100 wUSDC raw borrow) ---');
  const supplyDataMin = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256'],
    [ADDR.cometProxy, signer.address, ADDR.pcol, ethers.utils.parseUnits('1', 18)],
  );
  const withdrawDataMin = ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256'],
    [ADDR.cometProxy, signer.address, ADDR.wusdc, 100],
  );
  const dataMin = bulker.interface.encodeFunctionData('invoke', [
    [ACTION_SUPPLY_ASSET, ACTION_WITHDRAW_ASSET],
    [supplyDataMin, withdrawDataMin],
  ]);
  try {
    const r = await ethers.provider.call({ to: ADDR.bulker, from: signer.address, data: dataMin, gasLimit: 200_000_000 });
    console.log('  eth_call min ok');
  } catch (e: any) {
    console.log('  eth_call min error:', e?.error?.message || e?.message || JSON.stringify(e).slice(0, 400));
  }
  try {
    const tx = await bulker.invoke(
      [ACTION_SUPPLY_ASSET, ACTION_WITHDRAW_ASSET],
      [supplyDataMin, withdrawDataMin],
      { gasLimit: 200_000_000 },
    );
    const r = await tx.wait();
    console.log('  send min ok — tx:', tx.hash, 'block:', r.blockNumber);
  } catch (e: any) {
    console.log('  send min error:', e?.error?.message || e?.message || JSON.stringify(e).slice(0, 400));
  }

  // 3. Single-action via Bulker (just SUPPLY_ASSET) — gauge Bulker overhead
  console.log('\n--- single-action via Bulker ---');
  const dataSingle = bulker.interface.encodeFunctionData('invoke', [
    [ACTION_SUPPLY_ASSET],
    [supplyData],
  ]);
  try {
    const r = await ethers.provider.call({ to: ADDR.bulker, from: signer.address, data: dataSingle, gasLimit: 200_000_000 });
    console.log('  eth_call single ok');
  } catch (e: any) {
    console.log('  eth_call single error:', e?.error?.message || e?.message || JSON.stringify(e).slice(0, 400));
  }
  try {
    const tx = await bulker.invoke(
      [ACTION_SUPPLY_ASSET],
      [supplyData],
      { gasLimit: 200_000_000 },
    );
    const r = await tx.wait();
    console.log('  send single ok — tx:', tx.hash, 'block:', r.blockNumber, 'gasUsed:', r.gasUsed.toString());
    // Capture CU
    const sigs = await ethers.provider.send('rome_solanaTxForEvmTx', [tx.hash]).catch(() => []);
    console.log('  solana sigs:', sigs);
  } catch (e: any) {
    console.log('  send single error:', e?.error?.message || e?.message || JSON.stringify(e).slice(0, 400));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
