// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

interface IRateProvider {
    function mETHToETH(uint256) external view returns (uint256);
} 
