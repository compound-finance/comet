// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometFactory.sol";
import "./CometConfiguration.sol";
import "./ConfiguratorStorage.sol";

contract Configurator is ConfiguratorStorage {

    /// @notice An event emitted when a new version Comet is deployed.
    event CometDeployed(address newCometAddress); // XXX Get rid of uses of the `Comet` name

    /// @notice An error given unauthorized method calls
    error Unauthorized();

    // XXX should only be able to call this once
    function initialize(address _governor, address _factory, Configuration calldata _config) public {
        governor = _governor;
        factory = _factory;
        configuratorParams = _config;
    }

    /// @notice only callable by governor
    function setFactory(address _factory) external {
        if (msg.sender != governor) revert Unauthorized();
        factory = _factory;
    }

    /// @notice Deploy a new version of the Comet implementation.
    /// @dev callable by anyone
    function deploy() external returns (address) {
        address newComet = CometFactory(factory).clone(configuratorParams);
        // cometImpl = newComet;
        emit CometDeployed(newComet);
        return newComet;
    }

    // XXX Test this is only callable by an admin
    // XXX See if there is a cleaner way to do this
    /// @dev only callable by governor
    function setConfiguration(Configuration memory config) external {
        if (msg.sender != governor) revert Unauthorized();
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
    /// @dev only callable by governor
    function setGovernor(address _governor) external {
        if (msg.sender != governor) revert Unauthorized();
        configuratorParams.governor = _governor;
    }

    // XXX What about removing an asset?
    /// @dev only callable by governor
    function addAsset(AssetConfig calldata asset) external {
        if (msg.sender != governor) revert Unauthorized();
        configuratorParams.assetConfigs.push(asset);
    }
}