// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

import {SyntheticSender} from "../lib/SyntheticSender.sol";
import {AtaDeriver} from "../lib/AtaDeriver.sol";
import {IComet} from "./IComet.sol";
import {IUnifiedTokenMin} from "./IUnifiedTokenMin.sol";

/// @title OrchestratorRouter
/// @notice Bridges the Solana orchestrator's MetaHook calldata into Compound's
/// supply path. Only the **supply side** of the Solana lane goes through this
/// contract — withdraw goes directly to Comet (target=comet, msg.sender =
/// synthetic) because Compound's `withdraw(asset, amount)` already lets the
/// caller pull from their own position without a manager pattern.
///
/// Flow (called from MetaHook with `msg.sender = orchestratorSyntheticSender`):
///
///   1. The Solana orchestrator program already verified the user's prior SPL
///      transfer landed at Comet's PDA-ATA (see verify.rs).
///   2. Off-chain, the Solana caller computed
///      `userSyntheticAddr = SyntheticSender.derive(userPubkey)` and packed
///      `(userPubkey, amount)` into the MetaHook calldata.
///   3. This router validates the supplied `userPubkey` derives to a real EVM
///      address, snapshots `cometAta`, and calls `comet.supplyTo(dst =
///      userSyntheticAddr)` so the position is credited to the user.
///
/// `from` for Compound's `doTransferIn` is this router (msg.sender of the
/// `supplyTo` call). With Comet impl V3's modified `doTransferIn`, the
/// transferFrom becomes a `transferFromPreDeposited` against `cometAta`,
/// which closes the Q1 supply-CU gate from Phase 2.
///
/// The router is **not protocol-specific** in spirit: a future deployment
/// against Morpho or Sky would deploy a separate instance pointing at the
/// new `IComet`-shaped target. The compiled contract is small (<5 KB) and
/// duplication across protocols is the right call vs. premature generalization.
contract OrchestratorRouter {
    error WrongUserMapping();
    error NotPreDepositedCaller();
    error ZeroAmount();

    IComet public immutable comet;
    IUnifiedTokenMin public immutable unifiedToken;
    /// Cached at construction so `supplyForUser` does not re-read from comet
    /// on every call.
    address public immutable baseAsset;

    /// EVM-side mirror of the user-pubkey derivation, recorded for off-chain
    /// debuggers + forensic logs.
    event SuppliedForUser(
        address indexed user,
        bytes32 indexed userPubkey,
        uint256 amount,
        bytes32 cometAta
    );

    constructor(IComet comet_, IUnifiedTokenMin unifiedToken_) {
        comet = comet_;
        unifiedToken = unifiedToken_;
        baseAsset = address(unifiedToken_);
        // Sanity: comet's baseToken should equal unifiedToken — otherwise
        // we'd snapshot the wrong ATA.
        require(
            comet_.baseToken() == address(unifiedToken_),
            "router: baseToken mismatch"
        );
    }

    /// Supply `amount` of base asset on behalf of the Solana user identified
    /// by `userPubkey`. The user's USDC must already have landed at the comet
    /// PDA-ATA via an SPL transfer in the same Solana tx (verified upstream
    /// by the orchestrator's instructions-sysvar check).
    ///
    /// `msg.sender` here is the Solana orchestrator's synthetic sender (one
    /// shared identity across every Solana-lane call). The actual user is
    /// distinguished by `userPubkey` → `derive(userPubkey)` = per-user EVM
    /// address.
    function supplyForUser(bytes32 userPubkey, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        address user = SyntheticSender.derive(userPubkey);
        if (user == address(0)) revert WrongUserMapping();

        // Router must be a pre-deposited caller of the unified token —
        // otherwise the `supplyTo` chain reaches `transferFromPreDeposited`
        // (V3 doTransferIn) and reverts with `not pre-deposited caller`. We
        // surface that to the caller as a clear router-side error so a
        // mis-configured deploy is obvious.
        if (!unifiedToken.isPreDepositedCaller(address(this))) {
            revert NotPreDepositedCaller();
        }

        bytes32 mint = unifiedToken.mintId();
        bytes32 cometAta = AtaDeriver.ataForUser(address(comet), mint);

        // Push the snapshot. Comet's modified `doTransferIn` (V3) will pop it
        // when it calls `transferFromPreDeposited`.
        unifiedToken.snapshotAta(cometAta);

        // `comet.supplyTo(dst=user, asset=baseAsset, amount)` — the dst credit
        // goes to `user`, the doTransferIn pulls from msg.sender (router).
        comet.supplyTo(user, baseAsset, amount);

        emit SuppliedForUser(user, userPubkey, amount, cometAta);
    }
}
