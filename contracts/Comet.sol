// SPDX-License-Identifier: ADD VALID LICENSE
pragma solidity ^0.8.0;

contract Comet {
    struct Configuration {
        address governor;
        address priceOracle;
        address baseToken;
    }

    // Configuration constants
    address public immutable governor;
    address public immutable priceOracle;
    address public immutable baseToken;

    // Storage
    uint256 public constant FACTOR = 1e18;

    // 512 bits total = 2 slots
    struct Totals {
        // 1st slot
        uint96 trackingSupplyIndex;
        uint96 trackingBorrowIndex;
        uint64 baseSupplyIndex;
        // 2nd slot
        uint64 baseBorrowIndex;
        uint72 totalSupplyBase;
        uint72 totalBorrowBase;
        uint40 lastAccrualTime;
        uint8 pauseFlags;
    }
    Totals public totals;

    constructor(Configuration memory config) {
        // Set configuration variables
        governor = config.governor;
        priceOracle = config.priceOracle;
        baseToken = config.baseToken;

        totals = Totals({
            lastAccrualTime: uint40(block.timestamp),
            baseSupplyIndex: uint64(FACTOR),
            baseBorrowIndex: uint64(FACTOR),
            trackingSupplyIndex: uint96(FACTOR),
            trackingBorrowIndex: uint96(FACTOR),
            totalSupplyBase: 0,
            totalBorrowBase: 0,
            pauseFlags: 0
        });
    }
}
