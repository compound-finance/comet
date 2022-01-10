// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.0;

/**
 * @title Compound's Comet Storage Interface
 * @dev Versions can enforce append-only storage slots via inheritance.
 * @author Compound
 */
contract CometStorage {
    // 512 bits total = 2 slots
    struct Totals {
        // 1st slot
        uint64 baseSupplyIndex;
        uint64 baseBorrowIndex;
        uint64 trackingSupplyIndex;
        uint64 trackingBorrowIndex;
        // 2nd slot
        uint104 totalSupplyBase;
        uint104 totalBorrowBase;
        uint40 lastAccrualTime;
        uint8 pauseFlags;
    }

    /// @notice Aggregate variables tracked for the entire market
    Totals public totals;

    /// @notice Mapping of users to accounts which may be permitted to manage the user account
    mapping(address => mapping(address => bool)) public isAllowed;
}
