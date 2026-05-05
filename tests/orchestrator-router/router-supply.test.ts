// router-supply.test.ts
//
// Unit tests for OrchestratorRouter.supplyForUser.
//
// SPEC: spec §3.3 (UnifiedToken `transferFromPreDeposited`) +
// spec §3.2 (orchestrator dispatches MetaHook → router) +
// SyntheticSender derivation locked by Phase 1.
//
// All tests are TDD (red) → green via the implementation.

import { expect } from 'chai';
import { ethers } from 'hardhat';
import {
  installMockPrecompiles,
  snapshot,
  revert,
  USDC_MINT_DEVNET,
  deployUnifiedToken,
} from '../unified-token/_helpers';

describe('OrchestratorRouter.supplyForUser (Phase 3)', () => {
  let snap: string;
  beforeEach(async () => {
    await installMockPrecompiles();
    snap = await snapshot();
  });
  afterEach(async () => {
    await revert(snap);
  });

  async function deployRouterStack() {
    const [admin] = await ethers.getSigners();
    const token = await deployUnifiedToken(USDC_MINT_DEVNET, 'Unified USDC', 'USDC', 6, admin);
    const Comet = await ethers.getContractFactory('MockComet');
    const comet = await Comet.deploy(token.address);
    await comet.deployed();
    const Router = await ethers.getContractFactory('OrchestratorRouter');
    const router = await Router.deploy(comet.address, token.address);
    await router.deployed();
    return { admin, token, comet, router };
  }

  /// SPEC: constructor pins `baseAsset = unifiedToken` and reverts on mismatch.
  it('constructor reverts when comet.baseToken != unifiedToken', async () => {
    const [admin] = await ethers.getSigners();
    const tokenA = await deployUnifiedToken(USDC_MINT_DEVNET, 'A', 'A', 6, admin);
    const tokenB = await deployUnifiedToken(USDC_MINT_DEVNET, 'B', 'B', 6, admin);
    const Comet = await ethers.getContractFactory('MockComet');
    const cometWithA = await Comet.deploy(tokenA.address);
    const Router = await ethers.getContractFactory('OrchestratorRouter');
    await expect(
      Router.deploy(cometWithA.address, tokenB.address),
    ).to.be.revertedWith('router: baseToken mismatch');
  });

  /// SPEC: zero-amount supply reverts cleanly. (Compound's supplyTo would
  /// happily accept 0, but for UX we surface this earlier.)
  it('reverts ZeroAmount on amount=0', async () => {
    const { router } = await deployRouterStack();
    const userPubkey = '0x' + '11'.repeat(32);
    await expect(router.supplyForUser(userPubkey, 0))
      .to.be.revertedWithCustomError(router, 'ZeroAmount');
  });

  /// SPEC: router must be a pre-deposited caller of UnifiedToken — otherwise
  /// `transferFromPreDeposited` would revert deep in Comet's `doTransferIn`.
  /// We check upfront to give a clearer error.
  it('reverts NotPreDepositedCaller when router lacks the role', async () => {
    const { router } = await deployRouterStack();
    const userPubkey = '0x' + '22'.repeat(32);
    await expect(router.supplyForUser(userPubkey, 1_000_000))
      .to.be.revertedWithCustomError(router, 'NotPreDepositedCaller');
  });

  /// SPEC: happy path. Router does:
  ///   1. snapshotAta(cometAta) — emits AtaSnapshotted on the unified token
  ///   2. comet.supplyTo(dst=derive(userPubkey), asset=baseAsset, amount)
  it('happy path: snapshots cometAta then calls comet.supplyTo with derived dst', async () => {
    const { admin, token, comet, router } = await deployRouterStack();

    // Grant router pre-deposited caller role.
    await token.connect(admin).grantPreDepositedCaller(router.address);
    expect(await token.isPreDepositedCaller(router.address)).to.equal(true);

    const userPubkey = '0x' + '42'.repeat(32);

    // Compute expected derived address off-chain (mirrors SyntheticSender.derive).
    const SALT = 'rome.protocol.unified-token.synthetic-sender.v1';
    const packed = ethers.utils.solidityPack(['string', 'bytes32'], [SALT, userPubkey]);
    const expectedAddr = '0x' + ethers.utils.keccak256(packed).slice(2 + 24);

    await expect(router.supplyForUser(userPubkey, 1_000_000))
      .to.emit(token, 'AtaSnapshotted')
      .and.to.emit(router, 'SuppliedForUser');

    // Verify Comet.supplyTo was invoked with the right (caller=router, dst=derived, asset=token, amount).
    const last = await comet.lastSupplyTo();
    expect(last.caller.toLowerCase()).to.equal(router.address.toLowerCase());
    expect(last.dst.toLowerCase()).to.equal(expectedAddr.toLowerCase());
    expect(last.asset.toLowerCase()).to.equal(token.address.toLowerCase());
    expect(last.amount.toString()).to.equal('1000000');
    expect((await comet.supplyToCount()).toString()).to.equal('1');
  });

  /// SPEC: distinct user pubkeys derive distinct EVM addresses → distinct
  /// Compound positions. This is the core of cross-lane fungibility (each
  /// Solana-lane user gets their own position).
  it('distinct userPubkeys produce distinct supplyTo dst addresses', async () => {
    const { admin, token, comet, router } = await deployRouterStack();
    await token.connect(admin).grantPreDepositedCaller(router.address);

    const pkA = '0x' + '01'.repeat(32);
    const pkB = '0x' + '02'.repeat(32);

    await router.supplyForUser(pkA, 1_000_000);
    const lastA = await comet.lastSupplyTo();

    await router.supplyForUser(pkB, 2_000_000);
    const lastB = await comet.lastSupplyTo();

    expect(lastA.dst).to.not.equal(lastB.dst);
    expect(lastA.amount.toString()).to.equal('1000000');
    expect(lastB.amount.toString()).to.equal('2000000');
  });

  /// SPEC: SyntheticSender.derive(zero pubkey) reverts (ZeroPubkey). Router
  /// surfaces that as a propagated revert.
  it('zero userPubkey reverts via SyntheticSender.ZeroPubkey', async () => {
    const { admin, token, router } = await deployRouterStack();
    await token.connect(admin).grantPreDepositedCaller(router.address);
    const zeroPubkey = '0x' + '00'.repeat(32);
    await expect(router.supplyForUser(zeroPubkey, 1)).to.be.reverted;
  });

  /// SPEC: snapshotAta is called for the comet's PDA-ATA, NOT the user's. The
  /// user's USDC was deposited TO the comet's ATA (where Compound holds the
  /// pool); the snapshot tracks that.
  it('snapshots comet PDA-ATA, not the user ATA', async () => {
    const { admin, token, router, comet } = await deployRouterStack();
    await token.connect(admin).grantPreDepositedCaller(router.address);

    // Compute the comet PDA-ATA off-chain via the mocked SystemProgram. We
    // cannot directly inspect router's snapshotAta arg; instead we observe
    // the AtaSnapshotted event and check the indexed ataPubkey matches
    // comet's solanaAtaOf.
    const cometAta = await token.solanaAtaOf(comet.address);
    const userPubkey = '0x' + '99'.repeat(32);
    const tx = await router.supplyForUser(userPubkey, 500_000);
    const rcpt = await tx.wait();

    // AtaSnapshotted(address indexed caller, bytes32 indexed ataPubkey, uint256 prior)
    const TOPIC = ethers.utils.id('AtaSnapshotted(address,bytes32,uint256)');
    const log = rcpt.logs.find((l: any) => l.topics[0] === TOPIC);
    expect(log).to.not.equal(undefined);
    expect(log.topics[2]).to.equal(cometAta);
  });
});
