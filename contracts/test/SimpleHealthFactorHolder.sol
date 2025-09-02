// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "../IHealthFactorHolder.sol";
import "../IAssetListFactoryHolder.sol";

contract SimpleHealthFactorHolder is IHealthFactorHolder, IAssetListFactoryHolder {
    uint256 public constant DEFAULT_HEALTH_FACTOR = 1050000000000000000; // 1.05 in 18 decimals
    address public immutable assetListFactory;

    constructor(address _assetListFactory) {
        assetListFactory = _assetListFactory;
    }

    function healthFactor(address comet) external pure override returns (uint256) {
        return DEFAULT_HEALTH_FACTOR;
    }

    function healthFactors(address comet) external pure override returns (uint256) {
        return DEFAULT_HEALTH_FACTOR;
    }
}