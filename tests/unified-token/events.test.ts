// UnifiedToken — IERC20 event emission consistency.
//
// Quaestor explicitly flagged this in Phase 1.3's required checks:
// "Cross-implementation drift between the verify-pre-transfer path and the
//  CPI path; event emission consistency".
//
// Both transfer paths (CPI + pre-deposited) MUST emit identical IERC20.Transfer
// events with the same (from, to, value) signature. Approval events fire on
// approve / increaseAllowance / decreaseAllowance / permit. transferFrom does
// NOT emit Approval (matches OZ canonical behavior since OZ 4.0.x).

import {
  expect, ethers,
  installMockPrecompiles,
  encodeSplTokenAccountData,
  USDC_MINT_DEVNET,
  signPermit,
} from './_helpers';

describe('UnifiedToken — events', function () {
  let token: any;
  let sys: any;
  let cpi: any;
  let admin: any;
  let alice: any;
  let bob: any;
  let orchestrator: any;
  let chainId: number;

  beforeEach(async () => {
    [admin, alice, bob, orchestrator] = await ethers.getSigners();
    ({ sys, cpi } = await installMockPrecompiles());

    const T = await ethers.getContractFactory('UnifiedToken');
    token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    await token.deployed();
    await token.connect(admin).grantPreDepositedCaller(orchestrator.address);

    chainId = (await ethers.provider.getNetwork()).chainId;

    const aliceAta = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const bobAta = '0x2222222222222222222222222222222222222222222222222222222222222222';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceAta);
    await sys.setAtaFor(bob.address, USDC_MINT_DEVNET, bobAta);
    await cpi.setAccountData(aliceAta, encodeSplTokenAccountData(1_000_000_000n));
    await cpi.setAccountData(bobAta, encodeSplTokenAccountData(0n));
  });

  it('CPI-mode transfer emits Transfer(from, to, value)', async () => {
    await expect(token.connect(alice).transfer(bob.address, 50_000_000))
      .to.emit(token, 'Transfer')
      .withArgs(alice.address, bob.address, 50_000_000);
  });

  it('CPI-mode transferFrom emits Transfer(from, to, value)', async () => {
    await token.connect(alice).approve(bob.address, 100_000_000);

    await expect(token.connect(bob).transferFrom(alice.address, bob.address, 50_000_000))
      .to.emit(token, 'Transfer')
      .withArgs(alice.address, bob.address, 50_000_000);
  });

  it('CPI-mode transferFrom does NOT emit Approval (OZ canonical)', async () => {
    await token.connect(alice).approve(bob.address, 100_000_000);

    const tx = await token.connect(bob).transferFrom(alice.address, bob.address, 50_000_000);
    const rcpt = await tx.wait();
    const approvalEvents = rcpt.events!.filter((e: any) => e.event === 'Approval');
    expect(approvalEvents).to.have.length(0);
  });

  it('pre-deposited mode transfer emits the SAME Transfer signature as CPI-mode', async () => {
    const protoAta = '0x9999999999999999999999999999999999999999999999999999999999999999';
    await cpi.setAccountData(protoAta, encodeSplTokenAccountData(0n));
    await token.connect(orchestrator).snapshotAta(protoAta);
    await cpi.setAccountData(protoAta, encodeSplTokenAccountData(50_000_000n));

    await expect(
      token.connect(orchestrator).transferFromPreDeposited(alice.address, bob.address, protoAta, 50_000_000),
    ).to.emit(token, 'Transfer').withArgs(alice.address, bob.address, 50_000_000);
  });

  it('approve emits Approval', async () => {
    await expect(token.connect(alice).approve(bob.address, 100_000_000))
      .to.emit(token, 'Approval')
      .withArgs(alice.address, bob.address, 100_000_000);
  });

  it('permit emits Approval', async () => {
    const value = ethers.BigNumber.from(100_000_000);
    const nonce = await token.nonces(alice.address);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const sig = await signPermit(alice, token, alice.address, bob.address, value, nonce, deadline, chainId);

    await expect(
      token.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s),
    ).to.emit(token, 'Approval').withArgs(alice.address, bob.address, value);
  });

  it('zero-amount transfer still emits Transfer (ERC-20 compliant)', async () => {
    await expect(token.connect(alice).transfer(bob.address, 0))
      .to.emit(token, 'Transfer')
      .withArgs(alice.address, bob.address, 0);
  });
});
