// Deploy a vanilla BaseBulker on Marcus.
// wrappedNativeToken arg is unused for our supply/withdraw composed bench
// (only ACTION_*_NATIVE_TOKEN paths read it). Pass wUSDC as a placeholder.
//
// Run: ETH_PK=$(cat ~/.secrets/marcus/compound-phase4.key) \
//      npx hardhat run scripts/marcus-phase4-fresh-deploy/deploy-bulker.ts --network marcus

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const WUSDC = '0x39844f1d605a11acd87f766494291bbd11b406f4';

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`Admin/deployer: ${admin.address}`);

  const BaseBulker = await ethers.getContractFactory('contracts/bulkers/BaseBulker.sol:BaseBulker');
  const bulker = await BaseBulker.deploy(admin.address, WUSDC, { gasLimit: 80_000_000 });
  await bulker.deployed();
  console.log(`BaseBulker:    ${bulker.address}`);

  const out = {
    timestamp: new Date().toISOString(),
    network: 'marcus',
    chainId: 121301,
    deployer: admin.address,
    bulker: bulker.address,
    wrappedNativeTokenArg: WUSDC,
    notes: ['wrappedNativeToken passed for constructor; only used by ACTION_*_NATIVE_TOKEN paths (not exercised in composed supply+borrow bench)'],
  };
  const outPath = path.join(__dirname, 'deploy-bulker.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Results: ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
