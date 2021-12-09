//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

contract Protocol {
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
    mapping(address => uint256) public userNonces;

    uint256 public constant FACTOR = 1e18;

    constructor() {
        totals = Totals({
            totalSupplyBase: 0,
            baseSupplyIndex: uint64(FACTOR),
            trackingSupplyIndex: uint96(FACTOR),
            totalBorrowBase: 0,
            baseBorrowIndex: uint64(FACTOR),
            trackingBorrowIndex: uint96(FACTOR),
            pauseFlags: 0,
            lastAccrualTime: uint40(block.timestamp)
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

    function setTotals() external {
        totals = Totals({
            totalSupplyBase: 0,
            baseSupplyIndex: uint64(FACTOR),
            trackingSupplyIndex: uint96(FACTOR),
            totalBorrowBase: 0,
            baseBorrowIndex: uint64(FACTOR),
            trackingBorrowIndex: uint96(FACTOR),
            pauseFlags: 0,
            lastAccrualTime: uint40(block.timestamp)
        });
    }
}
