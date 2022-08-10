// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @dev Interface for interacting with a basic proxy.
 * Note Not a comprehensive interface
 */
interface IProxy {
    function implementation() external view returns (address);
}
