// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometFactory.sol";
import "./CometConfiguration.sol";
import "./ConfiguratorStorage.sol";

contract Configurator is ConfiguratorStorage {

    /// @notice An event emitted when a new version Comet is deployed.
    event CometDeployed(address newCometAddress); // XXX Get rid of uses of the `Comet` name
    event AdminTransferred(address oldAdmin, address newAdmin);

    /// @notice An error given unauthorized method calls
    error Unauthorized();
    error AlreadyInitialized();
    error InvalidAddress();

    function initialize(address _admin, address _factory, Configuration calldata _config) public {
        if (admin != address(0)) revert AlreadyInitialized();
        if (_admin == address(0)) revert InvalidAddress();
        if (_factory == address(0)) revert InvalidAddress();

        admin = _admin;
        factory = _factory;
        configuratorParams = _config;
    }

    /// @notice only callable by governor
    function setFactory(address _factory) external {
        if (msg.sender != admin) revert Unauthorized();
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

    // XXX Define other setters for setting params
    /// @dev only callable by governor
    function setGovernor(address _governor) external {
        if (msg.sender != admin) revert Unauthorized();
        configuratorParams.governor = _governor;
    }

    // XXX What about removing an asset?
    /// @dev only callable by governor
    function addAsset(AssetConfig calldata asset) external {
        if (msg.sender != admin) revert Unauthorized();
        configuratorParams.assetConfigs.push(asset);
    }

    function getConfiguration() external view returns (Configuration memory) {
        return configuratorParams;
    }

    function transferAdmin(address newAdmin) external {
        if (msg.sender != admin) revert Unauthorized();
        address oldAdmin = admin;
        admin = newAdmin;
        emit AdminTransferred(oldAdmin, newAdmin);
    }
}
