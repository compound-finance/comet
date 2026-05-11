// Probe the composer compose to surface actual CU estimate from the proxy emulator.
import { ethers } from 'hardhat';

const ADDR = {
  wusdc:        '0x39844f1d605a11acd87f766494291bbd11b406f4',
  pcol:         '0x28fBb35045Ae4e7DAE076e3c0BC6CaA371B8A75c',
  cometProxy:   '0xbF768582378a094823788a398D65B67099B2E45A',
  composer:     '0x3D5bAd5824c58F74ccFEf334E513530412DDd6B1',
};

async function main() {
  const [signer] = await ethers.getSigners();
  const composer = await ethers.getContractAt('contracts/composer/CompoundComposer.sol:CompoundComposer', ADDR.composer, signer);

  const data = composer.interface.encodeFunctionData('supplyCollateralAndBorrow', [
    ADDR.cometProxy, ADDR.pcol, ethers.utils.parseUnits('1', 18), ADDR.wusdc, 1000n,
  ]);

  // 1. eth_call — does the logic itself revert?
  console.log('--- eth_call ---');
  try {
    const r = await ethers.provider.call({ to: ADDR.composer, from: signer.address, data, gasLimit: 200_000_000 });
    console.log('  ✅ ok, return:', r.length === 0 ? '(empty)' : r.slice(0, 100));
  } catch (e: any) {
    const msg = e?.error?.message || e?.message || JSON.stringify(e);
    console.log('  ❌ revert:', msg.slice(0, 300));
    if (e?.error?.data) console.log('  data:', e.error.data);
  }

  // 2. Try multiple rome_emulate* method names
  for (const method of ['rome_emulateTx', 'rome_estimateTx', 'rome_estimateGas', 'eth_estimateGas']) {
    console.log(`\n--- ${method} ---`);
    try {
      let params: any[];
      if (method === 'eth_estimateGas') {
        params = [{ from: signer.address, to: ADDR.composer, data }];
      } else {
        params = [{
          from: signer.address,
          to: ADDR.composer,
          data,
          gasLimit: ethers.utils.hexValue(200_000_000),
          value: '0x0',
        }];
      }
      const r = await ethers.provider.send(method, params);
      console.log('  ✅ result:', JSON.stringify(r).slice(0, 1500));
    } catch (e: any) {
      const msg = e?.error?.message || e?.message || JSON.stringify(e).slice(0, 600);
      console.log('  ❌', msg.slice(0, 400));
    }
  }

  // 3. Try eth_sendTransaction with a tiny amount (already failed, just log)
  console.log('\n--- eth_sendTransaction (1 PCOL + 1000 wei) ---');
  try {
    const tx = await composer.supplyCollateralAndBorrow(
      ADDR.cometProxy, ADDR.pcol, ethers.utils.parseUnits('1', 18), ADDR.wusdc, 1000n,
      { gasLimit: 500_000_000 },
    );
    const r = await tx.wait();
    console.log('  ✅ landed tx:', tx.hash, 'block:', r.blockNumber, 'gasUsed:', r.gasUsed.toString());
  } catch (e: any) {
    const err = e?.error;
    const out = {
      message: err?.message || e?.message,
      code: err?.code || e?.code,
      data: err?.data,
      stack: (err?.stack || e?._stack || '').slice(0, 200),
    };
    console.log('  ❌', JSON.stringify(out).slice(0, 800));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
