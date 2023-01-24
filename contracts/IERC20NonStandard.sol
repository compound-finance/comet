// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

/**
 * @title IERC20NonStandard
 * @dev Version of ERC20 with no return values for `approve`, `transfer`, and `transferFrom`
 *  See https://medium.com/coinmonks/missing-return-value-bug-at-least-130-tokens-affected-d67bf08521ca
 */
interface IERC20NonStandard {
    function approve(address spender, uint256 amount) external;
    function transfer(address to, uint256 value) external;
    function transferFrom(address from, address to, uint256 value) external;
    function balanceOf(address account) external view returns (uint256);
}