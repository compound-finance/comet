// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

/// @title SyntheticSender
/// @notice Deterministic Solana pubkey → EVM address derivation.
///
/// Spec: rome-specs/active/technical/2026-05-04-compound-on-rome-unified-usdc.md
/// §1b §11a, Q2 ("user-pubkey-bound" — each Phantom user gets a unique EVM
/// identity derived from their Solana wallet).
///
/// Foundational artifact (Tier B): Compound today and every successor (Morpho,
/// Sky, RWA, JupUSD) read the same library so users have ONE EVM identity
/// across all Rome cross-VM apps. A Phantom-only user who supplies USDC via
/// Compound and later borrows via Morpho will see the same on-chain history
/// from the EVM side.
///
/// Derivation:
///   syntheticAddress = address(uint160(uint256(keccak256(
///       abi.encodePacked(SALT, solanaPubkey)
///   ))));
///
/// where SALT pins the derivation version. Rotating SALT is a forced migration
/// (every user's synthetic address changes); we don't expect to rotate.
library SyntheticSender {
    string internal constant SALT = "rome.protocol.unified-token.synthetic-sender.v1";

    error ZeroPubkey();

    /// Derive the EVM address for a Solana pubkey.
    function derive(bytes32 solanaPubkey) internal pure returns (address) {
        if (solanaPubkey == bytes32(0)) {
            revert ZeroPubkey();
        }
        bytes32 h = keccak256(abi.encodePacked(SALT, solanaPubkey));
        return address(uint160(uint256(h)));
    }
}
