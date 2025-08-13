// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometExtAssetList.sol";
import "./IHealthFactorHolder.sol";

contract CometExtPartialLiquidation is CometExtAssetList {

    address public immutable configuratorProxy;

    /**
     * @notice Constructor for CometExtPartialLiquidation
     * @param config The mapping of initial/constant parameters
     * @param assetListFactoryAddress The address of the asset list factory
     **/
    constructor(
        ExtConfiguration memory config,
        address assetListFactoryAddress,
        address configuratorProxyAddress
    ) CometExtAssetList(config, assetListFactoryAddress) {
        configuratorProxy = configuratorProxyAddress;
    }

    function healthFactor(address comet) external view returns (uint256) {
        return IHealthFactorHolder(configuratorProxy).healthFactors(comet);
    }
}