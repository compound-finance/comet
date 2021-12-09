//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

contract ProtocolUnoptimized {
    uint256 public totalSupplyBase;
    uint256 public baseSupplyIndex;
    uint256 public trackingSupplyIndex;
    uint256 public pauseFlags;
    uint256 public totalBorrowBase;
    uint256 public baseBorrowIndex;
    uint256 public trackingBorrowIndex;
    uint256 public lastAccrualTime;

    uint256 public res1;
    uint256 public res2;
    uint256 public res3;
    uint256 public res4;
    uint256 public res5;

    mapping(address => mapping(address => bool)) public isPermitted;

    struct User {
        int256 principal;
        uint256 baseTrackingIndex;
        uint256 baseTrackingAccrued;
        uint256 assets;
    }
    mapping(address => User) public users;

    struct Asset {
        uint256 totalCollateral;
        uint256 collateralTrackingIndex;
    }
    mapping(address => Asset) public assets;
    mapping(address => uint256) public userNonces;

    uint256 public constant FACTOR = 1e18;

    constructor() {
        lastAccrualTime = block.timestamp;

        baseBorrowIndex = FACTOR;
        baseSupplyIndex = FACTOR;
        trackingSupplyIndex = FACTOR;
        trackingBorrowIndex = FACTOR;

        pauseFlags = 0;
        totalSupplyBase = 0;
    }

    function getLastAccrualTime() external view returns (uint256) {
        return lastAccrualTime;
    }

    function setUser(
        address userAddress,
        int256 userPrincipal,
        uint256 userBaseTrackingIndex,
        uint256 userBaseTrackingAccrued,
        uint256 userAssets
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
            int256,
            uint256,
            uint256,
            uint256
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
        uint256 assetTotalCollateral,
        uint256 assetCollateralTrackingIndex
    ) external {
        assets[assetAddress] = Asset({
            totalCollateral: assetTotalCollateral,
            collateralTrackingIndex: assetCollateralTrackingIndex
        });
    }

    function getAsset(address assetAddress)
        external
        view
        returns (uint256, uint256)
    {
        Asset memory asset = assets[assetAddress];
        return (asset.totalCollateral, asset.collateralTrackingIndex);
    }

    function getTotals()
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        return (
            totalSupplyBase,
            totalBorrowBase,
            baseSupplyIndex,
            baseBorrowIndex,
            trackingSupplyIndex,
            trackingBorrowIndex,
            pauseFlags,
            lastAccrualTime
        );
    }

    function experiment() external {
        res1 = totalSupplyBase + totalBorrowBase;
        res2 = baseSupplyIndex + baseBorrowIndex;
        res3 = trackingSupplyIndex + trackingBorrowIndex;
        res4 = pauseFlags;
        res5 = lastAccrualTime;
    }
}
