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
        uint256 word_a;
        uint256 word_b;
    }
}
