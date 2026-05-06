// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

import {SyntheticSender} from "../lib/SyntheticSender.sol";
import {AtaDeriver} from "../lib/AtaDeriver.sol";
import {IComet} from "./IComet.sol";
import {IUnifiedTokenMin} from "./IUnifiedTokenMin.sol";

/// @title OrchestratorRouter
/// @notice Two-phase relayer-gated bridge from a Solana SPL deposit into
/// Compound's supply path. Replaces the synchronous single-call MetaHook
/// design — that approach was broken because the cometAta snapshot must be
/// taken **before** the user's SPL deposit lands, and a single tx cannot
/// straddle that ordering.
///
/// Off-chain relayer choreography (see relayer service):
///   1. User signals intent to supply `amount` of base asset.
///   2. Relayer calls `snapshotForPendingSupply(userPubkey, amount)`. The
///      router records the intent, snapshots cometAta at its **pre-deposit**
///      balance, and emits `SnapshotTaken`.
///   3. User's SPL transfer to cometAta lands on Solana (between phases).
///   4. Relayer calls `completeSupplyForUser(userPubkey, amount)`. The router
///      consumes the pending intent, calls `comet.supplyTo(user, ..., amount)`,
///      and Comet's V3 `doTransferIn` invokes `transferFromPreDeposited` —
///      which compares the post-deposit ATA balance against the snapshot to
///      verify `amount` actually landed.
///
/// `from` for Compound's `doTransferIn` is this router (msg.sender of the
/// `supplyTo` call). With Comet impl V3's modified `doTransferIn`, the
/// transferFrom becomes a `transferFromPreDeposited` against `cometAta`.
///
/// POC quality: one pending intent per user pubkey at a time. No cancel,
/// no expiry, no popSnapshot recovery — relayer is trusted to complete
/// every intent it takes.
contract OrchestratorRouter {
    error WrongUserMapping();
    error NotPreDepositedCaller();
    error ZeroAmount();

    IComet public immutable comet;
    IUnifiedTokenMin public immutable unifiedToken;
    /// Cached at construction so the supply path does not re-read from comet
    /// on every call.
    address public immutable baseAsset;
    /// Initial relayer captured at construction. Permitted (along with
    /// existing relayers) to add/remove other relayers via
    /// `setRelayerAuthorization`. POC-grade ACL.
    address public immutable initialRelayer;

    /// Address → can call `snapshotForPendingSupply` / `completeSupplyForUser`.
    mapping(address => bool) public authorizedRelayers;

    /// userPubkey → expected supply amount for the in-flight intent.
    /// Non-zero means a snapshot has been taken and is awaiting completion.
    mapping(bytes32 => uint256) public pendingSnapshotAmount;

    /// Phase 1 marker — emitted when the router has snapshotted cometAta
    /// and is awaiting the matching SPL deposit + complete call.
    event SnapshotTaken(
        bytes32 indexed userPubkey,
        uint256 amount,
        bytes32 cometAta
    );

    /// Phase 2 marker — emitted when supplyTo has landed for the derived
    /// per-user EVM address.
    event SuppliedForUser(
        address indexed user,
        bytes32 indexed userPubkey,
        uint256 amount,
        bytes32 cometAta
    );

    /// Mirror events for relayer ACL changes (helpful for off-chain ops).
    event RelayerAuthorizationSet(address indexed relayer, bool authorized);

    /// Phase-1 abandon — emitted when the relayer cancels a stuck intent.
    /// Note (POC): the stale UnifiedToken snapshot queue entry is intentionally
    /// NOT popped here because UnifiedToken V2 has no popSnapshot. The queue
    /// entry is consumed by the next `transferFromPreDeposited` call (oldest
    /// first); for POC this is acceptable because demos repeat the same amount.
    event SnapshotCancelled(bytes32 indexed userPubkey, uint256 amount);

    modifier onlyRelayer() {
        require(authorizedRelayers[msg.sender], "OR: not relayer");
        _;
    }

    constructor(
        IComet comet_,
        IUnifiedTokenMin unifiedToken_,
        address initialRelayer_
    ) {
        comet = comet_;
        unifiedToken = unifiedToken_;
        baseAsset = address(unifiedToken_);
        initialRelayer = initialRelayer_;
        // Sanity: comet's baseToken should equal unifiedToken — otherwise
        // we'd snapshot the wrong ATA.
        require(
            comet_.baseToken() == address(unifiedToken_),
            "router: baseToken mismatch"
        );
        require(initialRelayer_ != address(0), "router: zero relayer");
        authorizedRelayers[initialRelayer_] = true;
        emit RelayerAuthorizationSet(initialRelayer_, true);
    }

    /// Add or remove a relayer. POC-gated to `initialRelayer` and any
    /// already-authorized relayer. No separate owner role — keeps the
    /// surface minimal for the POC.
    function setRelayerAuthorization(address relayer, bool authorized) external {
        require(
            msg.sender == initialRelayer || authorizedRelayers[msg.sender],
            "OR: not authorized"
        );
        authorizedRelayers[relayer] = authorized;
        emit RelayerAuthorizationSet(relayer, authorized);
    }

    /// Phase 1 of two-phase supply. Records the pending intent for
    /// `userPubkey` and snapshots cometAta at its pre-deposit balance.
    function snapshotForPendingSupply(bytes32 userPubkey, uint256 amount)
        external
        onlyRelayer
    {
        if (amount == 0) revert ZeroAmount();
        if (!unifiedToken.isPreDepositedCaller(address(this))) {
            revert NotPreDepositedCaller();
        }
        // POC: one in-flight intent per user pubkey at a time.
        require(pendingSnapshotAmount[userPubkey] == 0, "OR: pending exists");

        bytes32 mint = unifiedToken.mintId();
        bytes32 cometAta = AtaDeriver.ataForUser(address(comet), mint);
        unifiedToken.snapshotAta(cometAta);
        pendingSnapshotAmount[userPubkey] = amount;
        emit SnapshotTaken(userPubkey, amount, cometAta);
    }

    /// Phase 2. Consumes the pending intent and lands `comet.supplyTo` for
    /// the per-user synthetic address derived from `userPubkey`. The Comet
    /// V3 `doTransferIn` will invoke `transferFromPreDeposited`, which
    /// pops the snapshot and verifies the post-deposit delta matches `amount`.
    function completeSupplyForUser(bytes32 userPubkey, uint256 amount)
        external
        onlyRelayer
    {
        require(
            pendingSnapshotAmount[userPubkey] == amount,
            "OR: amount mismatch"
        );
        delete pendingSnapshotAmount[userPubkey];

        address user = SyntheticSender.derive(userPubkey);
        if (user == address(0)) revert WrongUserMapping();

        bytes32 mint = unifiedToken.mintId();
        bytes32 cometAta = AtaDeriver.ataForUser(address(comet), mint);

        // `comet.supplyTo(dst=user, asset=baseAsset, amount)` → V3 doTransferIn
        // → transferFromPreDeposited (verifies post-deposit ATA delta).
        comet.supplyTo(user, baseAsset, amount);

        emit SuppliedForUser(user, userPubkey, amount, cometAta);
    }

    /// Cancel a stuck pending intent. Clears `pendingSnapshotAmount[userPubkey]`
    /// so the user can start a new intent. Does NOT pop the corresponding
    /// UnifiedToken snapshot entry — that's a known POC leak; the next
    /// transferFromPreDeposited call consumes the oldest queued snapshot
    /// regardless of which intent it was originally for.
    function cancelPendingSnapshot(bytes32 userPubkey) external onlyRelayer {
        uint256 prev = pendingSnapshotAmount[userPubkey];
        require(prev != 0, "OR: nothing pending");
        delete pendingSnapshotAmount[userPubkey];
        emit SnapshotCancelled(userPubkey, prev);
    }
}
