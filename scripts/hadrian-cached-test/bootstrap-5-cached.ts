// Bootstrap 4 new cached SPL_ERC20 wrappers on Hadrian.
//
// For each (name, symbol, decimals, initialSupply) tuple:
//   1. factory.create_token_mint() → creates SPL mint on Solana, returns mint pubkey
//   2. factory.init_token_mint(mint) → initializes mint with caller as authority
//   3. factory.add_spl_token_no_metadata(mint, name, symbol) → deploys cached SPL_ERC20 wrapper
//   4. wrapper.mint_to(deployer, initialSupply) → mints SPL tokens to deployer's ATA
//
// Writes addresses to scripts/hadrian-cached-test/cached-wrappers.json.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

const FACTORY = '0xca1aad95ed6b8b798fbf5366db469d46f16aca0b'; // Hadrian ERC20SPLFactory v4

const FACTORY_ABI = [
  'function create_token_mint() returns (bytes32)',
  'function init_token_mint(bytes32 mint)',
  'function add_spl_token_no_metadata(bytes32 mint, string name, string symbol) returns (address)',
  'function get_current_mint(address user) view returns (bytes32, bytes32)',
  'function token_by_mint(bytes32) view returns (address)',
];

const WRAPPER_ABI = [
  'function mint_to(address to, uint256 value) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

const NEW_ASSETS = [
  { name: 'Wrapped Heat',  symbol: 'wHEAT', initialSupplyDecimal: '1000000' },  // 1M
  { name: 'Wrapped Salt',  symbol: 'wSALT', initialSupplyDecimal: '1000000' },
  { name: 'Wrapped Milk',  symbol: 'wMILK', initialSupplyDecimal: '1000000' },
  { name: 'Wrapped Oil',   symbol: 'wOIL',  initialSupplyDecimal: '1000000' },
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Deployer: ${signer.address}`);

  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, signer);

  const results: any[] = [];
  for (const asset of NEW_ASSETS) {
    console.log(`\n─── ${asset.symbol} (${asset.name}) ───`);

    // Check if a wrapper for the next-derived mint already exists (idempotent skip)
    const [predictedMint] = await factory.get_current_mint(signer.address);
    console.log(`  predicted mint: 0x${Buffer.from(ethers.utils.arrayify(predictedMint)).toString('hex')}`);
    const existing = await factory.token_by_mint(predictedMint);
    if (existing !== ethers.constants.AddressZero) {
      console.log(`  wrapper already exists at ${existing}; skipping bootstrap`);
      results.push({
        symbol: asset.symbol,
        name: asset.name,
        mint: predictedMint,
        wrapper: existing,
        skipped: true,
      });
      continue;
    }

    // 1. Create mint
    process.stdout.write(`  [1/4] factory.create_token_mint() ... `);
    let tx = await factory.create_token_mint({ gasLimit: 100_000_000 });
    await tx.wait();
    console.log(`tx=${tx.hash}`);

    // Re-query the mint pubkey (now stored)
    const mint: string = predictedMint; // get_current_mint returns the same pubkey on next call too — but the nonce advances, so use the cached one

    // 2. Initialize mint
    process.stdout.write(`  [2/4] factory.init_token_mint(mint) ... `);
    tx = await factory.init_token_mint(mint, { gasLimit: 100_000_000 });
    await tx.wait();
    console.log(`tx=${tx.hash}`);

    // 3. Add SPL token wrapper
    process.stdout.write(`  [3/4] factory.add_spl_token_no_metadata(mint, ${asset.name}, ${asset.symbol}) ... `);
    tx = await factory.add_spl_token_no_metadata(mint, asset.name, asset.symbol, { gasLimit: 100_000_000 });
    await tx.wait();
    console.log(`tx=${tx.hash}`);

    const wrapperAddr = await factory.token_by_mint(mint);
    console.log(`      wrapper:  ${wrapperAddr}`);

    // 4. Mint initial supply to deployer
    const wrapper = new ethers.Contract(wrapperAddr, WRAPPER_ABI, signer);
    const decimals = await wrapper.decimals();
    const initialSupply = ethers.BigNumber.from(asset.initialSupplyDecimal).mul(ethers.BigNumber.from(10).pow(decimals));
    process.stdout.write(`  [4/4] wrapper.mint_to(deployer, ${initialSupply}) [${asset.initialSupplyDecimal} × 10^${decimals}] ... `);
    tx = await wrapper.mint_to(signer.address, initialSupply, { gasLimit: 100_000_000 });
    await tx.wait();
    console.log(`tx=${tx.hash}`);

    const bal = await wrapper.balanceOf(signer.address);
    console.log(`      deployer bal: ${bal}`);

    results.push({
      symbol: asset.symbol,
      name: asset.name,
      mint,
      wrapper: wrapperAddr,
      decimals: Number(decimals),
      initialSupply: initialSupply.toString(),
      skipped: false,
    });
  }

  const out = {
    deployedAt: new Date().toISOString(),
    factory: FACTORY,
    deployer: signer.address,
    wrappers: results,
  };
  const outFile = path.join('scripts', 'hadrian-cached-test', 'cached-wrappers.json');
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n══════ Bootstrap COMPLETE ══════`);
  for (const w of results) {
    console.log(`  ${w.symbol}: ${w.wrapper} (mint ${w.mint.slice(0, 18)}…)`);
  }
  console.log(`\nstate written: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
