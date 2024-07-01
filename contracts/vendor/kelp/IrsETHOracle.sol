// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

interface IrsETHOracle {
    function rsETHPrice() external view returns (uint256);
} 
