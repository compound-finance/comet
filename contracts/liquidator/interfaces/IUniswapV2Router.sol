// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

/**
 * @dev Interface for interacting with Uniswap and SushiSwap Routers
 * Note Not a comprehensive interface
 */
interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}