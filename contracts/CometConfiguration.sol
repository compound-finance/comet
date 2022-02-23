// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

/**
 * @title Compound's Comet Configuration Interface
 * @dev Versions can enforce append-only storage slots via inheritance.
 * @author Compound
 */
contract CometConfiguration {
    struct Configuration {
        address governor;
        address pauseGuardian;
        address baseToken;
        address baseTokenPriceFeed;

        uint kink;
        uint perYearInterestRateSlopeLow;
        uint perYearInterestRateSlopeHigh;
        uint perYearInterestRateBase;
        uint reserveRate;
        uint trackingIndexScale;
        uint baseTrackingSupplySpeed;
        uint baseTrackingBorrowSpeed;
        uint baseMinForRewards;
        uint baseBorrowMin;
        uint targetReserves;

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
