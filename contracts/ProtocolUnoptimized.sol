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

    mapping(address => mapping(address => bool)) public isPermitted;

    struct User {
        int principal;
        uint baseTrackingIndex;
        uint baseTrackingAccrued;
        uint assets;
        uint nonce;
    }
    mapping(address => User) public users;

    struct Asset {
        uint totalCollateral;
        uint collateralTrackingIndex;
    }
    mapping(address => Asset) public assets;

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

    function getLastAccrualTime() external view returns (uint) {
        return lastAccrualTime;
    }

    function setUser(
        address userAddress,
        int userPrincipal,
        uint userBaseTrackingIndex,
        uint userBaseTrackingAccrued,
        uint userAssets,
        uint userNonce
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
            int,
            uint,
            uint,
            uint,
            uint
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
        uint assetTotalCollateral,
        uint assetCollateralTrackingIndex
    ) external {
        assets[assetAddress] = Asset({
            totalCollateral: assetTotalCollateral,
            collateralTrackingIndex: assetCollateralTrackingIndex
        });
    }

    function getAsset(address assetAddress)
        external
        view
        returns (uint, uint)
    {
        Asset memory asset = assets[assetAddress];
        return (asset.totalCollateral, asset.collateralTrackingIndex);
    }

    function getSupply()
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        return (
            totalSupplyBase,
            baseSupplyIndex,
            trackingSupplyIndex,
            pauseFlags
        );
    }

    function getBorrow()
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        return (totalBorrowBase, baseBorrowIndex, trackingBorrowIndex);
    }

    function experiment() external {
        res1 = totalSupplyBase + totalBorrowBase;
        res2 = baseSupplyIndex + baseBorrowIndex;
        res3 = trackingSupplyIndex + trackingBorrowIndex;
    }

}
