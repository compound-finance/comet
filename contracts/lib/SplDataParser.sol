// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

import {ICrossProgramInvocation, CpiProgram} from "./RomePrecompiles.sol";

/// @title SplDataParser
/// @notice Parses Borsh-encoded SPL Token Account / Mint data returned by
/// the Rome CPI precompile's `account_info`.
///
/// Mirror of rome-solidity's SplTokenLib parsing helpers, copied so the
/// Compound build is self-contained (no rome-solidity npm dependency).
library SplDataParser {
    uint256 internal constant SPL_MINT_LEN = 82;
    uint256 internal constant SPL_TOKEN_ACCOUNT_LEN = 165;
    uint256 internal constant SPL_TOKEN_ACCOUNT_MIN_LEN = 72;

    error InvalidMintDataLength(uint256 actual, bytes32 mint);
    error InvalidTokenAccountDataLength(uint256 actual);

    /// Returns the SPL token account amount at `tokenAccount`, or 0 if the
    /// account does not yet exist on Solana.
    /// @dev Uses the v2 CPI shortcut precompiles (rome-evm-private PR #319):
    /// `account_lamports` as a cheap existence probe, then `account_u64_at`
    /// for the amount field — skips the 6-tuple ABI encoding overhead of
    /// `account_info` plus the full data copy. Saves ~160k CU per call.
    function loadTokenAmount(bytes32 tokenAccount) internal view returns (uint64) {
        if (CpiProgram.account_lamports(tokenAccount) == 0) {
            return 0; // ATA not yet initialized — same UX as Phantom.
        }
        // amount lives at byte offset 64..72 (LE u64).
        return CpiProgram.account_u64_at(tokenAccount, 64);
    }

    /// Returns the SPL mint's `supply` field.
    function loadMintSupply(bytes32 mint) internal view returns (uint64) {
        (,,,,, bytes memory data) = CpiProgram.account_info(mint);
        if (data.length != SPL_MINT_LEN) {
            revert InvalidMintDataLength(data.length, mint);
        }
        // mint_authority COption: 4 bytes (tag) + 32 bytes pubkey = 36 bytes.
        // supply at offset 36..44.
        return _readU64Le(data, 36);
    }

    /// Reads a little-endian u64 from `data` starting at `offset`.
    function _readU64Le(bytes memory data, uint256 offset) private pure returns (uint64) {
        require(data.length >= offset + 8, "SplDataParser: oob");
        uint64 v = 0;
        unchecked {
            for (uint256 i = 0; i < 8; ++i) {
                v |= uint64(uint8(data[offset + i])) << uint64(i * 8);
            }
        }
        return v;
    }
}
