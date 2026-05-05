// UnifiedToken — pre-deposited mode (Solana lane).
//
// Spec §5.1 Tier A mode-(a): the orchestrator program already moved SPL tokens
// from the supplier's ATA → the protocol's authority-PDA's ATA in the SAME
// Solana tx. UnifiedToken's `transferFromPreDeposited(from, to, ata, value)`
// confirms the ATA balance increased by `value` since a pre-call snapshot, and
// emits the Transfer event so the lending protocol sees a normal IERC20
// receipt.
//
// This path takes ZERO CPIs — the SPL movement already happened upstream.
// CU savings vs the EVM-lane CPI path are material (each CPI ≈ 1-7K CU).
//
// Authority: only addresses with the PRE_DEPOSITED_CALLER role can invoke
// the verify-mode (typically Compound's MetaHook callee, NOT user wallets).
// This prevents griefing where a user replays a stale snapshot to "pull"
// someone else's freshly-deposited balance.

import {
  expect, ethers,
  installMockPrecompiles,
  encodeSplTokenAccountData,
  USDC_MINT_DEVNET,
} from './_helpers';

describe('UnifiedToken — pre-deposited mode (Solana lane)', function () {
  let token: any;
  let sys: any;
  let cpi: any;
  let admin: any;
  let alice: any;
  let bob: any;
  let orchestrator: any;
  const protocolPdaAta = '0x9999999999999999999999999999999999999999999999999999999999999999';

  beforeEach(async () => {
    [admin, alice, bob, orchestrator] = await ethers.getSigners();
    ({ sys, cpi } = await installMockPrecompiles());

    const T = await ethers.getContractFactory('UnifiedToken');
    token = await T.deploy(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin.address);
    await token.deployed();

    await token.connect(admin).grantPreDepositedCaller(orchestrator.address);

    const aliceAta = '0x1111111111111111111111111111111111111111111111111111111111111111';
    await sys.setAtaFor(alice.address, USDC_MINT_DEVNET, aliceAta);
  });

  it('verifies a pre-transfer and emits Transfer without CPI', async () => {
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(0n));
    await token.connect(orchestrator).snapshotAta(protocolPdaAta);
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(50_000_000n));

    const tx = await token.connect(orchestrator).transferFromPreDeposited(
      alice.address,
      bob.address,
      protocolPdaAta,
      50_000_000,
    );
    const rcpt = await tx.wait();
    const transferEv = rcpt.events!.find((e: any) => e.event === 'Transfer');
    expect(transferEv).to.not.be.undefined;
    expect(transferEv.args.from).to.equal(alice.address);
    expect(transferEv.args.to).to.equal(bob.address);
    expect(transferEv.args.value).to.equal(50_000_000);

    // Critical: zero CPI invocations were dispatched.
    const cpiAddr = '0xFF00000000000000000000000000000000000008'.toLowerCase();
    const cpiLogs = rcpt.logs.filter(
      (l: any) => l.address.toLowerCase() === cpiAddr,
    );
    expect(cpiLogs.length).to.equal(0);
  });

  it('reverts if the post-snapshot delta is less than `value`', async () => {
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(0n));
    await token.connect(orchestrator).snapshotAta(protocolPdaAta);
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(30_000_000n));

    await expect(
      token.connect(orchestrator).transferFromPreDeposited(
        alice.address, bob.address, protocolPdaAta, 50_000_000,
      ),
    ).to.be.revertedWith('UnifiedToken: insufficient pre-deposit');
  });

  it('reverts if no snapshot exists for the recipient ATA', async () => {
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(50_000_000n));

    await expect(
      token.connect(orchestrator).transferFromPreDeposited(
        alice.address, bob.address, protocolPdaAta, 50_000_000,
      ),
    ).to.be.revertedWith('UnifiedToken: no snapshot');
  });

  it('reverts when called by a non-PRE_DEPOSITED_CALLER address', async () => {
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(0n));
    await expect(
      token.connect(bob).snapshotAta(protocolPdaAta),
    ).to.be.revertedWith('UnifiedToken: not pre-deposited caller');

    await expect(
      token.connect(bob).transferFromPreDeposited(
        alice.address, bob.address, protocolPdaAta, 50_000_000,
      ),
    ).to.be.revertedWith('UnifiedToken: not pre-deposited caller');
  });

  it('snapshot is consumed (single-use) after a successful verify', async () => {
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(0n));
    await token.connect(orchestrator).snapshotAta(protocolPdaAta);
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(50_000_000n));
    await token.connect(orchestrator).transferFromPreDeposited(
      alice.address, bob.address, protocolPdaAta, 50_000_000,
    );

    await expect(
      token.connect(orchestrator).transferFromPreDeposited(
        alice.address, bob.address, protocolPdaAta, 50_000_000,
      ),
    ).to.be.revertedWith('UnifiedToken: no snapshot');
  });

  it('emits Transfer with caller-supplied (from, to) EVM addresses', async () => {
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(0n));
    await token.connect(orchestrator).snapshotAta(protocolPdaAta);
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(50_000_000n));

    await expect(
      token.connect(orchestrator).transferFromPreDeposited(
        alice.address, bob.address, protocolPdaAta, 50_000_000,
      ),
    ).to.emit(token, 'Transfer').withArgs(alice.address, bob.address, 50_000_000);
  });

  it('two snapshots on the same ATA can both verify in the same tx (compose)', async () => {
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(0n));
    await token.connect(orchestrator).snapshotAta(protocolPdaAta);
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(50_000_000n));
    await token.connect(orchestrator).transferFromPreDeposited(
      alice.address, bob.address, protocolPdaAta, 50_000_000,
    );

    await token.connect(orchestrator).snapshotAta(protocolPdaAta);
    await cpi.setAccountData(protocolPdaAta, encodeSplTokenAccountData(80_000_000n));
    await token.connect(orchestrator).transferFromPreDeposited(
      alice.address, bob.address, protocolPdaAta, 30_000_000,
    );
  });
});
