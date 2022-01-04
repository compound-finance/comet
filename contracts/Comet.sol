//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

contract Comet {
    struct Configuration {
        address governor;
        address priceOracle;
        address baseToken;
        address[] collateralAssets;

        // mapping(address => uint) borrowCollateralFactor;
        // mapping(address => uint) liquidateCollateralFactor;
        // mapping(address => uint) liquidationPenalty;
        // mapping(address => uint) storeFrontDiscountFactor;
        // mapping(address => uint) supplyCap;

        uint256 targetReserves;
        uint256 absorbTip;
        uint256 absorbBaseGas;
        uint256 borrowMin;
        uint256 baseTrackingSupplySpeed;
        uint256 baseTrackingBorrowSpeed;
        uint256 kink;
        uint256 interestRateSlopeLow;
        uint256 interestRateSlopeHigh;
        uint256 interestRateBase;
        uint256 reserveRate;
    }

    // Configuration constants
    address public immutable governor;
    address public immutable priceOracle;
    address public immutable baseToken;

    // Immutable ??
    address[] public collateralAssets;
    mapping(address => uint256) public borrowCollateralFactor;
    mapping(address => uint256) public liquidateCollateralFactor;
    mapping(address => uint256) public liquidationPenalty;
    mapping(address => uint256) public storeFrontDiscountFactor;
    mapping(address => uint256) public supplyCap;

    uint256 public immutable targetReserves;
    uint256 public immutable absorbTip;
    uint256 public immutable absorbBaseGas;
    uint256 public immutable borrowMin;

    uint256 public immutable baseTrackingSupplySpeed;
    uint256 public immutable baseTrackingBorrowSpeed;
    uint256 public immutable kink;
    uint256 public immutable interestRateSlopeLow;
    uint256 public immutable interestRateSlopeHigh;
    uint256 public immutable interestRateBase;
    uint256 public immutable reserveRate;

    // Storage

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

    // 256 bits total
    struct UserCollateral {
        uint128 amount;
        uint128 trackingIndex;
    }
    // asset => user => collateral data
    mapping(address => mapping(address => UserCollateral)) public collateral;

    mapping(address => uint256) public userNonces;

    uint256 public constant FACTOR = 1e18;

    constructor(Configuration memory config) {
        // Set configuration variables
        governor = config.governor;
        priceOracle = config.priceOracle;
        baseToken = config.baseToken;
        collateralAssets = config.collateralAssets;
        targetReserves = config.targetReserves;
        absorbTip = config.absorbTip;
        absorbBaseGas = config.absorbBaseGas;
        borrowMin = config.borrowMin;
        baseTrackingSupplySpeed = config.baseTrackingSupplySpeed;
        baseTrackingBorrowSpeed = config.baseTrackingBorrowSpeed;
        kink = config.kink;
        interestRateSlopeLow = config.interestRateSlopeLow;
        interestRateSlopeHigh = config.interestRateSlopeHigh;
        interestRateBase = config.interestRateBase;
        reserveRate = config.reserveRate;

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
