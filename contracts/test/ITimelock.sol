// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @dev Interface for interacting with Governor bravo.
 * Note Not a comprehensive interface
 */
interface ITimelock {
    function queueTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) external;
    function executeTransaction(address target, uint value, string memory signature, bytes memory data, uint eta) external;
}