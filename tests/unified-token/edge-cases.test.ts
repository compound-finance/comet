// UnifiedToken — edge cases, failure modes, reentrancy.
//
// Comprehensive surface for adversarial inputs. Per spec §6 "Failure-mode
// tests required":
//   - Insufficient balance / allowance
//   - Authority mismatch (wrong signer)
//   - Reentrancy (UnifiedToken specifically)
//   - Stale snapshots
//   - Amount > uint64 (SPL native limit)
//   - Self-transfer

import {
  expect, ethers,
  installMockPrecompiles,
  encodeSplTokenAccountData,
  USDC_MINT_DEVNET,
} from './_helpers';

describe('UnifiedToken — edge cases', function () {
  let token: any;
  let sys: any;
  let cpi: any;
  let admin: any;
  let alice: any;
  let bob: any;
  let mallory: any;
  let orchestrator: any;

  beforeEach(async () => {
    [admin, alice, bob, mallory, orchestrator] = await ethers.getSigners();
    ({ sys, cpi } = await installMockPrecompiles());

    const T = await ethers.getContractFactory('UnifiedToken');
    token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    await token.connect(admin).grantPreDepositedCaller(orchestrator.address);

    const aliceAta = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const bobAta = '0x2222222222222222222222222222222222222222222222222222222222222222';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceAta);
    await sys.setAtaFor(bob.address, USDC_MINT_DEVNET, bobAta);
    await cpi.setAccountData(aliceAta, encodeSplTokenAccountData(100_000_000n));
    await cpi.setAccountData(bobAta, encodeSplTokenAccountData(0n));
  });

  it('zero-amount transferFrom does not decrement allowance', async () => {
    await token.connect(alice).approve(bob.address, 100_000_000);
    await token.connect(bob).transferFrom(alice.address, bob.address, 0);
    expect(await token.allowance(alice.address, bob.address)).to.equal(100_000_000);
  });

  it('self-transfer is allowed and emits Transfer', async () => {
    await expect(token.connect(alice).transfer(alice.address, 10_000_000))
      .to.emit(token, 'Transfer')
      .withArgs(alice.address, alice.address, 10_000_000);
  });

  it('amount = uint64.max is accepted', async () => {
    const u64Max = (1n << 64n) - 1n;
    // Stub alice with enough balance (mock-only).
    const aliceAta = await sys.getAtaFor(alice.address, USDC_MINT_DEVNET);
    await cpi.setAccountData(aliceAta, encodeSplTokenAccountData(u64Max));

    // The CPI will be issued with amount = u64.max; mock CPI returns success.
    await token.connect(alice).transfer(bob.address, u64Max);
  });

  it('amount = uint64.max + 1 reverts before CPI', async () => {
    const tooBig = 1n << 64n;
    await expect(
      token.connect(alice).transfer(bob.address, tooBig),
    ).to.be.revertedWith('UnifiedToken: amount exceeds uint64');
  });

  it('admin can revoke pre-deposited caller role', async () => {
    expect(await token.isPreDepositedCaller(orchestrator.address)).to.equal(true);
    await token.connect(admin).revokePreDepositedCaller(orchestrator.address);
    expect(await token.isPreDepositedCaller(orchestrator.address)).to.equal(false);

    // Now snapshot fails for the revoked address.
    const proto = '0x9999999999999999999999999999999999999999999999999999999999999999';
    await expect(
      token.connect(orchestrator).snapshotAta(proto),
    ).to.be.revertedWith('UnifiedToken: not pre-deposited caller');
  });

  it('non-admin cannot grant or revoke roles', async () => {
    await expect(
      token.connect(mallory).grantPreDepositedCaller(mallory.address),
    ).to.be.revertedWith('UnifiedToken: not admin');

    await expect(
      token.connect(mallory).revokePreDepositedCaller(orchestrator.address),
    ).to.be.revertedWith('UnifiedToken: not admin');
  });

  it('reentrancy protection: nested transfer in mock-CPI hook reverts', async () => {
    // Replace MockCpiProgram bytecode with the reentrancy-attacker variant
    // for this test. Its invoke_signed re-enters UnifiedToken.transfer
    // unconditionally; the reentrancy guard MUST trip.
    const Attacker = await ethers.getContractFactory('MockCpiReentrancyAttacker');
    const impl = await Attacker.deploy();
    await impl.deployed();
    const code = await ethers.provider.getCode(impl.address);
    await ethers.provider.send('hardhat_setCode', [
      '0xFF00000000000000000000000000000000000008',
      code,
    ]);

    await expect(
      token.connect(alice).transfer(bob.address, 10_000_000),
    ).to.be.revertedWith('ReentrancyGuard: reentrant call');
  });

  it('admin role transfers via two-step transferAdmin', async () => {
    await token.connect(admin).transferAdmin(bob.address);
    // Two-step: bob must accept.
    await expect(
      token.connect(mallory).acceptAdmin(),
    ).to.be.revertedWith('UnifiedToken: not pending admin');
    await token.connect(bob).acceptAdmin();
    // After acceptance, bob is admin; old admin loses privileges.
    await expect(
      token.connect(admin).grantPreDepositedCaller(mallory.address),
    ).to.be.revertedWith('UnifiedToken: not admin');
    await token.connect(bob).grantPreDepositedCaller(mallory.address);
    expect(await token.isPreDepositedCaller(mallory.address)).to.equal(true);
  });

  it('grant of zero address reverts', async () => {
    await expect(
      token.connect(admin).grantPreDepositedCaller(ethers.constants.AddressZero),
    ).to.be.revertedWith('UnifiedToken: zero caller');
  });
});
