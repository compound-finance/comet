// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

interface IUnifiedTokenForReentry {
    function transfer(address to, uint256 value) external returns (bool);
}

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
            uint64(0),
            bytes32(0),
            false, false, false,
            accountData[pubkey]
        );
    }

    // ────────────────────── test-only setters/readers ──────────────────────

    function setAccountData(bytes32 pubkey, bytes calldata data) external {
        accountData[pubkey] = data;
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
