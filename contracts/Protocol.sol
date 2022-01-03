//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

contract Protocol {
    uint constant baseTrackingSupplySpeed = 1e18;
    uint constant baseTrackingBorrowSpeed = 1e18;

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
            totalSupplyBase: 1e18,
            baseSupplyIndex: uint64(FACTOR),
            trackingSupplyIndex: uint96(FACTOR),
            totalBorrowBase: 1e18,
            baseBorrowIndex: uint64(FACTOR),
            trackingBorrowIndex: uint96(FACTOR),
            pauseFlags: 0,
            lastAccrualTime: uint40(block.timestamp)
        });
    }

    function getSupplyRate() public pure returns (uint) {
        return 1e18;
    }

    function getBorrowRate() public pure returns (uint) {
        return 1e18;
    }

    // Make it external for testing purposes
    function accrue1() external {
        uint timeElapsed = block.timestamp - totals.lastAccrualTime;
        if (timeElapsed > 0) {
            totals.baseSupplyIndex += uint64(totals.baseSupplyIndex * getSupplyRate() * timeElapsed);
            totals.baseBorrowIndex += uint64(totals.baseBorrowIndex * getBorrowRate() * timeElapsed);
            totals.trackingSupplyIndex += uint96(baseTrackingSupplySpeed / totals.totalSupplyBase * timeElapsed);
            totals.trackingBorrowIndex += uint96(baseTrackingBorrowSpeed / totals.totalBorrowBase * timeElapsed);

            totals.lastAccrualTime = uint40(block.timestamp);

        }

    }

    function accrue2() external {
        Totals memory _totals = totals;
        uint timeElapsed = block.timestamp - _totals.lastAccrualTime;
        if (timeElapsed > 0) {
            totals.baseSupplyIndex += uint64(_totals.baseSupplyIndex * getSupplyRate() * timeElapsed);
            totals.baseBorrowIndex += uint64(_totals.baseBorrowIndex * getBorrowRate() * timeElapsed);
            totals.trackingSupplyIndex += uint96(baseTrackingSupplySpeed / _totals.totalSupplyBase * timeElapsed);
            totals.trackingBorrowIndex += uint96(baseTrackingBorrowSpeed / _totals.totalBorrowBase * timeElapsed);

            totals.lastAccrualTime = uint40(block.timestamp);
        }

    }

    function accrue3() external {
        Totals memory _totals = totals;
        uint timeElapsed = block.timestamp - _totals.lastAccrualTime;
        if (timeElapsed > 0) {
            _totals.baseSupplyIndex += uint64(_totals.baseSupplyIndex * getSupplyRate() * timeElapsed);
            _totals.baseBorrowIndex += uint64(_totals.baseBorrowIndex * getBorrowRate() * timeElapsed);
            _totals.trackingSupplyIndex += uint96(baseTrackingSupplySpeed / _totals.totalSupplyBase * timeElapsed);
            _totals.trackingBorrowIndex += uint96(baseTrackingBorrowSpeed / _totals.totalBorrowBase * timeElapsed);

            _totals.lastAccrualTime = uint40(block.timestamp);

            totals = _totals;
        }

    }
}
