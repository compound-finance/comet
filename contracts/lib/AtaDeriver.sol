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
/// @notice Two-hop EVM-addr → AUTHORITY_PDA → ATA-of-PDA derivation.
///
/// The canonical pattern (rome-solidity#82) for mapping an EVM caller to its
/// Solana SPL token account. Mirror of `UserPda.ata` from rome-solidity, kept
/// self-contained here for the Compound build.
///
/// Steps:
///   1. AUTHORITY_PDA = find_program_address([EXTERNAL_AUTHORITY, evmAddr], rome_evm_program_id)
///   2. ATA = find_program_address([AUTHORITY_PDA, splTokenProgram, mint], associated_token_program)
///
/// Notes:
///   - Uses the classic SPL Token program (not Token-2022). USDC on Solana
///     uses classic; future Token-2022-based mints would need a separate path.
///   - Fully on-chain: no off-chain inputs, no caller-supplied PDA.
library AtaDeriver {
    /// Computes the AUTHORITY_PDA for an EVM address.
    function authorityPda(address user) internal view returns (bytes32) {
        bytes32 romeProgram = SystemProgram.rome_evm_program_id();
        ISystemProgram.Seed[] memory seeds = new ISystemProgram.Seed[](2);
        seeds[0] = ISystemProgram.Seed(bytes("EXTERNAL_AUTHORITY"));
        seeds[1] = ISystemProgram.Seed(abi.encodePacked(user));
        (bytes32 key,) = SystemProgram.find_program_address(romeProgram, seeds);
        return key;
    }

    /// Computes the ATA pubkey for a wallet pubkey + mint, classic SPL Token.
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

    /// Two-hop helper: EVM addr → AUTHORITY_PDA's ATA for `mint`.
    function ataForUser(address user, bytes32 mint) internal view returns (bytes32) {
        bytes32 owner = authorityPda(user);
        return ataForKey(owner, mint);
    }

    function _bytes32ToBytes(bytes32 input) private pure returns (bytes memory) {
        return abi.encodePacked(input);
    }
}
