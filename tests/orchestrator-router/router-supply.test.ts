// router-supply.test.ts
//
// Unit tests for the two-phase relayer-gated OrchestratorRouter:
//   - snapshotForPendingSupply (phase 1)
//   - completeSupplyForUser    (phase 2)
//
// The two-phase split exists because the cometAta snapshot must be taken
// BEFORE the user's SPL deposit lands. A single synchronous call cannot
// straddle that ordering, so the relayer drives both phases off-chain
// around the user's Solana SPL transfer.
//
// MockComet records the supplyTo call without actually invoking
// `transferFromPreDeposited` — the V3 doTransferIn path is exercised
// separately in v3-doTransferIn.test.ts.
//
// Helpers reused from ../unified-token/_helpers.

import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  installMockPrecompiles,
  snapshot,
  revert,
  USDC_MINT_DEVNET,
  deployUnifiedToken,
} from '../unified-token/_helpers';

describe('OrchestratorRouter (two-phase relayer flow)', () => {
  let snap: string;
  beforeEach(async () => {
    await installMockPrecompiles();
    snap = await snapshot();
  });
  afterEach(async () => {
    await revert(snap);
  });

  async function deployRouterStack() {
    const [admin, relayer, otherRelayer, outsider] = await ethers.getSigners();
    const token = await deployUnifiedToken(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin);
    const Comet = await ethers.getContractFactory('MockComet');
    const comet = await Comet.deploy(token.address);
    await comet.deployed();
    const Router = await ethers.getContractFactory('OrchestratorRouter');
    const router = await Router.deploy(comet.address, token.address, relayer.address);
    await router.deployed();
    // Router needs the pre-deposited caller role to snapshotAta + drive
    // transferFromPreDeposited on the unified token.
    await token.connect(admin).grantPreDepositedCaller(router.address);
    return { admin, relayer, otherRelayer, outsider, token, comet, router };
  }

  /// SPEC: constructor pins `baseAsset = unifiedToken` and reverts on mismatch.
  it('constructor reverts when comet.baseToken != unifiedToken', async () => {
    const [admin, relayer] = await ethers.getSigners();
    const tokenA = await deployUnifiedToken(USDC_MINT_DEVNET, 'A', 'A', 6, admin);
    const tokenB = await deployUnifiedToken(USDC_MINT_DEVNET, 'B', 'B', 6, admin);
    const Comet = await ethers.getContractFactory('MockComet');
    const cometWithA = await Comet.deploy(tokenA.address);
    const Router = await ethers.getContractFactory('OrchestratorRouter');
    await expect(
      Router.deploy(cometWithA.address, tokenB.address, relayer.address),
    ).to.be.revertedWith('router: baseToken mismatch');
  });

  /// SPEC: initialRelayer is authorized at construction; zero-address rejected.
  it('constructor authorizes initialRelayer + rejects zero', async () => {
    const [admin, relayer] = await ethers.getSigners();
    const token = await deployUnifiedToken(USDC_MINT_DEVNET, 'USDC', 'USDC', 6, admin);
    const Comet = await ethers.getContractFactory('MockComet');
    const comet = await Comet.deploy(token.address);
    const Router = await ethers.getContractFactory('OrchestratorRouter');

    await expect(
      Router.deploy(comet.address, token.address, ethers.constants.AddressZero),
    ).to.be.revertedWith('router: zero relayer');

    const router = await Router.deploy(comet.address, token.address, relayer.address);
    expect(await router.authorizedRelayers(relayer.address)).to.equal(true);
    expect(await router.initialRelayer()).to.equal(relayer.address);
  });

  // ── happy path ────────────────────────────────────────────────────────

  /// SPEC: snapshot then complete happy path.
  /// Phase 1: relayer snapshots cometAta, pendingSnapshotAmount[user] = amount.
  /// Phase 2: relayer completes, supplyTo lands at the derived per-user address.
  it('happy path: snapshot then complete; supplyTo lands at derived dst', async () => {
    const { relayer, token, comet, router } = await deployRouterStack();
    const userPubkey = '0x' + '42'.repeat(32);
    const amount = 1_000_000;

    // Compute expected derived address off-chain (mirrors SyntheticSender.derive).
    const SALT = 'rome.protocol.unified-token.synthetic-sender.v1';
    const packed = ethers.utils.solidityPack(['string', 'bytes32'], [SALT, userPubkey]);
    const expectedAddr = '0x' + ethers.utils.keccak256(packed).slice(2 + 24);

    // Phase 1: snapshot.
    await expect(router.connect(relayer).snapshotForPendingSupply(userPubkey, amount))
      .to.emit(token, 'AtaSnapshotted')
      .and.to.emit(router, 'SnapshotTaken');
    expect((await router.pendingSnapshotAmount(userPubkey)).toString())
      .to.equal(amount.toString());

    // Between phases the user's SPL transfer would land on Solana. The unit
    // test does not need to simulate the on-chain delta; MockComet's supplyTo
    // is a no-op recorder, so phase 2 just verifies the supplyTo call shape.
    expect((await comet.supplyToCount()).toString()).to.equal('0');

    // Phase 2: complete.
    await expect(router.connect(relayer).completeSupplyForUser(userPubkey, amount))
      .to.emit(router, 'SuppliedForUser');

    // Pending intent cleared.
    expect((await router.pendingSnapshotAmount(userPubkey)).toString()).to.equal('0');

    // supplyTo invoked once with (caller=router, dst=derived, asset=token, amount).
    const last = await comet.lastSupplyTo();
    expect(last.caller.toLowerCase()).to.equal(router.address.toLowerCase());
    expect(last.dst.toLowerCase()).to.equal(expectedAddr.toLowerCase());
    expect(last.asset.toLowerCase()).to.equal(token.address.toLowerCase());
    expect(last.amount.toString()).to.equal(amount.toString());
    expect((await comet.supplyToCount()).toString()).to.equal('1');
  });

  // ── relayer ACL ───────────────────────────────────────────────────────

  /// SPEC: only authorized relayer may take snapshots or complete.
  it('non-relayer reverts on snapshotForPendingSupply', async () => {
    const { outsider, router } = await deployRouterStack();
    const userPubkey = '0x' + '11'.repeat(32);
    await expect(
      router.connect(outsider).snapshotForPendingSupply(userPubkey, 1_000_000),
    ).to.be.revertedWith('OR: not relayer');
  });

  it('non-relayer reverts on completeSupplyForUser', async () => {
    const { outsider, router } = await deployRouterStack();
    const userPubkey = '0x' + '22'.repeat(32);
    await expect(
      router.connect(outsider).completeSupplyForUser(userPubkey, 1_000_000),
    ).to.be.revertedWith('OR: not relayer');
  });

  /// SPEC: setRelayerAuthorization adds + removes; the new relayer can drive
  /// both phases; after removal, the old relayer cannot.
  it('relayer authorization roundtrip (add then remove)', async () => {
    const { relayer, otherRelayer, router } = await deployRouterStack();
    const userPubkey = '0x' + '33'.repeat(32);

    expect(await router.authorizedRelayers(otherRelayer.address)).to.equal(false);

    // Add otherRelayer.
    await expect(
      router.connect(relayer).setRelayerAuthorization(otherRelayer.address, true),
    ).to.emit(router, 'RelayerAuthorizationSet');
    expect(await router.authorizedRelayers(otherRelayer.address)).to.equal(true);

    // otherRelayer can now drive a full intent.
    await router.connect(otherRelayer).snapshotForPendingSupply(userPubkey, 500_000);
    await router.connect(otherRelayer).completeSupplyForUser(userPubkey, 500_000);

    // Remove otherRelayer.
    await router.connect(relayer).setRelayerAuthorization(otherRelayer.address, false);
    expect(await router.authorizedRelayers(otherRelayer.address)).to.equal(false);

    // Revoked relayer reverts.
    const userPubkey2 = '0x' + '34'.repeat(32);
    await expect(
      router.connect(otherRelayer).snapshotForPendingSupply(userPubkey2, 1),
    ).to.be.revertedWith('OR: not relayer');
  });

  // ── intent state machine ──────────────────────────────────────────────

  /// SPEC: completeSupplyForUser reverts when no pending intent exists.
  /// (pendingSnapshotAmount[user] == 0 → mismatch vs nonzero amount.)
  it('completeSupplyForUser reverts when no snapshot has been taken', async () => {
    const { relayer, router } = await deployRouterStack();
    const userPubkey = '0x' + '44'.repeat(32);
    await expect(
      router.connect(relayer).completeSupplyForUser(userPubkey, 1_000_000),
    ).to.be.revertedWith('OR: amount mismatch');
  });

  /// SPEC: amount mismatch on complete reverts (snapshot 100, complete 200).
  it('completeSupplyForUser reverts when amount differs from snapshot', async () => {
    const { relayer, router } = await deployRouterStack();
    const userPubkey = '0x' + '55'.repeat(32);
    await router.connect(relayer).snapshotForPendingSupply(userPubkey, 100);
    await expect(
      router.connect(relayer).completeSupplyForUser(userPubkey, 200),
    ).to.be.revertedWith('OR: amount mismatch');
    // Pending intent still exists (no delete).
    expect((await router.pendingSnapshotAmount(userPubkey)).toString()).to.equal('100');
  });

  /// SPEC: a second snapshotForPendingSupply for the same user pubkey reverts
  /// while the first intent is still pending.
  it('double snapshot for the same user reverts (one intent at a time)', async () => {
    const { relayer, router } = await deployRouterStack();
    const userPubkey = '0x' + '66'.repeat(32);
    await router.connect(relayer).snapshotForPendingSupply(userPubkey, 1_000_000);
    await expect(
      router.connect(relayer).snapshotForPendingSupply(userPubkey, 2_000_000),
    ).to.be.revertedWith('OR: pending exists');
    // After completing the first intent, a new one is allowed.
    await router.connect(relayer).completeSupplyForUser(userPubkey, 1_000_000);
    await router.connect(relayer).snapshotForPendingSupply(userPubkey, 2_000_000);
    expect((await router.pendingSnapshotAmount(userPubkey)).toString())
      .to.equal('2000000');
  });

  // ── input guards ──────────────────────────────────────────────────────

  /// SPEC: zero-amount snapshot reverts (matches old supplyForUser guard).
  it('snapshotForPendingSupply reverts ZeroAmount on amount=0', async () => {
    const { relayer, router } = await deployRouterStack();
    const userPubkey = '0x' + '77'.repeat(32);
    await expect(router.connect(relayer).snapshotForPendingSupply(userPubkey, 0))
      .to.be.revertedWithCustomError(router, 'ZeroAmount');
  });

  /// SPEC: router lacking pre-deposited caller role reverts cleanly.
  it('snapshotForPendingSupply reverts NotPreDepositedCaller when role missing', async () => {
    // Bypass the helper that grants the role.
    const [admin, relayer] = await ethers.getSigners();
    const token = await deployUnifiedToken(USDC_MINT_DEVNET, 'USDC', 'USDC', 6, admin);
    const Comet = await ethers.getContractFactory('MockComet');
    const comet = await Comet.deploy(token.address);
    const Router = await ethers.getContractFactory('OrchestratorRouter');
    const router = await Router.deploy(comet.address, token.address, relayer.address);
    const userPubkey = '0x' + '88'.repeat(32);
    await expect(
      router.connect(relayer).snapshotForPendingSupply(userPubkey, 1_000_000),
    ).to.be.revertedWithCustomError(router, 'NotPreDepositedCaller');
  });

  // ── EVM-keypair flow (snapshotForPendingSupplyEvm / completeSupplyForUserEvm) ──
  //
  // These overloads target the EVM-lane supply path: the user already has
  // an EVM-keypair identity, so SyntheticSender derivation is skipped and
  // the address is used directly. Mirrors the bytes32 happy-path + guards
  // above, plus a cross-mapping isolation check.

  /// SPEC: EVM-lane happy path — supplyTo lands at `user` directly, no synthesis.
  it('EVM-lane happy path: snapshotForPendingSupplyEvm then completeSupplyForUserEvm', async () => {
    const { relayer, token, comet, router } = await deployRouterStack();
    const [, , , , user] = await ethers.getSigners();
    const amount = 500_000;

    await expect(router.connect(relayer).snapshotForPendingSupplyEvm(user.address, amount))
      .to.emit(token, 'AtaSnapshotted')
      .and.to.emit(router, 'SnapshotTakenEvm');
    expect((await router.pendingSnapshotAmountEvm(user.address)).toString())
      .to.equal(amount.toString());

    await expect(router.connect(relayer).completeSupplyForUserEvm(user.address, amount))
      .to.emit(router, 'SuppliedForUserEvm');

    expect((await router.pendingSnapshotAmountEvm(user.address)).toString()).to.equal('0');

    // supplyTo invoked with dst=user directly (no derivation).
    const last = await comet.lastSupplyTo();
    expect(last.dst.toLowerCase()).to.equal(user.address.toLowerCase());
    expect(last.amount.toString()).to.equal(amount.toString());
  });

  /// SPEC: cancelPendingSnapshotEvm clears state + emits.
  it('EVM-lane cancel clears pending intent and emits SnapshotCancelledEvm', async () => {
    const { relayer, router } = await deployRouterStack();
    const [, , , , user] = await ethers.getSigners();
    await router.connect(relayer).snapshotForPendingSupplyEvm(user.address, 1_000_000);
    await expect(router.connect(relayer).cancelPendingSnapshotEvm(user.address))
      .to.emit(router, 'SnapshotCancelledEvm');
    expect((await router.pendingSnapshotAmountEvm(user.address)).toString()).to.equal('0');
  });

  /// SPEC: non-relayer cannot drive any of the EVM-lane functions.
  it('non-relayer reverts on EVM-lane functions', async () => {
    const { outsider, router } = await deployRouterStack();
    const [, , , , user] = await ethers.getSigners();
    await expect(
      router.connect(outsider).snapshotForPendingSupplyEvm(user.address, 1_000_000),
    ).to.be.revertedWith('OR: not relayer');
    await expect(
      router.connect(outsider).completeSupplyForUserEvm(user.address, 1_000_000),
    ).to.be.revertedWith('OR: not relayer');
    await expect(
      router.connect(outsider).cancelPendingSnapshotEvm(user.address),
    ).to.be.revertedWith('OR: not relayer');
  });

  /// SPEC: zero-amount + zero-address are rejected.
  it('snapshotForPendingSupplyEvm reverts ZeroAmount on amount=0', async () => {
    const { relayer, router } = await deployRouterStack();
    const [, , , , user] = await ethers.getSigners();
    await expect(router.connect(relayer).snapshotForPendingSupplyEvm(user.address, 0))
      .to.be.revertedWithCustomError(router, 'ZeroAmount');
  });
  it('snapshotForPendingSupplyEvm reverts WrongUserMapping on zero address', async () => {
    const { relayer, router } = await deployRouterStack();
    await expect(
      router.connect(relayer).snapshotForPendingSupplyEvm(ethers.constants.AddressZero, 1_000_000),
    ).to.be.revertedWithCustomError(router, 'WrongUserMapping');
  });

  /// SPEC: amount-mismatch + double-snapshot mirror the bytes32 path.
  it('completeSupplyForUserEvm reverts when amount differs from snapshot', async () => {
    const { relayer, router } = await deployRouterStack();
    const [, , , , user] = await ethers.getSigners();
    await router.connect(relayer).snapshotForPendingSupplyEvm(user.address, 100);
    await expect(
      router.connect(relayer).completeSupplyForUserEvm(user.address, 200),
    ).to.be.revertedWith('OR: amount mismatch');
    expect((await router.pendingSnapshotAmountEvm(user.address)).toString()).to.equal('100');
  });
  it('double snapshotForPendingSupplyEvm for same user reverts', async () => {
    const { relayer, router } = await deployRouterStack();
    const [, , , , user] = await ethers.getSigners();
    await router.connect(relayer).snapshotForPendingSupplyEvm(user.address, 1_000_000);
    await expect(
      router.connect(relayer).snapshotForPendingSupplyEvm(user.address, 2_000_000),
    ).to.be.revertedWith('OR: pending exists');
  });

  /// SPEC: cancelPendingSnapshotEvm reverts when no intent exists.
  it('cancelPendingSnapshotEvm reverts when nothing pending', async () => {
    const { relayer, router } = await deployRouterStack();
    const [, , , , user] = await ethers.getSigners();
    await expect(
      router.connect(relayer).cancelPendingSnapshotEvm(user.address),
    ).to.be.revertedWith('OR: nothing pending');
  });

  /// SPEC: bytes32 and address mappings are completely independent.
  /// A pending bytes32 intent does NOT block an EVM-lane intent and vice versa.
  it('EVM-lane and bytes32 intents are independent (no cross-mapping interference)', async () => {
    const { relayer, router } = await deployRouterStack();
    const [, , , , user] = await ethers.getSigners();
    const userPubkey = '0x' + 'aa'.repeat(32);

    // Open a bytes32 intent + an EVM-lane intent for "the same identity" (different mappings).
    await router.connect(relayer).snapshotForPendingSupply(userPubkey, 100);
    await router.connect(relayer).snapshotForPendingSupplyEvm(user.address, 200);

    expect((await router.pendingSnapshotAmount(userPubkey)).toString()).to.equal('100');
    expect((await router.pendingSnapshotAmountEvm(user.address)).toString()).to.equal('200');

    // Completing the bytes32 intent does not affect the EVM-lane intent.
    await router.connect(relayer).completeSupplyForUser(userPubkey, 100);
    expect((await router.pendingSnapshotAmount(userPubkey)).toString()).to.equal('0');
    expect((await router.pendingSnapshotAmountEvm(user.address)).toString()).to.equal('200');

    // Completing the EVM-lane intent works as expected.
    await router.connect(relayer).completeSupplyForUserEvm(user.address, 200);
    expect((await router.pendingSnapshotAmountEvm(user.address)).toString()).to.equal('0');
  });

  /// SPEC: router lacking pre-deposited caller role reverts on the Evm overload too.
  it('snapshotForPendingSupplyEvm reverts NotPreDepositedCaller when role missing', async () => {
    const [admin, relayer, , , user] = await ethers.getSigners();
    const token = await deployUnifiedToken(USDC_MINT_DEVNET, 'USDC', 'USDC', 6, admin);
    const Comet = await ethers.getContractFactory('MockComet');
    const comet = await Comet.deploy(token.address);
    const Router = await ethers.getContractFactory('OrchestratorRouter');
    const router = await Router.deploy(comet.address, token.address, relayer.address);
    await expect(
      router.connect(relayer).snapshotForPendingSupplyEvm(user.address, 1_000_000),
    ).to.be.revertedWithCustomError(router, 'NotPreDepositedCaller');
  });
});
