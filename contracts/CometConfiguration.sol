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
        address governor;                           // slot 1: 20 bytes
        address pauseGuardian;                      // slot 2: 20 bytes
        address baseToken;                          // slot 3: 20 bytes
        address baseTokenPriceFeed;                 // slot 4: 20 bytes
        address extensionDelegate;                  // slot 5: 20 bytes

        uint64 supplyKink;
        uint64 supplyPerYearInterestRateSlopeLow;
        uint64 supplyPerYearInterestRateSlopeHigh;
        uint64 supplyPerYearInterestRateBase;       // slot 6: 4 * 64 bits = 256 bits = 32 bytes
        uint64 borrowKink;
        uint64 borrowPerYearInterestRateSlopeLow;
        uint64 borrowPerYearInterestRateSlopeHigh;
        uint64 borrowPerYearInterestRateBase;       // slot 7: 4 * 64 bits = 256 bits = 32 bytes
        uint64 storeFrontPriceFactor;
        uint64 trackingIndexScale;
        uint64 baseTrackingSupplySpeed;
        uint64 baseTrackingBorrowSpeed;             // slot 8: 4 * 64 bits = 256 bits = 32 bytes
        uint64 targetHealthFactor;
        uint104 baseMinForRewards;                  // slot 9: 64 bits + 104 bits = 168 bits = 21 bytes
        uint104 baseBorrowMin;
        uint104 targetReserves;                     // slot 10: 2 * 104 bits = 208 bits = 26 bytes

        AssetConfig[] assetConfigs;                 // slot 11: 32 bytes
    }

    struct AssetConfig {
        address asset;
        address priceFeed;
        uint8 decimals;
        uint64 borrowCollateralFactor;
        uint64 liquidateCollateralFactor;
        uint64 liquidationFactor;
        uint128 supplyCap;
    }
}
