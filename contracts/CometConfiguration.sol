// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

/**
 * @title Compound's Comet Configuration Interface
 * @author Compound
 */
contract CometConfiguration {
    struct ExtConfiguration {
        bytes32 symbol32;
        address comet;
    }

    struct Configuration {
        address governor;
        address pauseGuardian;
        address baseToken;
        address baseTokenPriceFeed;
        address extensionDelegate;
        address sToken; // need create 2 magic b/c token depends on comet and comet depends on sToken
        uint64 kink;
        uint64 perYearInterestRateSlopeLow;
        uint64 perYearInterestRateSlopeHigh;
        uint64 perYearInterestRateBase;
        uint64 reserveRate;
        uint64 trackingIndexScale;
        uint64 baseTrackingSupplySpeed;
        uint64 baseTrackingBorrowSpeed;
        uint104 baseMinForRewards;
        uint104 baseBorrowMin;
        uint104 targetReserves;
        AssetConfig[] assetConfigs;
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
