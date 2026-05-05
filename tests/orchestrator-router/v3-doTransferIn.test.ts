// v3-doTransferIn.test.ts
//
// Validates the Phase 3 modification to Comet.doTransferIn: when the asset is
// the unified base token AND `from` is a pre-deposited caller, the transfer
// path uses `transferFromPreDeposited` (no SPL CPI) and verifies the ATA
// delta against a prior snapshot.
//
// We can't easily exercise the real Comet here (it has many constructor
// args + storage). Instead we deploy a `MockBaseTransferIn` harness that
// embeds the same `doTransferIn` body verbatim — the test verifies the
// branch logic. Real-Comet end-to-end is exercised via Marcus deploy in
// `scripts/marcus-phase3/`.

import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  installMockPrecompiles,
  snapshot,
  revert,
  USDC_MINT_DEVNET,
  deployUnifiedToken,
  encodeSplTokenAccountData,
  CPI_PROGRAM_ADDR,
} from '../unified-token/_helpers';

describe('Comet V3 doTransferIn (Phase 3 patch)', () => {
  let snap: string;
  beforeEach(async () => {
    await installMockPrecompiles();
    snap = await snapshot();
  });
  afterEach(async () => {
    await revert(snap);
  });

  /// SPEC: when caller is a pre-deposited caller, doTransferIn calls
  /// `transferFromPreDeposited(from, address(this), cometAta, amount)` — no
  /// SPL CPI is issued.
  it('pre-deposited caller path: snapshot + transferFromPreDeposited', async () => {
    const [admin] = await ethers.getSigners();
    const token = await deployUnifiedToken(USDC_MINT_DEVNET, 'USDC', 'USDC', 6, admin);
    const Harness = await ethers.getContractFactory('TransferInHarness');
    const harness = await Harness.deploy(token.address);
    await harness.deployed();

    // Make harness a pre-deposited caller (acts like the router).
    await token.connect(admin).grantPreDepositedCaller(harness.address);

    // Configure mock SPL data so cometAta starts at 0 USDC and ends at 1 USDC.
    const cometAta = await token.solanaAtaOf(harness.address);
    const cpi = await ethers.getContractAt('MockCpiProgram', CPI_PROGRAM_ADDR);

    // Pre-snapshot: ATA balance = 0
    await cpi.setAccountData(cometAta, encodeSplTokenAccountData(0n));

    // Snapshot cometAta from inside the harness (mimics router behavior)
    await harness.connect(admin).callSnapshot();

    // Bump ATA balance to 1 USDC (= 1_000_000 raw)
    await cpi.setAccountData(cometAta, encodeSplTokenAccountData(1_000_000n));

    // Call the V3 doTransferIn. Expects the pre-deposited branch to fire.
    await expect(harness.callDoTransferIn(harness.address, 1_000_000))
      .to.emit(token, 'PreDepositedTransfer');
  });

  /// SPEC: when caller is NOT a pre-deposited caller, doTransferIn falls back
  /// to standard transferFrom (which will CPI to SPL Token).
  it('non-pre-deposited caller path: falls through to standard transferFrom', async () => {
    const [admin, alice] = await ethers.getSigners();
    const token = await deployUnifiedToken(USDC_MINT_DEVNET, 'USDC', 'USDC', 6, admin);
    const Harness = await ethers.getContractFactory('TransferInHarness');
    const harness = await Harness.deploy(token.address);
    await harness.deployed();

    // Alice is NOT a pre-deposited caller. doTransferIn(token, alice, amount)
    // should fall through to UnifiedToken.transferFrom which fires an SPL CPI.
    // We don't expect a PreDepositedTransfer event, but a Transfer + InvokeRecorded.
    // For this test we focus on: no PreDepositedTransfer.

    // Set Alice's ATA balance + give allowance + snapshot mock balance.
    const cpi = await ethers.getContractAt('MockCpiProgram', CPI_PROGRAM_ADDR);
    const aliceAta = await token.solanaAtaOf(alice.address);
    await cpi.setAccountData(aliceAta, encodeSplTokenAccountData(10_000_000n));
    const harnessAta = await token.solanaAtaOf(harness.address);
    await cpi.setAccountData(harnessAta, encodeSplTokenAccountData(0n));

    await token.connect(alice).approve(harness.address, 1_000_000);

    // Now call doTransferIn(token, alice, 1000000)
    // Update harness ATA to simulate post-transfer balance.
    await cpi.setAccountData(harnessAta, encodeSplTokenAccountData(1_000_000n));

    const tx = await harness.callDoTransferIn(alice.address, 1_000_000);
    const rcpt = await tx.wait();
    const TOPIC = ethers.utils.id('PreDepositedTransfer(address,bytes32,uint256)');
    const preDeposited = rcpt.logs.find((l: any) => l.topics[0] === TOPIC);
    expect(preDeposited).to.equal(undefined,
      'non-pre-deposited path should NOT emit PreDepositedTransfer');
  });

  /// SPEC: when asset != baseToken (e.g. collateral), doTransferIn falls
  /// straight through to the standard path. We can verify by passing a
  /// different mock token as the asset.
  it('non-baseToken asset path: never enters pre-deposited branch', async () => {
    const [admin] = await ethers.getSigners();
    const token = await deployUnifiedToken(USDC_MINT_DEVNET, 'USDC', 'USDC', 6, admin);
    const Harness = await ethers.getContractFactory('TransferInHarness');
    const harness = await Harness.deploy(token.address);
    await harness.deployed();
    await token.connect(admin).grantPreDepositedCaller(harness.address);

    // Deploy another ERC-20 — call it as asset != baseToken
    const Erc = await ethers.getContractFactory('FaucetToken');
    const otherAsset = await Erc.deploy(
      ethers.utils.parseUnits('1000', 18),
      'Other',
      18,
      'OTH',
    );
    await otherAsset.deployed();
    // FaucetToken constructor mints to msg.sender (admin)
    await otherAsset.connect(admin).approve(harness.address, ethers.utils.parseUnits('1', 18));

    // Now call doTransferIn(otherAsset, admin, 1e18) — should NOT touch
    // the unified-token branch (asset != baseToken).
    const tx = await harness.callDoTransferInNonBase(otherAsset.address, admin.address, ethers.utils.parseUnits('1', 18));
    const rcpt = await tx.wait();
    const TOPIC = ethers.utils.id('PreDepositedTransfer(address,bytes32,uint256)');
    const preDeposited = rcpt.logs.find((l: any) => l.topics[0] === TOPIC);
    expect(preDeposited).to.equal(undefined);
  });
});
