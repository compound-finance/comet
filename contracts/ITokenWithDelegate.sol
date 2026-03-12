// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @dev Interface for interacting with a token that has delegation capabilities.
 */
interface ITokenWithDelegate {
    function delegate(address delegatee) external;
}
