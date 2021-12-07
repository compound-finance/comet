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

    // 256 bits total
    struct User {
        int72 principal;
        uint96 baseTrackingIndex;
        uint48 baseTrackingAccrued;
        uint16 assets;
        uint24 nonce;
    }
    mapping(address => User) public users;

    // 256 bits total
    struct Asset {
        uint128 totalCollateral;
        uint128 collateralTrackingIndex;
    }
    mapping(address => Asset) public assets;

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

    function setUser(
        address userAddress,
        int72 userPrincipal,
        uint96 userBaseTrackingIndex,
        uint48 userBaseTrackingAccrued,
        uint16 userAssets,
        uint24 userNonce
    ) external {
        users[userAddress] = User({
            principal: userPrincipal,
            baseTrackingIndex: userBaseTrackingIndex,
            baseTrackingAccrued: userBaseTrackingAccrued,
            assets: userAssets,
            nonce: userNonce
        });
    }

    function getUser(address userAddress)
        external
        view
        returns (
            int72,
            uint96,
            uint48,
            uint16,
            uint24
        )
    {
        User memory user = users[userAddress];
        return (
            user.principal,
            user.baseTrackingIndex,
            user.baseTrackingAccrued,
            user.assets,
            user.nonce
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

    function getSupply()
        external
        view
        returns (
            uint72,
            uint64,
            uint96,
            uint8
        )
    {
        return (
            supply.totalSupplyBase,
            supply.baseSupplyIndex,
            supply.trackingSupplyIndex,
            supply.pauseFlags
        );
    }

    function getBorrow()
        external
        view
        returns (
            uint72,
            uint64,
            uint96
        )
    {
        return (
            borrow.totalBorrowBase,
            borrow.baseBorrowIndex,
            borrow.trackingBorrowIndex
        );
    }
}
