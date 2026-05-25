// Bootstrap N fresh cached SPL_ERC20 wrappers on Hadrian via v6 factory.
//
// Per wrapper:
//   1. factory.create_token_mint() → creates SPL mint on Solana
//   2. factory.init_token_mint(mint) → initializes mint with caller as authority
//   3. factory.add_spl_token_no_metadata(mint, name, symbol) → deploys SPL_ERC20_cached
//   4. wrapper.mint_to(deployer, initialSupply) → mints to deployer's ATA
//
// Idempotent — wrappers already on-chain (via prior factory call sequence)
// are skipped.
//
// Writes addresses to scripts/hadrian-vanilla/mints.json.

import { ethers } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { callTx } from '../_lib/gas';

// rome-solidity #218 / registry #152 (post-2026-05-25): v6 cache-track factory
const FACTORY_V6 = '0x86149124d74ebb3aa41a19641b700e88202b6285';

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

// 6 fresh assets: 1 real-world feed (wBTC) + 5 synthetic test tokens.
// Initial supply 1M (raw 10^decimals × 1M) for each.
const NEW_ASSETS = [
  { name: 'Wrapped BTC',    symbol: 'wBTC',   initialSupplyDecimal: '1000000' },
  { name: 'Wrapped Heat',   symbol: 'wHEAT',  initialSupplyDecimal: '1000000' },
  { name: 'Wrapped Salt',   symbol: 'wSALT',  initialSupplyDecimal: '1000000' },
  { name: 'Wrapped Milk',   symbol: 'wMILK',  initialSupplyDecimal: '1000000' },
  { name: 'Wrapped Oil',    symbol: 'wOIL',   initialSupplyDecimal: '1000000' },
  { name: 'Wrapped Gold',   symbol: 'wGOLD',  initialSupplyDecimal: '1000000' },
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log(`Deployer: ${signer.address}`);
  console.log(`Factory:  ${FACTORY_V6}  (v6 cache-track)`);

  const factory = new ethers.Contract(FACTORY_V6, FACTORY_ABI, signer);

  const results: any[] = [];
  for (const asset of NEW_ASSETS) {
    console.log(`\n─── ${asset.symbol} (${asset.name}) ───`);

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

    process.stdout.write(`  [1/4] factory.create_token_mint() ... `);
    let tx = await callTx(factory, 'create_token_mint', []);
    await tx.wait();
    console.log(`tx=${tx.hash}`);

    const mint: string = predictedMint;

    process.stdout.write(`  [2/4] factory.init_token_mint(mint) ... `);
    tx = await callTx(factory, 'init_token_mint', [mint]);
    await tx.wait();
    console.log(`tx=${tx.hash}`);

    process.stdout.write(`  [3/4] factory.add_spl_token_no_metadata(mint, "${asset.name}", "${asset.symbol}") ... `);
    tx = await callTx(factory, 'add_spl_token_no_metadata', [mint, asset.name, asset.symbol]);
    await tx.wait();
    console.log(`tx=${tx.hash}`);

    const wrapperAddr = await factory.token_by_mint(mint);
    console.log(`      wrapper: ${wrapperAddr}`);

    const wrapper = new ethers.Contract(wrapperAddr, WRAPPER_ABI, signer);
    const decimals = await wrapper.decimals();
    const initialSupply = ethers.BigNumber.from(asset.initialSupplyDecimal).mul(ethers.BigNumber.from(10).pow(decimals));
    process.stdout.write(`  [4/4] wrapper.mint_to(deployer, ${asset.initialSupplyDecimal} × 10^${decimals}) ... `);
    tx = await callTx(wrapper, 'mint_to', [signer.address, initialSupply]);
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
    factory: FACTORY_V6,
    deployer: signer.address,
    network: 'hadrian',
    chainId: 200010,
    wrappers: results,
  };
  const outFile = path.join('scripts', 'hadrian-vanilla', 'mints.json');
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n══════ Bootstrap COMPLETE ══════`);
  for (const w of results) {
    console.log(`  ${w.symbol.padEnd(8)} ${w.wrapper} (mint ${w.mint.slice(0, 18)}…) ${w.skipped ? '[skipped]' : ''}`);
  }
  console.log(`\nstate written: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
