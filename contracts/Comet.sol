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

		uint targetReserves;
	    uint absorbTip;
	    uint absorbBaseGas;
	    uint borrowMin;

	    uint baseTrackingSupplySpeed;
	    uint baseTrackingBorrowSpeed;
	    uint kink;
	    uint interestRateSlopeLow;
	    uint interestRateSlopeHigh;
	    uint interestRateBase;
	    uint reserveRate;
	}

	// Configuration constants
	address immutable public governor;
	address immutable public priceOracle;
	address immutable public baseToken;

	// Immutable ??
	address[] public collateralAssets;
	mapping(address => uint) public borrowCollateralFactor;
	mapping(address => uint) public liquidateCollateralFactor;
	mapping(address => uint) public liquidationPenalty;
	mapping(address => uint) public storeFrontDiscountFactor;
	mapping(address => uint) public supplyCap;

	uint immutable public targetReserves;
	uint immutable public absorbTip;
	uint immutable public absorbBaseGas;
	uint immutable public borrowMin;

	uint immutable public baseTrackingSupplySpeed;
	uint immutable public baseTrackingBorrowSpeed;
	uint immutable public kink;
	uint immutable public interestRateSlopeLow;
	uint immutable public interestRateSlopeHigh;
	uint immutable public interestRateBase;
	uint immutable public reserveRate;

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