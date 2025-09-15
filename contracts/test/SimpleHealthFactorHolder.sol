// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../IHealthFactorHolder.sol";

contract SimpleHealthFactorHolder is IHealthFactorHolder {
    mapping(address => uint256) public targetHealthFactors;

    function targetHealthFactor(address comet) external view override returns (uint256) {
        return targetHealthFactors[comet];
    }

    function setTargetHealthFactor(address comet, uint256 newHealthFactor) external {
        targetHealthFactors[comet] = newHealthFactor;
    }    
}