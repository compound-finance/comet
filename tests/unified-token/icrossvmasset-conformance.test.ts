// UnifiedToken — ICrossVMAsset interface conformance.
//
// Per spec §1b + §11a: ICrossVMAsset is the foundational interface that
// successor lending protocols target. Any UnifiedToken-shaped contract MUST
// implement it. This decouples lending logic from per-asset implementation —
// Compound v3 reads ICrossVMAsset; Morpho's vaults read ICrossVMAsset; Sky's
// USDS adapters read ICrossVMAsset. Same surface, swap the underlying mint.
//
// Methods on ICrossVMAsset (exhaustive):
//   - All of IERC20 / IERC20Metadata
//   - mintId() returns the underlying SPL pubkey
//   - solanaAtaOf(account) returns the canonical ATA pubkey for an EVM addr
//   - transferFromPreDeposited(from, recipientAta, value) — Solana-lane verify
//   - snapshotAta(ata) — pair to transferFromPreDeposited
//   - grantPreDepositedCaller / revokePreDepositedCaller — admin role mgmt
//
// Conformance gate: bytecode of any ICrossVMAsset-claiming contract MUST
// have all method selectors present.

import {
  expect, ethers,
  installMockPrecompiles,
  USDC_MINT_DEVNET,
} from './_helpers';

describe('UnifiedToken — ICrossVMAsset conformance', function () {
  let token: any;
  let admin: any;

  beforeEach(async () => {
    [admin] = await ethers.getSigners();
    await installMockPrecompiles();
    const T = await ethers.getContractFactory('UnifiedToken');
    token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
  });

  it('exposes all IERC20 selectors', async () => {
    expect(token.interface.getFunction('totalSupply')).to.not.be.undefined;
    expect(token.interface.getFunction('balanceOf')).to.not.be.undefined;
    expect(token.interface.getFunction('transfer')).to.not.be.undefined;
    expect(token.interface.getFunction('transferFrom')).to.not.be.undefined;
    expect(token.interface.getFunction('approve')).to.not.be.undefined;
    expect(token.interface.getFunction('allowance')).to.not.be.undefined;
  });

  it('exposes all IERC20Metadata selectors', async () => {
    expect(token.interface.getFunction('name')).to.not.be.undefined;
    expect(token.interface.getFunction('symbol')).to.not.be.undefined;
    expect(token.interface.getFunction('decimals')).to.not.be.undefined;
  });

  it('exposes ICrossVMAsset Rome-specific selectors', async () => {
    expect(token.interface.getFunction('mintId')).to.not.be.undefined;
    expect(token.interface.getFunction('solanaAtaOf')).to.not.be.undefined;
    expect(token.interface.getFunction('transferFromPreDeposited')).to.not.be.undefined;
    expect(token.interface.getFunction('snapshotAta')).to.not.be.undefined;
    expect(token.interface.getFunction('grantPreDepositedCaller')).to.not.be.undefined;
    expect(token.interface.getFunction('revokePreDepositedCaller')).to.not.be.undefined;
  });

  it('supportsInterface returns true for IERC20 + ICrossVMAsset', async () => {
    // ERC-165: 0x36372b07 = IERC20 (computed offline)
    // ICrossVMAsset interface ID — implementation defines.
    const IERC20Id = '0x36372b07';
    const ICrossVMAssetId = await token.ICROSS_VM_ASSET_INTERFACE_ID();
    expect(await token.supportsInterface(IERC20Id)).to.equal(true);
    expect(await token.supportsInterface(ICrossVMAssetId)).to.equal(true);
  });

  it('mintId returns the constructor mint pubkey', async () => {
    expect(await token.mintId()).to.equal(USDC_MINT_DEVNET);
  });

  it('solanaAtaOf returns a deterministic ATA for an EVM addr', async () => {
    const [admin, alice] = await ethers.getSigners();
    const ata1 = await token.solanaAtaOf(alice.address);
    const ata2 = await token.solanaAtaOf(alice.address);
    expect(ata1).to.equal(ata2);
    // Different EVM address → different ATA.
    const [, , bob] = await ethers.getSigners();
    const bobAta = await token.solanaAtaOf(bob.address);
    expect(bobAta).to.not.equal(ata1);
  });
});
