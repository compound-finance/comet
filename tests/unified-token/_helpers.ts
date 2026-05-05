// Shared helpers for UnifiedToken tests.
//
// The contracts under test call Rome-specific precompiles
// (SystemProgram @ 0xFF...07, CpiProgram @ 0xFF...08). For Hardhat unit tests
// we deploy mock precompile contracts and overwrite the precompile addresses
// via `hre.network.provider.send('hardhat_setCode', [addr, bytecode])`.
//
// Real-world behavior (signed CPI semantics, ATA derivation against actual
// Solana programs) is exercised in the Marcus integration test in Phase 1.4.

import { ethers } from 'hardhat';
import { Contract, BigNumber, Signer } from 'ethers';
import { expect } from 'chai';

/** Solana devnet USDC mint pubkey, bytes32 form. */
export const USDC_MINT_DEVNET =
  '0x3c92cce8c0d8d5a3c1c9c19acc88f3afa635c2d3a06c81ba9b8a0d2cd62b4030';
// (placeholder — actual value bs58-decoded from 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
//  used at runtime in integration tests; for unit tests the value just has to be
//  non-zero and unique. Tests assert identity, not derivation correctness.)

/** A second mint so parameterized-mint tests can compare two instances. */
export const USDS_MINT_PLACEHOLDER =
  '0xff112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/** A third mint for triple-instance isolation tests. */
export const JUPUSD_MINT_PLACEHOLDER =
  '0xff998877665544332211aabbccddeeff00112233445566778899aabbccddeeff';

export const SYSTEM_PROGRAM_ADDR = '0xfF00000000000000000000000000000000000007';
export const CPI_PROGRAM_ADDR = '0xFF00000000000000000000000000000000000008';

/**
 * Install MockPrecompile contracts at the canonical precompile addresses so
 * Solidity calls to SystemProgram / CpiProgram resolve to test logic.
 *
 * Returns the deployed mock contracts so the test can stub specific responses.
 *
 * IMPORTANT: state inside the precompile addresses persists across tests
 * because `hardhat_setCode` overwrites bytecode but not storage. Tests using
 * this helper rely on a snapshot/revert wrap; a fresh installMockPrecompiles
 * call resets storage to all-zero by overwriting bytecode AND clearing
 * storage via hardhat_setStorageAt for the few touched slots.
 */
/**
 * Strategy: each beforeEach uses a fresh hardhat snapshot. The first call
 * to installMockPrecompiles() in this test process deploys the mocks at the
 * precompile addresses; subsequent calls in later tests *re-snapshot*, so
 * mock storage is reset to its post-deploy state. This is the canonical
 * Hardhat test isolation pattern and avoids needing per-mock `clear()`
 * methods.
 */
let _baseSnapshot: string | null = null;

export async function installMockPrecompiles() {
  const MockSystemProgram = await ethers.getContractFactory('MockSystemProgram');
  const MockCpiProgram = await ethers.getContractFactory('MockCpiProgram');

  if (_baseSnapshot === null) {
    // First call in the test process — deploy mocks fresh.
    const sysImpl = await MockSystemProgram.deploy();
    await sysImpl.deployed();
    const cpiImpl = await MockCpiProgram.deploy();
    await cpiImpl.deployed();
    const sysCode = await ethers.provider.getCode(sysImpl.address);
    const cpiCode = await ethers.provider.getCode(cpiImpl.address);
    await ethers.provider.send('hardhat_setCode', [SYSTEM_PROGRAM_ADDR, sysCode]);
    await ethers.provider.send('hardhat_setCode', [CPI_PROGRAM_ADDR, cpiCode]);
    _baseSnapshot = await ethers.provider.send('evm_snapshot', []);
  } else {
    // Subsequent call — revert to clean post-deploy state and re-snapshot.
    const ok = await ethers.provider.send('evm_revert', [_baseSnapshot]);
    if (!ok) {
      throw new Error('Failed to revert snapshot — did a test mutate without snapshotting?');
    }
    _baseSnapshot = await ethers.provider.send('evm_snapshot', []);
  }

  const sys = MockSystemProgram.attach(SYSTEM_PROGRAM_ADDR);
  const cpi = MockCpiProgram.attach(CPI_PROGRAM_ADDR);
  return { sys, cpi };
}

/** Take a snapshot of the EVM state. Use in beforeEach + revert in afterEach. */
export async function snapshot(): Promise<string> {
  return await ethers.provider.send('evm_snapshot', []);
}
export async function revert(snapshotId: string): Promise<void> {
  await ethers.provider.send('evm_revert', [snapshotId]);
}

