// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./Comet.sol";
import "./CometConfiguration.sol";

contract CometFactory is CometConfiguration {
    function clone(
        address[] calldata _addresses,
        // address _governor,
        // address _pauseGuardian,
        // address _baseToken,
        // address _baseTokenPriceFeed,
        uint _kink,
        uint _perYearInterestRateSlopeLow,
        uint _perYearInterestRateSlopeHigh,
        uint _perYearInterestRateBase,
        uint _reserveRate,
        uint _trackingIndexScale,
        uint _baseTrackingSupplySpeed,
        uint _baseTrackingBorrowSpeed,
        uint _baseMinForRewards,
        uint _baseBorrowMin,
        uint _targetReserves,
        AssetConfig[] calldata _assetConfigs
    ) external returns (address) {
        return
            address(
                new Comet(
                    _addresses,
                    // _governor,
                    // _pauseGuardian,
                    // _baseToken,
                    // _baseTokenPriceFeed,
                    _kink,
                    _perYearInterestRateSlopeLow,
                    _perYearInterestRateSlopeHigh,
                    _perYearInterestRateBase,
                    _reserveRate,
                    _trackingIndexScale,
                    _baseTrackingSupplySpeed,
                    _baseTrackingBorrowSpeed,
                    _baseMinForRewards,
                    _baseBorrowMin,
                    _targetReserves,
                    _assetConfigs
                )
            );
    }
}
