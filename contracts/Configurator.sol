// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity 0.8.13;

import "./CometFactory.sol";
import "./CometConfiguration.sol";
import "./ConfiguratorStorage.sol";

contract Configurator is ConfiguratorStorage {

    /// @notice An event emitted when a new version Comet is deployed.
    event CometDeployed(address newCometAddress); // XXX Get rid of uses of the `Comet` name
    event GovernorTransferred(address oldGovernor, address newGovernor);

    /// @notice An error given unauthorized method calls
    error Unauthorized();
    error AlreadyInitialized();
    error InvalidAddress();

    /// @notice Initializes the storage for Configurator
    function initialize(address _governor, address _factory, Configuration calldata _config) public {
        if (version != 0) revert AlreadyInitialized();
        if (_governor == address(0)) revert InvalidAddress();
        if (_factory == address(0)) revert InvalidAddress();

        governor = _governor;
        factory = _factory;
        configuratorParams = _config;
        version = 1;
    }

    /// @notice Sets the factory for Configurator
    /// @dev only callable by governor
    function setFactory(address _factory) external {
        if (msg.sender != governor) revert Unauthorized();
        factory = _factory;
    }

    // XXX Define other setters for setting params
    /// @dev only callable by governor
    function setGovernor(address _governor) external {
        if (msg.sender != governor) revert Unauthorized();
        configuratorParams.governor = _governor;
    }

    // XXX What about removing an asset?
    // XXX Should we check MAX_ASSETS here as well?
    /// @dev only callable by governor
    function addAsset(AssetConfig calldata asset) external {
        if (msg.sender != governor) revert Unauthorized();
        configuratorParams.assetConfigs.push(asset);
    }

    /// @notice Gets the configuration params
    function getConfiguration() external view returns (Configuration memory) {
        return configuratorParams;
    }

    /// @notice Deploy a new version of the Comet implementation.
    /// @dev callable by anyone
    function deploy() external returns (address) {
        address newComet = CometFactory(factory).clone(configuratorParams);
        emit CometDeployed(newComet);
        return newComet;
    }

    /// @notice Transfers the governor rights to a new address
    /// @dev only callable by governor
    function transferGovernor(address newGovernor) external {
        if (msg.sender != governor) revert Unauthorized();
        address oldGovernor = governor;
        governor = newGovernor;
        emit GovernorTransferred(oldGovernor, newGovernor);
    }
}
