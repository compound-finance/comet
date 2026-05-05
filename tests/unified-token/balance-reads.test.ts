// UnifiedToken — balanceOf reads from Solana ATA via SystemProgram precompile.
//
// Spec §5.1 / §11a: balanceOf(account) returns the SPL token amount held in
// the user's authority-PDA's ATA on Solana, NOT a Solidity-side ledger entry.
// This is the wallet-canonical model — same place a Phantom wallet would see
// the user's USDC. Bridged-in users (CCTP mint to auth-PDA's ATA), Solana-lane
// suppliers, and Phase 3 orchestrator-driven flows all converge on this single
// source of truth.

import {
  expect, ethers,
  installMockPrecompiles,
  encodeSplTokenAccountData,
  USDC_MINT_DEVNET,
} from './_helpers';

describe('UnifiedToken — balance reads', function () {
  let token: any;
  let sys: any;
  let cpi: any;
  let owner: any;
  let alice: any;
  let bob: any;

  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    ({ sys, cpi } = await installMockPrecompiles());

    // Deploy the mint as an account first (mock encodes mint data).
    const MintFactory = await ethers.getContractFactory('UnifiedToken');
    token = await MintFactory.deploy(
      USDC_MINT_DEVNET,
      'Unified USDC',
      'USDC',
      6, // decimals
      owner.address,
    );
    await token.deployed();
  });

  it('reads balance from the user authority-PDA ATA', async () => {
    // Stub the ATA derivation result for alice.
    const aliceAta = '0x1111111111111111111111111111111111111111111111111111111111111111';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceAta);

    // Stub the SPL token account at that ATA to hold 100e6 USDC.
    await cpi.setAccountData(aliceAta, encodeSplTokenAccountData(100_000_000n));

    const bal = await token.balanceOf(alice.address);
    expect(bal).to.equal(100_000_000);
  });

  it('returns zero when the ATA does not yet exist', async () => {
    // No ATA stubbed → mock returns empty data → contract MUST treat as 0.
    const bal = await token.balanceOf(alice.address);
    expect(bal).to.equal(0);
  });

  it('different users return independent balances', async () => {
    const aliceAta = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const bobAta   = '0x2222222222222222222222222222222222222222222222222222222222222222';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceAta);
    await sys.setAtaFor(bob.address, USDC_MINT_DEVNET, bobAta);
    await cpi.setAccountData(aliceAta, encodeSplTokenAccountData(50_000_000n));
    await cpi.setAccountData(bobAta, encodeSplTokenAccountData(75_000_000n));

    expect(await token.balanceOf(alice.address)).to.equal(50_000_000);
    expect(await token.balanceOf(bob.address)).to.equal(75_000_000);
  });

  it('totalSupply reads from the SPL mint account', async () => {
    const { encodeSplMintData } = await import('./_helpers');
    await cpi.setAccountData(USDC_MINT_DEVNET, encodeSplMintData(1_000_000_000_000n, 6));
    expect(await token.totalSupply()).to.equal(1_000_000_000_000n);
  });

  it('balanceOf is a pure read (does not modify state)', async () => {
    const aliceAta = '0x1111111111111111111111111111111111111111111111111111111111111111';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceAta);
    await cpi.setAccountData(aliceAta, encodeSplTokenAccountData(100_000_000n));

    const bal1 = await token.balanceOf(alice.address);
    const bal2 = await token.balanceOf(alice.address);
    expect(bal1).to.equal(bal2);
  });

  it('reverts gracefully when SPL data malformed', async () => {
    // 165-byte SPL token account expected; provide 32 bytes.
    const aliceAta = '0x1111111111111111111111111111111111111111111111111111111111111111';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceAta);
    await cpi.setAccountData(aliceAta, '0x' + '00'.repeat(32));

    await expect(token.balanceOf(alice.address)).to.be.reverted;
  });
});
