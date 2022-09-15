// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./ERC20.sol";

/**
 * @dev Interface for interacting with COMP.
 * Note Not a comprehensive interface
 */
interface IComp is ERC20 {
    function delegate(address delegatee) external;
    function getCurrentVotes(address account) external view returns (uint96);
}
