// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../IHealthFactorHolder.sol";

contract SimpleHealthFactorHolder is IHealthFactorHolder {
    mapping(address => uint256) public targetHealthFactor;

    function setTargetHealthFactor(address comet, uint256 newHealthFactor) external {
        targetHealthFactor[comet] = newHealthFactor;
    }    
}