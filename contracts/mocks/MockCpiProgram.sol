// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

interface IUnifiedTokenForReentry {
    function transfer(address to, uint256 value) external returns (bool);
}

/// Used by `derive_user_ata` mock to delegate to MockSystemProgram so the
/// `setAtaFor(user, mint, ata)` override map already used by existing tests
/// continues to apply identically after the AtaDeriver → derive_user_ata
/// swap in UnifiedToken.
interface IMockSystemProgramForAta {
    function getAtaFor(address user, bytes32 mint) external view returns (bytes32);
}

address constant SYSTEM_PROGRAM_ADDR = address(0xfF00000000000000000000000000000000000007);

/// @title MockCpiProgram
/// @notice Test-time stand-in for the Rome CpiProgram precompile.
///
/// Tests install this contract's bytecode at the canonical CpiProgram
/// address (0xFF...08) via `hardhat_setCode`. Two test surfaces:
///
///   1. account_info — returns stubbed account data set via setAccountData.
///      Called as a regular call (staticcall pattern); reads MockCpiProgram's
///      storage at the precompile address.
///
///   2. invoke / invoke_signed — emits an `InvokeRecorded` event so tests
///      can read invocations from the tx receipt. Events work under
///      delegatecall (the contract under test is what's stamped on the log,
///      but the event topic is unique and tests filter by topic).
contract MockCpiProgram {
    struct Invocation {
        bytes32 programId;
        bool signed;
    }

    mapping(bytes32 => bytes) public accountData;

    /// Recorded invocations. Always written to mock storage via setAccountData
    /// (which is called externally — not delegatecall). For invoke / invoke_signed,
    /// we emit an event since delegatecall would write to the caller's storage.
    Invocation[] public invocations;

    /// If the last invoke_signed call was made under delegatecall, the InvokeRecorded
    /// event will be present in tx logs. Tests reconstruct invocations from logs.
    event InvokeRecorded(
        bytes32 indexed programId,
        bool indexed signed,
        bytes32 dataHash,
        uint256 accountCount
    );

    /// If set, MockCpiProgram re-enters the target contract during invoke_signed
    /// to test the reentrancy guard.
    address public reentrancyTarget;
    bool public reentrancyArmed;

    function invoke(
        bytes32 programId,
        AccountMeta[] memory accounts,
        bytes memory data
    ) external {
        // Under delegatecall, this writes to caller storage; under regular
        // call it writes to mock storage. Either way an event fires.
        emit InvokeRecorded(programId, false, keccak256(data), accounts.length);
    }

    function invoke_signed(
        bytes32 programId,
        AccountMeta[] memory accounts,
        bytes memory data,
        bytes32[] memory /*seeds*/
    ) external {
        emit InvokeRecorded(programId, true, keccak256(data), accounts.length);
        if (reentrancyArmed && reentrancyTarget != address(0)) {
            try IUnifiedTokenForReentry(reentrancyTarget).transfer(address(0xdead), 1) {
                // Should not reach here.
            } catch {
                revert("ReentrancyGuard: reentrant call");
            }
        }
    }

    function account_info(bytes32 pubkey)
        external view
        returns (uint64, bytes32, bool, bool, bool, bytes memory)
    {
        return (
            accountLamports[pubkey],
            bytes32(0),
            false, false, false,
            accountData[pubkey]
        );
    }

    // ────────────────────────────────────────────────────────────────────
    // Precompile shortcuts (rome-evm-private PR #318 + #319). Mocks
    // mirror the actual selector handlers so contracts under test can
    // exercise the new code paths.
    // ────────────────────────────────────────────────────────────────────

    /// `account_data_at(pubkey, offset, length)` — returns a slice of
    /// `accountData[pubkey]` from `offset` for `length` bytes.
    function account_data_at(bytes32 pubkey, uint16 offset, uint16 length)
        external view returns (bytes memory)
    {
        bytes memory data = accountData[pubkey];
        if (uint256(offset) + uint256(length) > data.length) {
            revert("account_data_at: out of range");
        }
        bytes memory out = new bytes(length);
        for (uint256 i = 0; i < length; ++i) {
            out[i] = data[uint256(offset) + i];
        }
        return out;
    }

    /// `account_u64_at(pubkey, offset)` — read u64 LE at `offset`.
    function account_u64_at(bytes32 pubkey, uint16 offset)
        external view returns (uint64)
    {
        bytes memory data = accountData[pubkey];
        if (uint256(offset) + 8 > data.length) {
            revert("account_u64_at: out of range");
        }
        uint64 v = 0;
        unchecked {
            for (uint256 i = 0; i < 8; ++i) {
                v |= uint64(uint8(data[uint256(offset) + i])) << uint64(i * 8);
            }
        }
        return v;
    }

    /// `account_lamports(pubkey)` — read the per-account lamports field.
    /// Returns 0 for accounts with no `accountLamports` entry. Tests set
    /// this via `setAccountLamports` (or implicitly via `setAccountData`,
    /// which assigns rent-exempt minimum if non-empty).
    function account_lamports(bytes32 pubkey)
        external view returns (uint64)
    {
        return accountLamports[pubkey];
    }

    /// `derive_user_ata(evm_user, mint)` — Rome user → AUTHORITY_PDA → ATA
    /// in one CPI on real Marcus. The mock delegates to MockSystemProgram's
    /// `getAtaFor(user, mint)` so any `setAtaFor(user, mint, ata)` overrides
    /// already used by existing tests continue to apply byte-for-byte.
    /// Functionally equivalent to `AtaDeriver.ataForUser(user, mint)` —
    /// the patch is a CU optimization, NOT a behavior change.
    function derive_user_ata(address evm_user, bytes32 mint)
        external view returns (bytes32)
    {
        // Cross-call to the system-program mock at the canonical 0xff…07
        // address. Same pubkey output as composing two find_program_address
        // calls inline.
        return IMockSystemProgramForAta(SYSTEM_PROGRAM_ADDR).getAtaFor(evm_user, mint);
    }

    /// `pdas_batch_derive(seedGroups, programId)` — N `find_program_address`
    /// calls in one CPI on real Marcus. The mock mirrors MockSystemProgram's
    /// keccak(program ++ seed1 ++ seed2 ++ ...) per group, with a uniform
    /// bump=255 placeholder. NO ataMap override layer — `pdas_batch_derive`
    /// is used by the approve/revoke path that derives bare authority PDAs
    /// (not ATAs); tests for those paths assert on the seeds, not on
    /// preregistered output overrides.
    function pdas_batch_derive(bytes[][] memory seedGroups, bytes32 programId)
        external pure returns (bytes32[] memory)
    {
        bytes32[] memory out = new bytes32[](seedGroups.length);
        for (uint256 i = 0; i < seedGroups.length; ++i) {
            bytes memory acc = abi.encodePacked(programId);
            bytes[] memory seeds = seedGroups[i];
            for (uint256 j = 0; j < seeds.length; ++j) {
                acc = abi.encodePacked(acc, seeds[j]);
            }
            out[i] = keccak256(acc);
        }
        return out;
    }

    /// `spl_transfer_checked_v1(...)` — emits `SplTransferRecorded` so
    /// tests can verify the precompile was called with the right args.
    /// Mirrors the real precompile's signing convention: `salts.length == 0`
    /// means "sign as caller's external_auth PDA"; non-empty would derive
    /// from each salt. Tests don't usually need to differentiate.
    function spl_transfer_checked_v1(
        bytes32 srcAta,
        bytes32 mint,
        bytes32 dstAta,
        uint64 amount,
        uint8 decimals,
        bytes32[] memory salts
    ) external returns (bool) {
        emit SplTransferRecorded(srcAta, mint, dstAta, amount, decimals, salts.length);
        // Backwards-compat: also emit `InvokeRecorded` so existing tests that
        // assert `extractInvokeRecorded(rcpt).length == 1` keep passing.
        // The semantic equivalence holds — `spl_transfer_checked_v1` IS an
        // SPL Token CPI signed via the caller's external_auth PDA (or first
        // salt-derived PDA), which is exactly what `invoke_signed` would
        // produce; the precompile just builds the AccountMeta[4] + 10-byte
        // ix data buffer in Rust.
        bytes memory ixData = abi.encodePacked(uint8(12), amount, decimals);
        emit InvokeRecorded(
            // SPL Token Classic — this selector is hard-coded to that program ID.
            0x06ddf6e1d765a193d9cbe146ceeb79ac1cb485ed5f5b37913a8cf5857eff00a9,
            true,                              // signed (auto-signs as caller's external_auth PDA)
            keccak256(ixData),                 // ix data hash
            4                                   // transfer_checked AccountMeta[4]: src/mint/dst/auth
        );
        // Reentrancy attack hook (mirrors invoke_signed's reentrancy probe).
        if (reentrancyArmed && reentrancyTarget != address(0)) {
            try IUnifiedTokenForReentry(reentrancyTarget).transfer(address(0xdead), 1) {
                // Should not reach here.
            } catch {
                revert("ReentrancyGuard: reentrant call");
            }
        }
        return true;
    }

    event SplTransferRecorded(
        bytes32 indexed srcAta,
        bytes32 indexed mint,
        bytes32 indexed dstAta,
        uint64 amount,
        uint8 decimals,
        uint256 saltCount
    );

    /// Per-account lamports; defaults to rent-exempt minimum when set via
    /// `setAccountData`. Tests can override with `setAccountLamports`.
    mapping(bytes32 => uint64) public accountLamports;

    /// SPL TokenAccount rent-exempt minimum on Solana mainnet (≈0.00204 SOL).
    /// Used as the implicit "account exists" lamports value when tests call
    /// `setAccountData`.
    uint64 public constant DEFAULT_RENT_EXEMPT_LAMPORTS = 2_039_280;

    // ────────────────────── test-only setters/readers ──────────────────────

    function setAccountData(bytes32 pubkey, bytes calldata data) external {
        accountData[pubkey] = data;
        // Auto-mark the account as existing (rent-exempt) when data is set,
        // unless tests have explicitly cleared lamports.
        if (data.length > 0 && accountLamports[pubkey] == 0) {
            accountLamports[pubkey] = DEFAULT_RENT_EXEMPT_LAMPORTS;
        }
    }

    /// Override the per-account lamports (e.g., to simulate a deleted
    /// account that still has stale data, or a non-rent-exempt account).
    /// Test-only mock setter — intentionally unguarded, same shape as the
    /// pre-existing `setAccountData` / `setReentrancyAttack` helpers above.
    function setAccountLamports(bytes32 pubkey, uint64 lamports) external {
        accountLamports[pubkey] = lamports;
    }

    /// Tests prefer event-based introspection (see InvokeRecorded events
    /// in tx logs); this getter exists for non-delegatecall paths.
    function getInvocations() external view returns (Invocation[] memory) {
        return invocations;
    }

    function setReentrancyAttack(address target, bool armed) external {
        reentrancyTarget = target;
        reentrancyArmed = armed;
    }

    struct AccountMeta {
        bytes32 pubkey;
        bool is_signer;
        bool is_writable;
    }
}
