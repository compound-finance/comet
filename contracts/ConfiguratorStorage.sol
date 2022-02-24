// SPDX-License-Identifier: XXX ADD VALID LICENSE
pragma solidity ^0.8.11;

import "./CometConfiguration.sol";

/**
 * @title Compound's Comet Configuration Storage Interface
 * @dev Versions can enforce append-only storage slots via inheritance.
 * @author Compound
 */
contract ConfiguratorStorage is CometConfiguration {
    /// @notice Configuration settings used to deploy new Comet instances
    /// by the configurator
    /// @dev This needs to be internal to avoid a `CompilerError: Stack too deep
    /// when compiling inline assembly` error that is caused by the default
    /// getters created for public variables.
    Configuration internal configuratorParams; // XXX can create a public getter for this

    /// @notice The admin of the protocol
    address public governor; 

    /// @notice Address for the Comet factory contract
    address public factory;
}