// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @title Compound's Comet Configuration Interface
 * @author Compound
 */
contract CometConfiguration {
    struct ExtConfiguration {
        bytes32 name32;
        bytes32 symbol32;
    }

    struct Configuration {
        address governor; // 0
        address pauseGuardian;
        address baseToken;
        address baseTokenPriceFeed;
        address extensionDelegate; // 4

        uint64 supplyKink;
        uint64 supplyPerYearInterestRateSlopeLow;
        uint64 supplyPerYearInterestRateSlopeHigh;
        uint64 supplyPerYearInterestRateBase;
        uint64 borrowKink;
        uint64 borrowPerYearInterestRateSlopeLow;
        uint64 borrowPerYearInterestRateSlopeHigh;
        uint64 borrowPerYearInterestRateBase;
        uint64 storeFrontPriceFactor;
        uint64 trackingIndexScale;
        uint64 baseTrackingSupplySpeed;
        uint64 baseTrackingBorrowSpeed; // 7
        uint104 baseMinForRewards;
        uint104 baseBorrowMin; // 8
        uint104 targetReserves; // 9

        AssetConfig[] assetConfigs; // 10
    }

    struct AssetConfig {
        address asset; // 0
        address priceFeed; // 1
        uint8 decimals;
        uint64 borrowCollateralFactor; // 2
        uint64 liquidateCollateralFactor;
        uint64 liquidationFactor;
        uint128 supplyCap;
    }
}
