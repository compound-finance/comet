// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./ERC20.sol";

/**
 * @dev Interface for interacting with WstETH contract
 * Note Not a comprehensive interface
 */
interface IWstETH is ERC20 {
    function stETH() external returns (address);

    function wrap(uint256 _stETHAmount) external returns (uint256);
    function unwrap(uint256 _wstETHAmount) external returns (uint256);

    function receive() external payable;

    function getWstETHByStETH(uint256 _stETHAmount) external view returns (uint256);
    function getStETHByWstETH(uint256 _wstETHAmount) external view returns (uint256);

    function stEthPerToken() external view returns (uint256);
    function tokensPerStEth() external view returns (uint256);
}