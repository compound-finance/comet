// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "./CometExt.sol";
import "./IHealthFactorHolder.sol";

contract CometExtAssetList is CometExt {

    /// @notice The address of the asset list factory
    address immutable public assetListFactory;
    
    /// @notice The address of the configurator proxy
    address public immutable configuratorProxy;

    /**
     * @notice Construct a new protocol instance
     * @param config The mapping of initial/constant parameters
     * @param assetListFactoryAddress The address of the asset list factory
     * @param configuratorProxyAddress The address of the configurator proxy
     **/
    constructor(
        ExtConfiguration memory config, 
        address assetListFactoryAddress,
        address configuratorProxyAddress
    ) CometExt(config) {
        assetListFactory = assetListFactoryAddress;
        configuratorProxy = configuratorProxyAddress;
    }
    
    uint8 internal constant MAX_ASSETS_FOR_ASSET_LIST = 24;

    function maxAssets() override external pure returns (uint8) { return MAX_ASSETS_FOR_ASSET_LIST; }
    
    function targetHealthFactor(address comet) external view returns (uint256) {
        return IHealthFactorHolder(configuratorProxy).targetHealthFactor(comet);
    }
}