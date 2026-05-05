// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

/// @title RomePrecompiles
/// @notice Self-contained Rome-EVM precompile bindings, copied from
/// rome-solidity (canonical source) so this build does not require the
/// rome-solidity package as a dependency.
///
/// Mirror: contracts/interface.sol in rome-solidity. Re-verify if rome-evm-
/// private rotates precompile addresses (it hasn't since the Mollusk refactor).
///
/// Precompile addresses:
///   SystemProgram — 0xFF...07  (PDA derivation, base58, mint id)
///   CpiProgram    — 0xFF...08  (account info read, signed/unsigned CPI)

interface ISystemProgram {
    struct Seed {
        bytes item;
    }
    function program_id() external view returns (bytes32);
    function rome_evm_program_id() external view returns (bytes32);
    function find_program_address(bytes32 program, Seed[] memory seeds)
        external pure returns (bytes32, uint8);
    function bytes32_to_base58(bytes32) external view returns (bytes memory);
    function base58_to_bytes32(bytes memory) external view returns (bytes32);
    function operator() external view returns (bytes32);
    function mint_id() external view returns (bytes32);
}

interface ICrossProgramInvocation {
    struct AccountMeta {
        bytes32 pubkey;
        bool is_signer;
        bool is_writable;
    }
    function invoke(bytes32 program_id, AccountMeta[] memory accounts, bytes memory data)
        external;
    function invoke_signed(
        bytes32 program_id,
        AccountMeta[] memory accounts,
        bytes memory data,
        bytes32[] memory seeds
    ) external;
    function account_info(bytes32 pubkey)
        external view
        returns (uint64, bytes32, bool, bool, bool, bytes memory);
}

address constant SYSTEM_PROGRAM_ADDRESS = address(0xfF00000000000000000000000000000000000007);
address constant CPI_PROGRAM_ADDRESS = address(0xFF00000000000000000000000000000000000008);

/// Solana program / sysvar pubkeys (bytes32 LE-encoded).
library SolanaConstants {
    /// All-zero — System Program (11111111111111111111111111111111).
    bytes32 internal constant SYSTEM_PROGRAM = bytes32(0);

    /// TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA — classic SPL Token.
    bytes32 internal constant SPL_TOKEN_PROGRAM =
        0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9;

    /// ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL — Associated Token.
    bytes32 internal constant ASSOCIATED_TOKEN_PROGRAM =
        0x8c97258f4e2489f1bb3d1029148e0d830b5a1399daff1084048e7bd8dbe9f859;
}

// Bound singletons callers reach via `SystemProgram.x()` / `CpiProgram.y()`.
ISystemProgram constant SystemProgram = ISystemProgram(SYSTEM_PROGRAM_ADDRESS);
ICrossProgramInvocation constant CpiProgram = ICrossProgramInvocation(CPI_PROGRAM_ADDRESS);