/**
 * Deploy a UnifiedToken with the calling signer (default first signer) as admin.
 * Reduces test boilerplate.
 */
export async function deployUnifiedToken(
  mint: string,
  name: string,
  symbol: string,
  dec: number,
  admin?: any,
) {
  const T = await ethers.getContractFactory('UnifiedToken');
  const adminAddr = admin?.address ?? (await ethers.getSigners())[0].address;
  const token = await T.deploy(mint, name, symbol, dec, adminAddr);
  await token.deployed();
  return token;
}

/**
 * Extract InvokeRecorded events from a tx receipt. Used for asserting CPI
 * invocations: under delegatecall, the mock's events stamp to UnifiedToken's
 * address but topic0 = keccak256("InvokeRecorded(bytes32,bool,bytes32,uint256)")
 * is unique. Tests filter by topic and decode the args.
 */
export function extractInvokeRecorded(rcpt: any) {
  // topic0 = keccak256("InvokeRecorded(bytes32,bool,bytes32,uint256)")
  const TOPIC0 = ethers.utils.id('InvokeRecorded(bytes32,bool,bytes32,uint256)');
  const calls = rcpt.logs
    .filter((l: any) => l.topics[0] === TOPIC0)
    .map((l: any) => ({
      programId: l.topics[1],
      // bool indexed encoded as bytes32 — non-zero = true.
      signed: !ethers.BigNumber.from(l.topics[2]).isZero(),
      dataHash: ethers.utils.hexDataSlice(l.data, 0, 32),
      accountCount: ethers.BigNumber.from(ethers.utils.hexDataSlice(l.data, 32, 64)).toNumber(),
    }));
  return calls;
}

/** Convert a u64 amount into Borsh-encoded SPL Token Account data (165 bytes). */
export function encodeSplTokenAccountData(amount: bigint, owner?: string, mint?: string): string {
  // Layout (165 bytes total):
  //   mint:                 bytes32              (offset 0..32)
  //   owner:                bytes32              (offset 32..64)
  //   amount:               u64 LE               (offset 64..72)
  //   delegate:             COption<bytes32>     (offset 72..108)
  //   state:                u8                   (offset 108..109)
  //   is_native:            COption<u64>         (offset 109..121)
  //   delegated_amount:     u64 LE               (offset 121..129)
  //   close_authority:      COption<bytes32>     (offset 129..165)
  const buf = Buffer.alloc(165);
  if (mint) Buffer.from(mint.slice(2), 'hex').copy(buf, 0);
  if (owner) Buffer.from(owner.slice(2), 'hex').copy(buf, 32);
  // amount LE
  for (let i = 0; i < 8; i++) {
    buf[64 + i] = Number((amount >> BigInt(i * 8)) & 0xffn);
  }
  // delegate COption tag = 0 (None)
  // state = 1 (Initialized)
  buf[108] = 1;
  // is_native COption tag = 0 (None)
  // delegated_amount = 0
  // close_authority COption = 0
  return '0x' + buf.toString('hex');
}

/** Encode an SPL mint account (82 bytes). */
export function encodeSplMintData(supply: bigint, decimals: number): string {
  const buf = Buffer.alloc(82);
  // mint_authority COption tag = 1 + 32 bytes (use zero pubkey)
  buf[0] = 1;
  // supply (offset 36..44) — actually offset 36 because mint_authority is 36 bytes (4 tag + 32)
  for (let i = 0; i < 8; i++) {
    buf[36 + i] = Number((supply >> BigInt(i * 8)) & 0xffn);
  }
  // decimals (offset 44)
  buf[44] = decimals;
  // is_initialized = 1
  buf[45] = 1;
  // freeze_authority COption tag = 0
  return '0x' + buf.toString('hex');
}

/** Get an EIP-712 typed data signature for ERC-2612 permit. */
export async function signPermit(
  signer: Signer,
  token: Contract,
  owner: string,
  spender: string,
  value: BigNumber,
  nonce: BigNumber,
  deadline: number,
  chainId: number,
) {
  const name = await token.name();
  const verifyingContract = token.address;
  const domain = {
    name,
    version: '1',
    chainId,
    verifyingContract,
  };
  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  const message = { owner, spender, value, nonce, deadline };
  // @ts-ignore -- ethers v5 type narrowing on _signTypedData
  const signature = await signer._signTypedData(domain, types, message);
  return ethers.utils.splitSignature(signature);
}

export { expect, ethers };
