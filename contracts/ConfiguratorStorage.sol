// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometConfiguration.sol";

/**
 * @title Compound's Comet Configuration Storage Interface
 * @dev Versions can enforce append-only storage slots via inheritance.
 * @author Compound
 */
contract ConfiguratorStorage is CometConfiguration {
    /// @notice The current version of Configurator. This version should be
    /// checked in the initializer function.
    uint public version;

    /// @notice Mapping of Comet proxy addresses to their Configuration settings
    /// @dev This needs to be internal to avoid a `CompilerError: Stack too deep
    /// when compiling inline assembly` error that is caused by the default
    /// getters created for public variables.
    mapping(address => Configuration) internal configuratorParams;

    /// @notice The governor of the protocol
    address public governor;

    /// @notice Mapping of Comet proxy addresses to their Comet factory contracts
    mapping(address => address) public factory;
}