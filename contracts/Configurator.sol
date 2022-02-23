// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometFactory.sol";
import "./CometStorage.sol";
import "./CometConfiguration.sol";

contract Configurator is CometStorage {

    function setFactory(address _factory) external {
        factory = _factory;
    }

    // XXX Test that this is only callable by an admin. Should be safe because proxy checks `isAdmin`.
    // @dev Deploy a new version of the Comet implementation.
    function deploy() external returns (address) {
        return CometFactory(factory).clone(configuratorParams);
    }

    // XXX see if there is a cleaner way to do this
    function setConfiguration(Configuration memory config) external {
        Configuration storage _configuratorParams = configuratorParams;
        _configuratorParams.governor = config.governor;
        _configuratorParams.pauseGuardian = config.pauseGuardian;
        _configuratorParams.baseToken = config.baseToken;
        _configuratorParams.baseTokenPriceFeed = config.baseTokenPriceFeed;
        _configuratorParams.kink = config.kink;
        _configuratorParams.perYearInterestRateSlopeLow = config.perYearInterestRateSlopeLow;
        _configuratorParams.perYearInterestRateSlopeHigh = config.perYearInterestRateSlopeHigh;
        _configuratorParams.perYearInterestRateBase = config.perYearInterestRateBase;
        _configuratorParams.reserveRate = config.reserveRate;
        _configuratorParams.trackingIndexScale = config.trackingIndexScale;
        _configuratorParams.baseTrackingSupplySpeed = config.baseTrackingSupplySpeed;
        _configuratorParams.baseTrackingBorrowSpeed = config.baseTrackingBorrowSpeed;
        _configuratorParams.baseMinForRewards = config.baseMinForRewards;
        _configuratorParams.baseBorrowMin = config.baseBorrowMin;
        _configuratorParams.targetReserves = config.targetReserves;
        _configuratorParams.governor = config.governor;
        _configuratorParams.governor = config.governor;

        // Need to copy using this loop because directly copying of an array of structs is not supported
        for (uint256 i = 0; i < config.assetConfigs.length; i++) {
            if (i < _configuratorParams.assetConfigs.length) {
                _configuratorParams.assetConfigs[i] = config.assetConfigs[i];
            } else {
                _configuratorParams.assetConfigs.push(config.assetConfigs[i]);
            }
        }
    }

    // XXX Define other setters for setting params
    function setGovernor(address governor) external {
        configuratorParams.governor = governor;
    }

    // XXX What about removing an asset?
    function addAsset(AssetConfig calldata asset) external {
        configuratorParams.assetConfigs.push(asset);
    }
}