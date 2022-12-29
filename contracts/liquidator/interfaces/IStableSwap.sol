// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

/**
 * @dev Interface for interacting with Curve pools
 * Note Not a comprehensive interface
 */

interface IStableSwap {
    function coins(uint256 i) external view returns (address);
    function exchange(int128 i, int128 j, uint256 _dx, uint256 _min_dy) external payable returns (uint256);
}
