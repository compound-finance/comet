//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

contract Protocol {
    // 512 bits total
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

    mapping(address => mapping(address => bool)) public isPermitted;

    // 232 bits total, 24 reserved
    struct User {
        int72 principal;
        uint96 baseTrackingIndex;
        uint48 baseTrackingAccrued;
        uint16 assets;
    }
    mapping(address => User) public users;

    // 256 bits total
    struct Asset {
        uint128 totalCollateral;
        uint128 collateralTrackingIndex;
    }
    mapping(address => Asset) public assets;
    mapping(address => uint) public userNonces;

    uint256 public constant FACTOR = 1e18;

    uint72 public res1;
    uint64 public res2;
    uint96 public res3;
    uint8 public res4;
    uint40 public res5;

    constructor() {
        // Split last accrual time between 2 structs
        uint40 lastAccrualTime = uint40(block.timestamp);

        uint64 baseBorrowIndex = uint64(FACTOR);
        uint64 baseSupplyIndex = uint64(FACTOR);
        uint96 trackingSupplyIndex = uint64(FACTOR);
        uint96 trackingBorrowIndex = uint64(FACTOR);

        totals = Totals({
            totalSupplyBase: 0,
            baseSupplyIndex: baseSupplyIndex,
            trackingSupplyIndex: trackingSupplyIndex,
            totalBorrowBase: 0,
            baseBorrowIndex: baseBorrowIndex,
            trackingBorrowIndex: trackingBorrowIndex,
            pauseFlags: 0,
            lastAccrualTime: lastAccrualTime
        });
    }

    function setUser(
        address userAddress,
        int72 userPrincipal,
        uint96 userBaseTrackingIndex,
        uint48 userBaseTrackingAccrued,
        uint16 userAssets
    ) external {
        users[userAddress] = User({
            principal: userPrincipal,
            baseTrackingIndex: userBaseTrackingIndex,
            baseTrackingAccrued: userBaseTrackingAccrued,
            assets: userAssets
        });
    }

    function getUser(address userAddress)
        external
        view
        returns (
            int72,
            uint96,
            uint48,
            uint16
        )
    {
        User memory user = users[userAddress];
        return (
            user.principal,
            user.baseTrackingIndex,
            user.baseTrackingAccrued,
            user.assets
        );
    }

    function setAsset(
        address assetAddress,
        uint128 assetTotalCollateral,
        uint128 assetCollateralTrackingIndex
    ) external {
        assets[assetAddress] = Asset({
            totalCollateral: assetTotalCollateral,
            collateralTrackingIndex: assetCollateralTrackingIndex
        });
    }

    function getAsset(address assetAddress)
        external
        view
        returns (uint128, uint128)
    {
        Asset memory asset = assets[assetAddress];
        return (asset.totalCollateral, asset.collateralTrackingIndex);
    }

    function getTotals()
        external
        view
        returns (
            uint72,
            uint72,
            uint64,
            uint64,
            uint96,
            uint96,
            uint8,
            uint40
        )
    {
        return (
            totals.totalSupplyBase,
            totals.totalBorrowBase,
            totals.baseSupplyIndex,
            totals.baseBorrowIndex,
            totals.trackingSupplyIndex,
            totals.trackingBorrowIndex,
            totals.pauseFlags,
            totals.lastAccrualTime
        );
    }

    function experiment() external {
        res1 = totals.totalSupplyBase + totals.totalBorrowBase;
        res2 = totals.baseSupplyIndex + totals.baseBorrowIndex;
        res3 = totals.trackingSupplyIndex + totals.trackingBorrowIndex;
        res4 = totals.pauseFlags;
        res5 = totals.lastAccrualTime;
    }
}
