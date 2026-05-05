// UnifiedToken — transfer / transferFrom on the EVM lane (CPI to SPL Token).
//
// Spec §5.1 Tier A mode-(b): caller signs an EVM tx; UnifiedToken decrements
// the source authority-PDA's ATA via signed CPI to SPL Token. Same source of
// truth as balanceOf reads — the EVM lane never maintains a separate ledger.
//
// Authority semantics: the CPI is signed as the *spender's* (or owner's, on
// direct transfer) authority PDA, derived from their EVM address. This is
// the canonical "user's Rome account is a PDA on Solana" pattern — same as
// SPL_ERC20 / Cardo adapters.

import {
  expect, ethers,
  installMockPrecompiles,
  encodeSplTokenAccountData,
  USDC_MINT_DEVNET,
  extractInvokeRecorded,
} from './_helpers';

describe('UnifiedToken — transfers via CPI (EVM lane)', function () {
  let token: any;
  let sys: any;
  let cpi: any;
  let admin: any;
  let alice: any;
  let bob: any;
  let charlie: any;

  beforeEach(async () => {
    [admin, alice, bob, charlie] = await ethers.getSigners();
    ({ sys, cpi } = await installMockPrecompiles());

    const T = await ethers.getContractFactory('UnifiedToken');
    token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    await token.deployed();

    // Pre-populate alice's ATA with 100 USDC.
    const aliceAta = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const bobAta   = '0x2222222222222222222222222222222222222222222222222222222222222222';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceAta);
    await sys.setAtaFor(bob.address, USDC_MINT_DEVNET, bobAta);
    await cpi.setAccountData(aliceAta, encodeSplTokenAccountData(100_000_000n));
    await cpi.setAccountData(bobAta, encodeSplTokenAccountData(0n));
  });

  it('transfer() invokes a signed CPI to SPL Token transfer_checked', async () => {
    const tx = await token.connect(alice).transfer(bob.address, 10_000_000);
    const rcpt = await tx.wait();

    // Mock CPI emits InvokeRecorded under delegatecall — read from logs.
    const calls = extractInvokeRecorded(rcpt);
    expect(calls.length).to.equal(1);
    expect(calls[0].signed).to.equal(true);
    expect(calls[0].programId).to.equal(
      '0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9', // Tokenkeg
    );
    expect(calls[0].accountCount).to.equal(4); // source, mint, dest, authority
  });

  it('transfer() emits IERC20.Transfer with EVM addresses', async () => {
    await expect(token.connect(alice).transfer(bob.address, 10_000_000))
      .to.emit(token, 'Transfer')
      .withArgs(alice.address, bob.address, 10_000_000);
  });

  it('transferFrom() spends the EVM-side allowance and CPIs as owner PDA', async () => {
    // Alice approves Charlie to spend 50 USDC.
    await token.connect(alice).approve(charlie.address, 50_000_000);
    expect(await token.allowance(alice.address, charlie.address)).to.equal(50_000_000);

    // Charlie pulls 30 USDC from Alice → Bob.
    await expect(
      token.connect(charlie).transferFrom(alice.address, bob.address, 30_000_000),
    ).to.emit(token, 'Transfer').withArgs(alice.address, bob.address, 30_000_000);

    expect(await token.allowance(alice.address, charlie.address)).to.equal(20_000_000);
  });

  it('transferFrom() with type(uint256).max allowance does not decrement', async () => {
    const MAX = ethers.constants.MaxUint256;
    await token.connect(alice).approve(charlie.address, MAX);

    await token.connect(charlie).transferFrom(alice.address, bob.address, 30_000_000);

    expect(await token.allowance(alice.address, charlie.address)).to.equal(MAX);
  });

  it('transferFrom() reverts on insufficient allowance', async () => {
    await token.connect(alice).approve(charlie.address, 5_000_000);

    await expect(
      token.connect(charlie).transferFrom(alice.address, bob.address, 30_000_000),
    ).to.be.revertedWith('ERC20: insufficient allowance');
  });

  it('transfer to zero address reverts', async () => {
    await expect(
      token.connect(alice).transfer(ethers.constants.AddressZero, 1),
    ).to.be.revertedWith('ERC20: transfer to the zero address');
  });

  it('amount > uint64 max reverts', async () => {
    const tooBig = (1n << 65n);
    await expect(
      token.connect(alice).transfer(bob.address, tooBig),
    ).to.be.revertedWith('UnifiedToken: amount exceeds uint64');
  });

  it('CPI invocation is recorded with signed=true', async () => {
    // For transferFrom under delegatecall, the precompile signs as the
    // caller frame's AUTHORITY_PDA. In our test mock the signed flag just
    // confirms invoke_signed was used (vs unsigned invoke); the precompile-
    // side seeds-vs-caller derivation is exercised in Phase 1.4 on Marcus.
    await token.connect(alice).approve(charlie.address, 10_000_000);
    const tx = await token.connect(charlie).transferFrom(alice.address, bob.address, 10_000_000);
    const rcpt = await tx.wait();

    const calls = extractInvokeRecorded(rcpt);
    expect(calls.length).to.equal(1);
    expect(calls[calls.length - 1].signed).to.equal(true);
  });
});
