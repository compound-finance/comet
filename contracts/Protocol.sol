//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

contract Protocol {
    // 256 bits total
    struct Supply {
        uint72 totalSupplyBase;
        uint64 baseSupplyIndex;
        uint96 trackingSupplyIndex;
        uint8 pauseFlags;
        uint16 lastAccrualTime;
    }
    Supply public supply;

    // 256 bits total
    struct Borrow {
        uint72 totalBorrowBase;
        uint64 baseBorrowIndex;
        uint96 trackingBorrowIndex;
        uint24 lastAccrualTime;
    }
    Borrow public borrow;

    mapping(address => mapping(address => bool)) public isPermitted;

    // 232 bits, maybe let's add more bits to fields here up till 256?
    struct User {
        int72 userPrincipal;
        uint96 userBaseTrackingIndex;
        uint48 userBaseTrackingAccrued;
        uint16 userAssets;
    }
    mapping(address => User) public users;

    // 256 bits total
    struct Asset {
        uint128 totalCollateral;
        uint128 collateralTrackingIndex;
    }
    mapping(address => Asset) public assets;

    mapping(address => uint256) public userNonce;

    uint256 public constant FACTOR = 1e18;

    constructor() {
        // Split last accrual time between 2 structs
        uint40 lastAccrualTime = uint40(block.timestamp);
        // Get last 16 bits
        uint16 supplyLastAccrualTime = uint16(lastAccrualTime & 65535);
        // Get first 24 bits
        uint24 borrowLastAccrualTime = uint24(lastAccrualTime >> 16);

        uint64 baseBorrowIndex = uint64(FACTOR);
        uint64 baseSupplyIndex = uint64(FACTOR);
        uint96 trackingSupplyIndex = uint64(FACTOR);
        uint96 trackingBorrowIndex = uint64(FACTOR);

        supply = Supply({
            totalSupplyBase: 0,
            baseSupplyIndex: baseSupplyIndex,
            trackingSupplyIndex: trackingSupplyIndex,
            pauseFlags: 0,
            lastAccrualTime: supplyLastAccrualTime
        });

        borrow = Borrow({
            totalBorrowBase: 0,
            baseBorrowIndex: baseBorrowIndex,
            trackingBorrowIndex: trackingBorrowIndex,
            lastAccrualTime: borrowLastAccrualTime
        });
    }

    function getLastAccrualTime() external view returns (uint40) {
        uint40 lastAccrualTime = uint40(borrow.lastAccrualTime) << 24;
        return lastAccrualTime | supply.lastAccrualTime;
    }
}
