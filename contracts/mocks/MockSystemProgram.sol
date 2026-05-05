// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

/// @title MockSystemProgram
/// @notice Test-time stand-in for the Rome SystemProgram precompile.
///
/// Tests install this contract's bytecode at the canonical SystemProgram
/// address (0xFF...07) via `hardhat_setCode`. It implements the same ABI
/// as ISystemProgram with mock-controllable responses.
contract MockSystemProgram {
    /// Configure the (user, mint) → ATA mapping. Test calls
    /// `setAtaFor(alice, USDC_MINT, knownAta)`; subsequent
    /// `find_program_address` calls with appropriate seeds return that ATA.
    mapping(bytes32 => bytes32) public ataMap; // keccak(seeds...) → ata

    /// Stubbed Rome EVM program ID (any non-zero value).
    bytes32 public constant ROME_EVM_PROGRAM = bytes32(uint256(1));

    function program_id() external pure returns (bytes32) {
        return ROME_EVM_PROGRAM;
    }

    function rome_evm_program_id() external pure returns (bytes32) {
        return ROME_EVM_PROGRAM;
    }

    /// Returns a deterministic ATA for given seeds. Uses a stub key generator
    /// (keccak of seeds) so tests can compute the expected output off-chain.
    /// For test convenience, `setAtaFor(user, mint, ata)` registers an
    /// override so tests can assert the contract calls with specific seeds.
    function find_program_address(bytes32 program, Seed[] memory seeds)
        external view returns (bytes32, uint8)
    {
        // Concat all seeds + program for hashing.
        bytes memory acc = abi.encodePacked(program);
        for (uint256 i = 0; i < seeds.length; ++i) {
            acc = abi.encodePacked(acc, seeds[i].item);
        }
        bytes32 k = keccak256(acc);
        bytes32 mapped = ataMap[k];
        if (mapped != bytes32(0)) {
            return (mapped, uint8(255));
        }
        return (k, uint8(255));
    }

    function bytes32_to_base58(bytes32 input) external pure returns (bytes memory) {
        return abi.encodePacked(input);
    }
    function base58_to_bytes32(bytes memory input) external pure returns (bytes32) {
        bytes32 out;
        for (uint256 i = 0; i < input.length && i < 32; ++i) {
            out |= bytes32(uint256(uint8(input[i]))) << (8 * (31 - i));
        }
        return out;
    }
    function operator() external pure returns (bytes32) { return bytes32(0); }
    function mint_id() external pure returns (bytes32) { return bytes32(0); }

    struct Seed { bytes item; }

    // ──────────────────────── test-only setters ────────────────────────

    /// Test helper: register the ATA the precompile should return for a
    /// given (user EVM addr, mint pubkey) pair. The test passes raw
    /// ata pubkey; the contract's AtaDeriver will call find_program_address
    /// with derived seeds, which keccak-hash deterministically — we mirror
    /// the same hash here so the lookup matches.
    function setAtaFor(address user, bytes32 mint, bytes32 ata) external {
        // Mirror AtaDeriver.ataForUser:
        //   1. authorityPda(user): find_program_address(ROME_EVM, [EXTERNAL_AUTHORITY, user])
        //   2. ataForKey(authority, mint): find_program_address(ASSOCIATED_TOKEN, [authority, SPL_TOKEN, mint])
        bytes memory authoritySeeds = abi.encodePacked(
            ROME_EVM_PROGRAM,
            bytes("EXTERNAL_AUTHORITY"),
            abi.encodePacked(user)
        );
        bytes32 authorityPda = keccak256(authoritySeeds);

        bytes memory ataSeeds = abi.encodePacked(
            ASSOCIATED_TOKEN_PROGRAM,
            abi.encodePacked(authorityPda),
            abi.encodePacked(SPL_TOKEN_PROGRAM),
            abi.encodePacked(mint)
        );
        bytes32 ataKey = keccak256(ataSeeds);
        ataMap[ataKey] = ata;
    }

    /// Helper read-side: returns the same value setAtaFor stored. For tests
    /// asserting that "the contract sees the same ATA we configured."
    function getAtaFor(address user, bytes32 mint) external view returns (bytes32) {
        bytes memory authoritySeeds = abi.encodePacked(
            ROME_EVM_PROGRAM,
            bytes("EXTERNAL_AUTHORITY"),
            abi.encodePacked(user)
        );
        bytes32 authorityPda = keccak256(authoritySeeds);

        bytes memory ataSeeds = abi.encodePacked(
            ASSOCIATED_TOKEN_PROGRAM,
            abi.encodePacked(authorityPda),
            abi.encodePacked(SPL_TOKEN_PROGRAM),
            abi.encodePacked(mint)
        );
        bytes32 ataKey = keccak256(ataSeeds);
        bytes32 mapped = ataMap[ataKey];
        return mapped == bytes32(0) ? ataKey : mapped;
    }

    bytes32 internal constant SPL_TOKEN_PROGRAM =
        0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9;
    bytes32 internal constant ASSOCIATED_TOKEN_PROGRAM =
        0x8c97258f4e2489f1bb3d1029148e0d830b5a1399daff1084048e7bd8dbe9f859;
}
