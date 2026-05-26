// Deploy CompoundFaucet on Hadrian, pre-funded with the 5 mock collats
// (wHEAT / wSALT / wMILK / wOIL / wGOLD) for the demo's /faucet page.
//
// Aave-parity drops per claim:
//   - 10 native gas (10e18 wei)
//   - 100 of each mock wrapper
//
// Pre-fund target: 1000 claims worth — operator can refill any time by
// transferring more native or wrapper balance to the faucet address.
//
// Idempotent re-runs: if state.json already has a faucet address, we
// reuse it and only top up balances. Skips addToken on an already-
// registered token (the contract would push duplicates; we don't want
// that). Writes back to state.json.
import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'hardhat';
import type { Contract } from 'ethers';
import { callTx, deployContract } from '../_lib/gas';

const STATE_PATH = path.resolve(__dirname, 'state.json');

const MOCK_SYMBOLS = ['wHEAT', 'wSALT', 'wMILK', 'wOIL', 'wGOLD'] as const;
const TOKENS_PER_CLAIM = 100n;   // human units
const NATIVE_PER_CLAIM = 10n;    // 10 native (wei = 10e18)
const RESERVE_CLAIMS = 1000n;    // pre-fund a thousand claims

// ERC20 minimal ABI for transfer + balanceOf + decimals (decimals already in state.json)
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));

  const collats = state.collateralAssets.filter((c: { symbol: string }) =>
    (MOCK_SYMBOLS as readonly string[]).includes(c.symbol),
  );
  if (collats.length !== MOCK_SYMBOLS.length) {
    throw new Error(
      `state.json missing one of ${MOCK_SYMBOLS.join(',')}; found only ${collats.map((c: any) => c.symbol).join(',')}`,
    );
  }

  // ── 1. Deploy or reuse Faucet ───────────────────────────────────────
  const Faucet = await ethers.getContractFactory('CompoundFaucet', deployer);
  const gasDropWei = NATIVE_PER_CLAIM * 10n ** 18n;
  const seedNative = gasDropWei * RESERVE_CLAIMS;

  let faucetAddress: string | undefined = state.faucet?.address;
  if (!faucetAddress) {
    console.log(`[1/3] Deploying CompoundFaucet with gasDrop=${NATIVE_PER_CLAIM} native, seedNative=${RESERVE_CLAIMS * NATIVE_PER_CLAIM} native...`);
    const faucet = await deployContract<Contract>(Faucet, [gasDropWei], { value: seedNative });
    faucetAddress = faucet.address;
    console.log(`    Faucet: ${faucetAddress}`);
  } else {
    console.log(`[1/3] Reusing existing Faucet at ${faucetAddress}`);
  }

  const faucet = new ethers.Contract(
    faucetAddress!,
    [
      'function addToken(address token, uint256 amount) external',
      'function tokenDrop(address) external view returns (uint256)',
      'function tokenList() external view returns (address[])',
      'function owner() external view returns (address)',
    ],
    deployer,
  );

  // ── 2. Register tokens (skip already-registered) ────────────────────
  const existing: string[] = (await faucet.tokenList()).map((a: string) => a.toLowerCase());
  for (const c of collats) {
    const drop = TOKENS_PER_CLAIM * 10n ** BigInt(c.decimals);
    if (existing.includes(c.address.toLowerCase())) {
      console.log(`[2/3] ${c.symbol} already registered, skipping`);
      continue;
    }
    console.log(`[2/3] addToken(${c.symbol}=${c.address}, drop=${drop})...`);
    await callTx(faucet, 'addToken', [c.address, drop]);
  }

  // ── 3. Pre-fund each token to RESERVE_CLAIMS × drop ─────────────────
  for (const c of collats) {
    const drop = TOKENS_PER_CLAIM * 10n ** BigInt(c.decimals);
    const target = drop * RESERVE_CLAIMS;
    const token = new ethers.Contract(c.address, ERC20_ABI, deployer);
    const current: bigint = (await token.balanceOf(faucetAddress!)).toBigInt();
    if (current >= target) {
      console.log(`[3/3] ${c.symbol} reserve already ${current} ≥ target ${target}, skipping`);
      continue;
    }
    const need = target - current;
    console.log(`[3/3] Transferring ${need} ${c.symbol} to faucet (current=${current}, target=${target})`);
    await callTx(token, 'transfer', [faucetAddress!, need]);
  }

  // ── Write back to state.json ────────────────────────────────────────
  state.faucet = {
    address: faucetAddress,
    gasDropWei: gasDropWei.toString(),
    tokens: collats.map((c: { symbol: string; address: string; decimals: number }) => ({
      symbol: c.symbol,
      address: c.address,
      decimals: c.decimals,
      dropAmountWei: (TOKENS_PER_CLAIM * 10n ** BigInt(c.decimals)).toString(),
    })),
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  console.log(`\nFaucet deployed + funded. state.json updated.`);
  console.log(`  faucet: ${faucetAddress}`);
  console.log(`  gasDrop: ${NATIVE_PER_CLAIM} native (${gasDropWei} wei)`);
  for (const c of collats) {
    console.log(`  ${c.symbol}: ${TOKENS_PER_CLAIM} per claim (${c.address})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
