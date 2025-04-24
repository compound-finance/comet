// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;


/**
 * @dev Interface for interacting with Sonic Bridge.
 * Note Not a comprehensive interface
 */
interface IBridge {
    function claim(uint256 id, address token, uint256 amount, bytes calldata proof) external;
}
