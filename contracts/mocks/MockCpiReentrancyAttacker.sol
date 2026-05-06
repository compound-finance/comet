// SPDX-License-Identifier: BSD-3-Clause
pragma solidity 0.8.15;

interface IUnifiedTokenForReentry {
    function transfer(address to, uint256 value) external returns (bool);
}

/// @title MockCpiReentrancyAttacker
/// @notice An alternative MockCpiProgram bytecode whose `invoke_signed` always
/// re-enters `msg.sender` (which under delegatecall is the original caller of
/// UnifiedToken — i.e. UnifiedToken itself).
///
/// Tests install this contract's bytecode at the precompile address ONLY for
/// the reentrancy test case. After the test, the standard MockCpiProgram is
/// re-installed (or the test is the last one in its file).
///
/// Self-contained — does not depend on storage slots, since under delegatecall
/// storage maps to UnifiedToken's slots and is unreliable.
contract MockCpiReentrancyAttacker {
    struct AccountMeta {
        bytes32 pubkey;
        bool is_signer;
        bool is_writable;
    }

    function invoke(
        bytes32 /*programId*/,
        AccountMeta[] memory /*accounts*/,
        bytes memory /*data*/
    ) external {
        _attack();
    }

    function invoke_signed(
        bytes32 /*programId*/,
        AccountMeta[] memory /*accounts*/,
        bytes memory /*data*/,
        bytes32[] memory /*seeds*/
    ) external {
        _attack();
    }

    /// rome-evm-private PR #318 SPL Token Classic transfer_checked precompile.
    /// `UnifiedToken._transferViaCpiAsSpender` now hits this selector instead
    /// of `invoke_signed`. The reentrancy attack shape is identical: under
    /// delegatecall, `_attack()` re-enters UnifiedToken's `transfer` and trips
    /// the reentrancy guard.
    function spl_transfer_checked_v1(
        bytes32 /*srcAta*/,
        bytes32 /*mint*/,
        bytes32 /*dstAta*/,
        uint64 /*amount*/,
        uint8 /*decimals*/,
        bytes32[] memory /*salts*/
    ) external returns (bool) {
        _attack();
        return true;
    }

    /// Re-enter the contract that delegatecalled us. Under delegatecall,
    /// address(this) IS the contract under test (UnifiedToken), so we just
    /// call ourselves. The reentrancy guard MUST trip and bubble its revert
    /// reason up.
    function _attack() internal {
        IUnifiedTokenForReentry(address(this)).transfer(address(0xdead), 1);
    }

    function account_info(bytes32)
        external pure
        returns (uint64, bytes32, bool, bool, bool, bytes memory)
    {
        return (uint64(0), bytes32(0), false, false, false, "");
    }
}
