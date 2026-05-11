// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

import {
    ISystemProgram,
    ICrossProgramInvocation,
    SystemProgram,
    CpiProgram,
    SolanaConstants
} from "./RomePrecompiles.sol";

/// @title AtaDeriver
/// @notice EVM-addr → AUTHORITY_PDA → ATA-of-PDA derivation.
///
/// The canonical pattern (rome-solidity#82) for mapping an EVM caller to its
/// Solana SPL token account. Mirror of `UserPda.ata` from rome-solidity, kept
/// self-contained here for the Compound build.
///
/// Steps `ataForUser` performs in one syscall via the `derive_user_ata`
/// CPI shortcut selector (`0xc654e119` on the CPI precompile at `0xFF…08`):
///   1. AUTHORITY_PDA = find_program_address([EXTERNAL_AUTHORITY, evmAddr], rome_evm_program_id)
///   2. ATA = find_program_address([AUTHORITY_PDA, splTokenProgram, mint], associated_token_program)
///
/// Measured saving (Marcus 121301, 3-sample average, 2026-05-11): the
/// two-hop path through `0xFF…07` consumes ~281K Solana CU per call; the
/// `derive_user_ata` shortcut consumes ~129K — **~152K CU saved per call,
/// 54 % reduction**. Behavior is byte-identical: the shortcut delegates
/// to the same `find_program_address` syscalls in native Rust, returning
/// the same `(ATA, bump)` for a given `(user, mint)`.
///
/// Notes:
///   - Uses the classic SPL Token program (not Token-2022). USDC on
///     Solana uses classic; future Token-2022-based mints would need a
///     separate selector (e.g. a `derive_user_ata_v2(user, mint, token_program)`
///     variant — not yet available).
///   - Fully on-chain: no off-chain inputs, no caller-supplied PDA.
///   - `authorityPda(user)` still does one `find_program_address` round
///     trip (~115K CU). There is no precompile shortcut for "just the
///     unified PDA" today; callers that only need hop 1 keep paying the
///     hop-1 cost.
library AtaDeriver {
    /// Computes the AUTHORITY_PDA for an EVM address. (Still uses
    /// `0xFF…07` two-hop — see library NatSpec.)
    function authorityPda(address user) internal view returns (bytes32) {
        bytes32 romeProgram = SystemProgram.rome_evm_program_id();
        ISystemProgram.Seed[] memory seeds = new ISystemProgram.Seed[](2);
        seeds[0] = ISystemProgram.Seed(bytes("EXTERNAL_AUTHORITY"));
        seeds[1] = ISystemProgram.Seed(abi.encodePacked(user));
        (bytes32 key,) = SystemProgram.find_program_address(romeProgram, seeds);
        return key;
    }

    /// Computes the ATA pubkey for a wallet pubkey + mint, classic SPL Token.
    /// Used for raw Solana pubkey owners (pool-side, fee receivers, etc.)
    /// where the owner is NOT an EVM-mapped user — `derive_user_ata` would
    /// not apply.
    function ataForKey(bytes32 walletPubkey, bytes32 mint) internal pure returns (bytes32) {
        ISystemProgram.Seed[] memory seeds = new ISystemProgram.Seed[](3);
        seeds[0] = ISystemProgram.Seed(_bytes32ToBytes(walletPubkey));
        seeds[1] = ISystemProgram.Seed(_bytes32ToBytes(SolanaConstants.SPL_TOKEN_PROGRAM));
        seeds[2] = ISystemProgram.Seed(_bytes32ToBytes(mint));
        (bytes32 ata,) = SystemProgram.find_program_address(
            SolanaConstants.ASSOCIATED_TOKEN_PROGRAM,
            seeds
        );
        return ata;
    }

    /// EVM addr → AUTHORITY_PDA's ATA for `mint`. Delegates to the
    /// `derive_user_ata` CPI shortcut selector (`0xc654e119` on the CPI
    /// precompile at `0xFF…08`). Saves ~152K Solana CU vs the prior
    /// two-hop implementation; output is byte-identical.
    function ataForUser(address user, bytes32 mint) internal view returns (bytes32) {
        return CpiProgram.derive_user_ata(user, mint);
    }

    function _bytes32ToBytes(bytes32 input) private pure returns (bytes memory) {
        return abi.encodePacked(input);
    }
}
