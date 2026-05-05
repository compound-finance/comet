// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title ICrossVMAsset
/// @notice The foundational interface every Rome cross-VM token contract
/// MUST implement so successor lending protocols can target it generically.
///
/// Spec: rome-specs/active/technical/2026-05-04-compound-on-rome-unified-usdc.md
/// Part 1b ("Foundational vs protocol-specific layers") + Part 11a
/// ("Foundational artifacts registry").
///
/// @dev Three layers compose this interface:
///   1. IERC20 — standard transfer / allowance surface every Solidity caller
///      already speaks. Compound v3, Morpho, Maker Vat, etc. all read this.
///   2. IERC20Metadata — name / symbol / decimals.
///   3. Cross-VM extensions (this interface):
///      - mintId() — the Solana SPL mint underlying this wrapper
///      - solanaAtaOf() — deterministic ATA derivation for an EVM addr
///      - transferFromPreDeposited() — Solana-lane "verify SPL pre-transfer"
///        path (zero CPI, used when an orchestrator already moved the SPL
///        in the same Solana tx)
///      - snapshotAta() — pair to transferFromPreDeposited
///      - admin role mgmt for the pre-deposited caller list
///
/// Successor protocols write `ICrossVMAsset baseAsset` and call standard
/// IERC20 methods on user flows; the verify-pre-transfer methods are reserved
/// for the orchestrator + MetaHook callee path on the Solana lane.
interface ICrossVMAsset is IERC20, IERC20Metadata {
    // ────────────────────────────────────────────────────────────────────
    // Identity
    // ────────────────────────────────────────────────────────────────────

    /// The canonical Solana SPL mint pubkey this wrapper represents.
    /// Set at construction; immutable.
    function mintId() external view returns (bytes32);

    /// The deterministic Solana ATA pubkey for an EVM account, given this
    /// contract's mint. Equivalent to:
    ///   getATA(authorityPda(account), mintId, splTokenProgram)
    /// where authorityPda derives via Rome's standard EXTERNAL_AUTHORITY seed.
    function solanaAtaOf(address account) external view returns (bytes32);

    // ────────────────────────────────────────────────────────────────────
    // Solana-lane verify-pre-transfer
    // ────────────────────────────────────────────────────────────────────

    /// Take a snapshot of an ATA's current balance. Pair to
    /// `transferFromPreDeposited` — the snapshot is consumed when the verify
    /// runs. Only callable by addresses with the PRE_DEPOSITED_CALLER role.
    /// Reverts if msg.sender lacks the role.
    function snapshotAta(bytes32 ataPubkey) external;

    /// Verify that `recipientAta` was credited at least `value` since the
    /// last snapshot, then emit a normal IERC20.Transfer event with the
    /// supplied `from` and `to` EVM addresses. Reverts if no snapshot exists
    /// or if the post-snapshot delta is < value. The snapshot is consumed
    /// (single-use). Only callable by addresses with the PRE_DEPOSITED_CALLER
    /// role.
    ///
    /// `from` is the Rome EVM identity of the supplier (synthesized from
    /// their Solana pubkey via SyntheticSender); `to` is the protocol's
    /// EVM contract address (e.g. Compound's CometProxy); `recipientAta`
    /// is the Solana ATA owned by the protocol's authority PDA where the
    /// SPL deposit landed.
    function transferFromPreDeposited(
        address from,
        address to,
        bytes32 recipientAta,
        uint256 value
    ) external;

    // ────────────────────────────────────────────────────────────────────
    // Admin (role mgmt)
    // ────────────────────────────────────────────────────────────────────

    /// Returns true if `who` is currently a PRE_DEPOSITED_CALLER.
    function isPreDepositedCaller(address who) external view returns (bool);

    /// Admin-only. Grants `who` the PRE_DEPOSITED_CALLER role.
    function grantPreDepositedCaller(address who) external;

    /// Admin-only. Revokes `who` from the PRE_DEPOSITED_CALLER role.
    function revokePreDepositedCaller(address who) external;

    /// The current admin address.
    function admin() external view returns (address);

    /// Admin-only. Initiates a two-step admin transfer; must be accepted
    /// by the new admin via acceptAdmin().
    function transferAdmin(address newAdmin) external;

    /// The pending admin (set by transferAdmin, becomes admin upon accept).
    function pendingAdmin() external view returns (address);

    /// Pending-admin-only. Completes the admin transfer.
    function acceptAdmin() external;

    // ────────────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────────────

    /// Emitted when a snapshot is taken.
    event AtaSnapshotted(address indexed caller, bytes32 indexed ataPubkey, uint256 priorBalance);

    /// Emitted when a snapshot is consumed via transferFromPreDeposited.
    event PreDepositedTransfer(address indexed from, bytes32 indexed ataPubkey, uint256 value);

    /// Emitted when role mgmt mutates.
    event PreDepositedCallerGranted(address indexed who);
    event PreDepositedCallerRevoked(address indexed who);

    /// Two-step admin transfer events.
    event AdminTransferStarted(address indexed from, address indexed pending);
    event AdminTransferCompleted(address indexed from, address indexed to);
}
